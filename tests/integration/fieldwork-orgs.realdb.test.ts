/**
 * 실사 업체 + 실사 계정 발급 (역할 모델 v2 티켓 24) — 실 로컬 DB.
 *
 * 실 DB 인 이유가 이 파일의 절반이다. 티켓의 핵심 체크박스가 **정합 검증**이고, 그 정합의
 * 마지막 방어선은 앱 코드가 아니라 `users_fieldwork_fields_check`(0120)다 — 목에는 CHECK 가
 * 없어 「업체 없는 실사 계정」이 조용히 통과한다. 나머지 축(활성 부분 UNIQUE·집계·재직 중
 * 계정 가드)도 전부 WHERE 와 제약이라 같은 이유로 목이 증명하지 못한다.
 *
 * 네 축을 본다.
 *  ① **업체 CRUD** — 생성·수정·종료와 활성 이름 유일성.
 *  ② **계정 발급** — 소속·역할이 실제로 붙고, 활성 업체가 아니면 거부된다.
 *  ③ **경계** — 업체는 팀이 아니다. 설문 소유·팀 멤버십·재배치 목적지가 될 수 없다.
 *  ④ **관리 축** — 표면 전수가 슈퍼어드민 전용이다.
 */
import { createRouterClient } from '@orpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  accounts as accountsTable,
  fieldworkOrgs as orgsTable,
  sessions as sessionsTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  userStatusEvents as statusEventsTable,
  users as usersTable,
} from '@/db/schema';
import { users as usersProcedures } from '@/server/auth/procedures/users';
import type { ORPCContext } from '@/server/context';
import { resolveSurveyCapabilities } from '@/server/survey-access';
import { fieldworkOrgs as orgProcedures } from '@/server/workspace/procedures/fieldwork-orgs';
import { members as memberProcedures } from '@/server/workspace/procedures/members';
import { reassignment as reassignmentProcedures } from '@/server/workspace/procedures/reassignment';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const SUPERADMIN_ID = crypto.randomUUID();
const MEMBER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();
const SEED_USER_IDS = [SUPERADMIN_ID, MEMBER_ID];

/** 이 스위트가 만든 계정·업체 — 테스트마다 지운다. */
const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];

/**
 * 실행마다 다른 꼬리표.
 *
 * 업체 이름은 활성 부분 UNIQUE 이고 이메일은 전역 UNIQUE 다 — 이름을 고정하면 앞선 실행이
 * 중간에 죽어 정리가 안 됐을 때 다음 실행 전체가 「이미 있는 이름」으로 무너진다. 그 실패는
 * 진짜 회귀와 구별되지 않는다.
 */
const RUN = crypto.randomUUID().slice(0, 8);
const orgName = (label: string) => `${label}-${RUN}`;

/**
 * DB 제약 위반을 이름으로 단언한다.
 *
 * drizzle 이 pg 에러를 「Failed query: ...」로 감싸므로 `toThrow(/제약이름/)` 은 언제나
 * 실패한다 — 진짜 원인은 `cause.constraint_name` 에 있다. 이름까지 보는 것이 요점이다:
 * 아무 예외나 받으면 오타 난 컬럼명도 초록이 된다.
 */
async function expectConstraintViolation(
  run: () => Promise<unknown>,
  constraintName: string,
): Promise<void> {
  await expect(run()).rejects.toBeTruthy();
  try {
    await run();
    throw new Error(`제약 위반이 나지 않았다: ${constraintName}`);
  } catch (err) {
    const cause = (err as { cause?: { constraint_name?: string } }).cause;
    expect(cause?.constraint_name).toBe(constraintName);
  }
}

function contextFor(userId: string, isSuperadmin: boolean): ORPCContext {
  return {
    db,
    user: {
      id: userId,
      email: `fieldwork-${userId}@example.com`,
      name: '실사테스터',
      status: 'active',
      isSuperadmin,
      userType: 'internal',
    },
    headers: new Headers(),
  };
}

const orgClient = (userId: string, isSuperadmin = true) =>
  createRouterClient({ orgs: orgProcedures }, { context: contextFor(userId, isSuperadmin) });

const userClient = (userId: string, isSuperadmin = true) =>
  createRouterClient({ users: usersProcedures }, { context: contextFor(userId, isSuperadmin) });

const superOrgs = () => orgClient(SUPERADMIN_ID);
const superUsers = () => userClient(SUPERADMIN_ID);

async function makeOrg(label: string, memo: string | null = null): Promise<string> {
  const { id } = await superOrgs().orgs.create({ name: orgName(label), memo });
  createdOrgIds.push(id);
  return id;
}

async function issueFieldworkAccount(
  orgId: string,
  role: 'leader' | 'worker',
  label = crypto.randomUUID().slice(0, 8),
): Promise<string> {
  const { id } = await superUsers().users.create({
    userType: 'fieldwork',
    name: `실사-${label}`,
    email: `fieldwork-${label}-${RUN}@agency.example.com`,
    password: 'fieldwork-pass-1234',
    fieldworkOrgId: orgId,
    fieldworkRole: role,
  });
  createdUserIds.push(id);
  return id;
}

describe.skipIf(!isLocalDb)('실사 업체 + 계정 발급 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    for (const [id, isSuperadmin] of [
      [SUPERADMIN_ID, true],
      [MEMBER_ID, false],
    ] as const) {
      await db.insert(usersTable).values({
        id,
        name: `사용자-${id.slice(0, 4)}`,
        email: `fieldwork-seed-${id}@example.com`,
        emailVerified: true,
        status: 'active',
        isSuperadmin,
        userType: 'internal',
      });
    }
    await db.insert(teamsTable).values({ id: TEAM_ID, name: `실사테스트팀-${TEAM_ID.slice(0, 8)}` });
    await db
      .insert(teamMembersTable)
      .values({ teamId: TEAM_ID, userId: MEMBER_ID, role: 'leader' });
  });

  afterEach(async () => {
    if (!isLocalDb) return;
    // 계정 → 업체 순서다. FK 가 RESTRICT 라 소속 계정이 남아 있으면 업체가 안 지워진다.
    // 감사·세션·크리덴셜을 먼저 걷는다 — user_status_events 의 FK 도 RESTRICT 다.
    if (createdUserIds.length > 0) {
      await db.delete(statusEventsTable).where(inArray(statusEventsTable.userId, createdUserIds));
      await db.delete(sessionsTable).where(inArray(sessionsTable.userId, createdUserIds));
      await db.delete(accountsTable).where(inArray(accountsTable.userId, createdUserIds));
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
      createdUserIds.length = 0;
    }
    if (createdOrgIds.length > 0) {
      await db.delete(orgsTable).where(inArray(orgsTable.id, createdOrgIds));
      createdOrgIds.length = 0;
    }
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    await db.delete(statusEventsTable).where(inArray(statusEventsTable.changedBy, SEED_USER_IDS));
    await db.delete(statusEventsTable).where(inArray(statusEventsTable.userId, SEED_USER_IDS));
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, SEED_USER_IDS));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    await db.delete(usersTable).where(inArray(usersTable.id, SEED_USER_IDS));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ① 업체 CRUD
  // ───────────────────────────────────────────────────────────────────────────

  describe('업체 생성·수정·종료', () => {
    it('만들면 목록에 서고 카운트는 전부 0 이다', async () => {
      const id = await makeOrg('그린리서치', '담당 박현우');

      const { orgs } = await superOrgs().orgs.list();
      const org = orgs.find((o) => o.id === id);
      expect(org).toMatchObject({
        name: orgName('그린리서치'),
        status: 'active',
        memo: '담당 박현우',
        leaderCount: 0,
        workerCount: 0,
        invitedSurveyCount: 0,
        accounts: [],
      });
    });

    it('같은 이름의 활성 업체는 둘 만들 수 없다', async () => {
      await makeOrg('블루서베이');
      await expect(makeOrg('블루서베이')).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('이름·메모를 고칠 수 있고 빈 메모는 null 로 접힌다', async () => {
      const id = await makeOrg('옛이름', '옛 메모');
      await superOrgs().orgs.update({ orgId: id, name: orgName('새이름'), memo: '   ' });

      const { orgs } = await superOrgs().orgs.list();
      expect(orgs.find((o) => o.id === id)).toMatchObject({ name: orgName('새이름'), memo: null });
    });

    it('종료하면 목록에서 사라지지만 행은 계보로 남는다', async () => {
      const id = await makeOrg('종료할업체');
      await superOrgs().orgs.archive({ orgId: id });

      const { orgs } = await superOrgs().orgs.list();
      expect(orgs.map((o) => o.id)).not.toContain(id);

      const [row] = await db
        .select({ status: orgsTable.status, archivedBy: orgsTable.archivedBy })
        .from(orgsTable)
        .where(eq(orgsTable.id, id));
      expect(row).toMatchObject({ status: 'archived', archivedBy: SUPERADMIN_ID });
    });

    it('종료한 이름은 다시 쓸 수 있다 — 활성 이름만 유일하다', async () => {
      const first = await makeOrg('재사용이름');
      await superOrgs().orgs.archive({ orgId: first });
      await expect(makeOrg('재사용이름')).resolves.toBeTruthy();
    });

    it('종료된 업체는 수정도 종료도 NOT_FOUND — 이름은 계보다', async () => {
      const id = await makeOrg('이미종료');
      await superOrgs().orgs.archive({ orgId: id });

      await expect(
        superOrgs().orgs.update({ orgId: id, name: orgName('덮어쓰기'), memo: null }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(superOrgs().orgs.archive({ orgId: id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ② 계정 발급 — 소속과 역할이 함께 선다
  // ───────────────────────────────────────────────────────────────────────────

  describe('실사 계정 발급', () => {
    it('소속·역할이 붙고 카드 카운트가 재직 중 인원을 센다', async () => {
      const orgId = await makeOrg('카운트업체');
      const leaderId = await issueFieldworkAccount(orgId, 'leader', 'lead1');
      await issueFieldworkAccount(orgId, 'worker', 'work1');
      await issueFieldworkAccount(orgId, 'worker', 'work2');

      const [row] = await db
        .select({
          userType: usersTable.userType,
          fieldworkOrgId: usersTable.fieldworkOrgId,
          fieldworkRole: usersTable.fieldworkRole,
          status: usersTable.status,
        })
        .from(usersTable)
        .where(eq(usersTable.id, leaderId));
      expect(row).toMatchObject({
        userType: 'fieldwork',
        fieldworkOrgId: orgId,
        fieldworkRole: 'leader',
        // 발급 즉시 재직 중이다 — 승인 단계가 없다(ADR-0018).
        status: 'active',
      });

      const { orgs } = await superOrgs().orgs.list();
      const org = orgs.find((o) => o.id === orgId);
      expect(org).toMatchObject({ leaderCount: 1, workerCount: 2 });
      // 팀장이 먼저 선다 — 카드의 첫 줄이 누구에게 물어야 하는지를 알려준다.
      expect(org?.accounts[0]?.fieldworkRole).toBe('leader');
      expect(org?.accounts).toHaveLength(3);
    });

    it('없는 업체 id 로는 발급되지 않는다', async () => {
      await expect(issueFieldworkAccount(crypto.randomUUID(), 'worker')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('종료된 업체로도 발급되지 않는다', async () => {
      const orgId = await makeOrg('종료후발급');
      await superOrgs().orgs.archive({ orgId });

      await expect(issueFieldworkAccount(orgId, 'worker')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('업체·역할을 빼면 경계에서 떨어진다 — 업체 없는 실사 계정은 만들 수 없다', async () => {
      await expect(
        // 유니온에 없는 모양이라 zod 가 먼저 막는다. 「업체 없는 실사 계정 생성 거부」의
        // 바깥 겹이고, 안쪽 겹은 아래 CHECK 다.
        superUsers().users.create({
          userType: 'fieldwork',
          name: '소속없는실사',
          email: 'no-org@agency.example.com',
          password: 'fieldwork-pass-1234',
        } as never),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('DB CHECK 가 마지막 방어선이다 — 직접 INSERT 도 막힌다', async () => {
      // 앱을 우회한 쓰기까지 막는 것이 티켓의 「정합 검증」이다. 서비스 검증만 있으면
      // 스크립트·마이그레이션 한 번으로 정의되지 않은 행이 들어온다.
      await expectConstraintViolation(
        () =>
          db.insert(usersTable).values({
            id: crypto.randomUUID(),
            name: '우회실사',
            email: `bypass-${crypto.randomUUID()}@agency.example.com`,
            emailVerified: true,
            status: 'active',
            userType: 'fieldwork',
          }),
        'users_fieldwork_fields_check',
      );
    });

    it('내부 계정에 실사 컬럼을 실으면 CHECK 가 막는다 — 반대 방향도 정합이다', async () => {
      const orgId = await makeOrg('반대방향업체');
      await expectConstraintViolation(
        () =>
          db.insert(usersTable).values({
            id: crypto.randomUUID(),
            name: '내부인데실사소속',
            email: `wrong-${crypto.randomUUID()}@megaresearch.co.kr`,
            emailVerified: true,
            status: 'active',
            userType: 'internal',
            fieldworkOrgId: orgId,
            fieldworkRole: 'worker',
          }),
        'users_fieldwork_fields_check',
      );
    });

    it('사용자 목록이 업체 이름과 역할을 함께 준다', async () => {
      const orgId = await makeOrg('목록표시업체');
      const accountId = await issueFieldworkAccount(orgId, 'leader', 'listed');

      const { items } = await superUsers().users.list({ userType: 'fieldwork', status: 'all' });
      expect(items.find((u) => u.id === accountId)).toMatchObject({
        fieldworkOrgName: orgName('목록표시업체'),
        fieldworkRole: 'leader',
        // 소속의 출처가 유형마다 다르다 — 실사는 organization 을 쓰지 않는다.
        organization: null,
        jobTitle: null,
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 종료 가드 — 재직 중 계정이 남아 있으면 못 닫는다
  // ───────────────────────────────────────────────────────────────────────────

  describe('업체 종료 가드', () => {
    it('재직 중 계정이 있으면 종료가 거부된다', async () => {
      const orgId = await makeOrg('사람남은업체');
      await issueFieldworkAccount(orgId, 'worker', 'stayer');

      await expect(superOrgs().orgs.archive({ orgId })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('전원을 정지·퇴사시키면 종료할 수 있다', async () => {
      const orgId = await makeOrg('정리후종료');
      const workerId = await issueFieldworkAccount(orgId, 'worker', 'leaver');
      await superUsers().users.changeStatus({ action: 'suspend', userId: workerId });

      await expect(superOrgs().orgs.archive({ orgId })).resolves.toEqual({ success: true });
    });

    it('종료된 업체의 소속 계정은 되살릴 수 없다 — 정의되지 않은 상태를 만들지 않는다', async () => {
      const orgId = await makeOrg('종료후복귀');
      const workerId = await issueFieldworkAccount(orgId, 'worker', 'revive');
      await superUsers().users.changeStatus({ action: 'suspend', userId: workerId });
      await superOrgs().orgs.archive({ orgId });

      await expect(
        superUsers().users.changeStatus({ action: 'resume', userId: workerId }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    /**
     * 복귀 ↔ 종료 동시 실행 — **불변식**을 잰다.
     *
     * 잠금이 없으면 이렇게 깨진다: 복귀가 업체를 활성으로 읽고(잠그지 않았다) 아직 커밋하기
     * 전에, 종료가 재직 중 계정을 **0명**으로 세고(대상이 아직 정지 상태다) 커밋한다 — 둘 다
     * 성공해 「활성 계정을 가진 archived 업체」가 남는다. 전역 전이 키는 도움이 안 된다:
     * 업체 종료가 그 키를 잡지 않는다.
     *
     * 잠금 짝(복귀 FOR SHARE ↔ 종료 FOR UPDATE)이 서면 **정확히 하나만** 성공한다 — 어느
     * 쪽이 먼저든 나중 것이 상대의 결과를 보고 거부한다. 여기서 재는 것이 그 「정확히 하나」와
     * 끝 상태의 정합이고, 어느 쪽이 이기는지는 재지 않는다(그건 스케줄러 몫이다).
     */
    it('복귀와 종료를 동시에 하면 정확히 하나만 성공한다', async () => {
      const orgId = await makeOrg('복귀경합업체');
      const workerId = await issueFieldworkAccount(orgId, 'worker', 'racer');
      await superUsers().users.changeStatus({ action: 'suspend', userId: workerId });

      const settled = await Promise.allSettled([
        superUsers().users.changeStatus({ action: 'resume', userId: workerId }),
        superOrgs().orgs.archive({ orgId }),
      ]);
      const succeeded = settled.filter((r) => r.status === 'fulfilled').length;
      expect(succeeded, '둘 다 성공하면 활성 계정을 가진 종료 업체가 남는다').toBe(1);

      const [org] = await db
        .select({ status: orgsTable.status })
        .from(orgsTable)
        .where(eq(orgsTable.id, orgId));
      const [worker] = await db
        .select({ status: usersTable.status })
        .from(usersTable)
        .where(eq(usersTable.id, workerId));

      // 끝 상태의 정합 — 종료된 업체에 재직 중 계정이 남아 있으면 안 된다.
      if (org?.status === 'archived') expect(worker?.status).not.toBe('active');
      else expect(worker?.status).toBe('active');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ④ 경계 — 업체는 팀이 아니다 (ADR-0019)
  // ───────────────────────────────────────────────────────────────────────────

  describe('업체는 설문 소유·팀 멤버십·재배치 목적지가 될 수 없다', () => {
    it('실사 계정은 팀에 넣을 수 없고 팀원 후보에도 안 나온다', async () => {
      const orgId = await makeOrg('팀금지업체');
      const workerId = await issueFieldworkAccount(orgId, 'worker', 'noteam');

      const teamClient = createRouterClient(
        { members: memberProcedures },
        { context: contextFor(SUPERADMIN_ID, true) },
      );
      await expect(
        teamClient.members.add({ teamId: TEAM_ID, userId: workerId, role: 'member' }),
      ).rejects.toBeTruthy();

      const candidates = await teamClient.members.searchAssignable({
        teamId: TEAM_ID,
        query: '실사-noteam',
      });
      expect(candidates.map((c) => c.userId)).not.toContain(workerId);
    });

    it('실사 계정은 재배치 인박스의 미배치 사용자에 잡히지 않는다', async () => {
      const orgId = await makeOrg('재배치금지업체');
      const workerId = await issueFieldworkAccount(orgId, 'worker', 'noreassign');

      const reassignClient = createRouterClient(
        { reassignment: reassignmentProcedures },
        { context: contextFor(SUPERADMIN_ID, true) },
      );
      const inbox = await reassignClient.reassignment.inbox();
      // 팀이 없다는 사실은 같지만 「배치돼야 할 사람」이 아니다 — 업체가 소속이고
      // 그것은 팀 축이 아니다(ADR-0019).
      expect(inbox.unassignedUsers.map((u) => u.userId)).not.toContain(workerId);
    });

    it('업체 id 는 설문의 소유 팀이 될 수 없다 — teams 를 가리키는 FK 가 막는다', async () => {
      const orgId = await makeOrg('소유금지업체');
      await expectConstraintViolation(
        () =>
          db.insert(surveysTable).values({
            id: crypto.randomUUID(),
            title: '업체 소유 설문',
            teamId: orgId,
            assignmentStatus: 'assigned',
            ownerUserId: SUPERADMIN_ID,
            createdBy: SUPERADMIN_ID,
          }),
        'surveys_team_id_teams_id_fk',
      );
    });

    it('업체 소속만으로는 어떤 설문도 열리지 않는다 — 여는 것은 초대다 (티켓 25)', () => {
      const subject = {
        userId: crypto.randomUUID(),
        isSuperadmin: false,
        userType: 'fieldwork' as const,
        activeTeamIds: [],
        leaderTeamIds: [],
        // 소속 업체가 있어도 초대가 없으면 아무것도 열리지 않는다 — 티켓 25 전에는
        // 초대 자체가 없었고, 25 이후에도 「부여 없음」이 이 단언의 뜻이다.
        fieldworkOrgId: crypto.randomUUID(),
        fieldworkRole: 'worker' as const,
      };
      const survey = {
        teamId: TEAM_ID,
        visibility: 'team' as const,
        ownerUserId: SUPERADMIN_ID,
        assignmentStatus: 'assigned' as const,
      };
      // 업체는 소속 경계일 뿐 접근 경로가 아니다(ADR-0019) — 계정을 발급했다는 사실
      // 자체로는 어떤 설문도 열리지 않는다. 초대가 여는 것은 티켓 25 의 realdb 가 잰다.
      expect([...resolveSurveyCapabilities(subject, survey)]).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑤ 관리 축 — 슈퍼어드민 전용
  // ───────────────────────────────────────────────────────────────────────────

  describe('관리 표면은 슈퍼어드민 전용', () => {
    /** 표면 전수 — 하나라도 빠지면 그 문만 팀장에게 열린 채 남는다. */
    const CALLS: [string, (c: ReturnType<typeof orgClient>) => Promise<unknown>][] = [
      ['list', (c) => c.orgs.list()],
      ['options', (c) => c.orgs.options()],
      ['create', (c) => c.orgs.create({ name: orgName('팀장이만든업체'), memo: null })],
      [
        'update',
        (c) =>
          c.orgs.update({ orgId: crypto.randomUUID(), name: orgName('팀장이고친이름'), memo: null }),
      ],
      ['archive', (c) => c.orgs.archive({ orgId: crypto.randomUUID() })],
    ];

    it.each(CALLS)('팀장은 %s 를 지나지 못한다', async (_name, call) => {
      // MEMBER_ID 는 실제 팀의 **팀장**이다 — 미배치로 두면 「팀이 없어서」 막힌 것과
      // 구별되지 않는다. 여기서 묻는 것은 팀 권한이 이 축을 열지 못한다는 사실이다.
      await expect(call(orgClient(MEMBER_ID, false))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('만든 업체가 발급 모달 선택지에 뜨고, 종료하면 빠진다', async () => {
      // **전역 개수로 재지 않는다** — 같은 로컬 DB 를 다른 realdb 스위트가 병렬로 쓰므로
      // (티켓 25 의 실사 초대 스위트도 업체를 만든다) 개수 델타는 남의 작업에 흔들린다.
      // 내가 만든 id 가 있는가/없는가만 본다.
      const id = await makeOrg('선택지업체');
      expect((await superOrgs().orgs.options()).map((o) => o.id)).toContain(id);

      await superOrgs().orgs.archive({ orgId: id });
      expect((await superOrgs().orgs.options()).map((o) => o.id)).not.toContain(id);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑥ 초대된 설문 수 — 자리는 지금 세운다 (티켓 25 가 채운다)
  // ───────────────────────────────────────────────────────────────────────────

  it('업체 단위 distinct 로 센다 — 한 설문에 두 사람이 초대돼도 1건이다', async () => {
    const orgId = await makeOrg('초대카운트업체');
    const a = await issueFieldworkAccount(orgId, 'worker', 'inv-a');
    const b = await issueFieldworkAccount(orgId, 'worker', 'inv-b');

    const surveyId = crypto.randomUUID();
    await db.insert(surveysTable).values({
      id: surveyId,
      title: '실사 초대 설문',
      teamId: TEAM_ID,
      assignmentStatus: 'assigned',
      ownerUserId: SUPERADMIN_ID,
      createdBy: SUPERADMIN_ID,
    });
    // 초대 표면은 티켓 25 라 행을 직접 심는다 — 여기서 검증하는 것은 집계이지 초대가 아니다.
    await db.execute(sql`
      insert into survey_participants (survey_id, user_id, kind, added_by)
      values (${surveyId}, ${a}, 'fieldwork', ${SUPERADMIN_ID}),
             (${surveyId}, ${b}, 'fieldwork', ${SUPERADMIN_ID})
    `);

    try {
      const { orgs } = await superOrgs().orgs.list();
      expect(orgs.find((o) => o.id === orgId)?.invitedSurveyCount).toBe(1);
    } finally {
      await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    }
  });

  it('타 업체 소속원의 초대는 이 업체 카드에 세지 않는다', async () => {
    const mine = await makeOrg('내업체');
    const theirs = await makeOrg('남의업체');
    const theirWorker = await issueFieldworkAccount(theirs, 'worker', 'other-org');

    const surveyId = crypto.randomUUID();
    await db.insert(surveysTable).values({
      id: surveyId,
      title: '남의 업체 초대 설문',
      teamId: TEAM_ID,
      assignmentStatus: 'assigned',
      ownerUserId: SUPERADMIN_ID,
      createdBy: SUPERADMIN_ID,
    });
    await db.execute(sql`
      insert into survey_participants (survey_id, user_id, kind, added_by)
      values (${surveyId}, ${theirWorker}, 'fieldwork', ${SUPERADMIN_ID})
    `);

    try {
      const { orgs } = await superOrgs().orgs.list();
      expect(orgs.find((o) => o.id === mine)?.invitedSurveyCount).toBe(0);
      expect(orgs.find((o) => o.id === theirs)?.invitedSurveyCount).toBe(1);
    } finally {
      await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    }
  });

  it('종료된 업체의 계정은 목록 조인에서도 이름을 잃지 않는다', async () => {
    // 업체 이름은 조인으로 오므로 archived 여도 그대로 보인다 — 「이 사람은 어느 업체
    // 사람이었는가」가 사라지면 안 된다(행을 지우지 않는 이유가 그것이다).
    const orgId = await makeOrg('이름남는업체');
    const workerId = await issueFieldworkAccount(orgId, 'worker', 'namekeeper');
    await superUsers().users.changeStatus({ action: 'suspend', userId: workerId });
    await superOrgs().orgs.archive({ orgId });

    const { items } = await superUsers().users.list({ userType: 'fieldwork', status: 'all' });
    expect(items.find((u) => u.id === workerId)?.fieldworkOrgName).toBe(orgName('이름남는업체'));
  });

  it('업체는 소속 계정이 남아 있는 한 하드 삭제되지 않는다 — FK RESTRICT', async () => {
    const orgId = await makeOrg('삭제금지업체');
    await issueFieldworkAccount(orgId, 'worker', 'fkguard');

    await expectConstraintViolation(
      () => db.delete(orgsTable).where(and(eq(orgsTable.id, orgId), eq(orgsTable.status, 'active'))),
      'users_fieldwork_org_id_fkey',
    );
  });
});
