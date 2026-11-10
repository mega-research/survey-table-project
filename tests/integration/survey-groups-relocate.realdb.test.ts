/**
 * 그룹을 통째로 옮기기 (설문 그룹 중첩 티켓 05) — 실 로컬 DB.
 *
 * `workspace.surveyGroups.relocate` 가 그룹을 하위 그룹·담긴 설문째 다른 그룹 밑이나 최상위로 옮긴다.
 * 여기서만 확인할 수 있는 것:
 *
 * ① 그 그룹 한 행만 고쳐도 하위 그룹의 깊이가 따라온다 (0166 의 ON UPDATE CASCADE)
 * ② 거부는 아무것도 바꾸지 않는다 — 자기 자신·자기 하위·깊이 초과·같은 이름·다른 팀
 * ③ 같은 팀의 구조 쓰기가 팀 키 한 줄로 서서, 동시에 옮겨도 순환과 4단계가 생기지 않는다
 *
 * 설문 그룹 실DB 스위트(`survey-groups.realdb`)와 파일을 가른 것은 같은 시기에 다른 티켓(가시성·
 * 지우기)이 그 파일의 같은 자리를 고치기 때문이다 — 심는 것(팀·사용자)은 이 파일이 따로 한다.
 */
import { createRouterClient } from '@orpc/server';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  surveyGroups as surveyGroupsTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { logger } from '@/lib/logger';
import type { ORPCContext } from '@/server/context';
import {
  DuplicateSurveyGroupNameError,
  SurveyGroupNotFoundError,
  SurveyGroupRelocationCycleError,
  SurveyGroupRelocationTooDeepError,
} from '@/server/workspace/domain/survey-groups';
import { TeamNotFoundError } from '@/server/workspace/domain/teams';
import { surveyGroups } from '@/server/workspace/procedures/survey-groups';
import * as svc from '@/server/workspace/services/survey-groups';

import { backendPid, waitForLockWaitersBehind } from '../helpers/lock-waiters';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const MEMBER_ID = crypto.randomUUID();
const OUTSIDER_ID = crypto.randomUUID();
const TEAM_A = crypto.randomUUID();
const TEAM_B = crypto.randomUUID();

function contextFor(userId: string): ORPCContext {
  return {
    db,
    user: {
      id: userId,
      email: `group-relocate-${userId}@example.com`,
      name: '그룹옮기기테스터',
      status: 'active',
      isSuperadmin: false,
      userType: 'internal',
    },
  };
}

function clientFor(userId: string) {
  return createRouterClient({ surveyGroups }, { context: contextFor(userId) });
}

const createdSurveyIds: string[] = [];
const createdGroupIds: string[] = [];
/** 해산 케이스가 심는 팀 — 고정 팀 둘을 archived 로 만들면 다른 케이스가 깨진다. */
const createdTeamIds: string[] = [];

async function seedGroup(
  client: ReturnType<typeof clientFor>,
  teamId: string,
  name: string,
  parentGroupId: string | null = null,
) {
  const { id } = await client.surveyGroups.create({ teamId, name, parentGroupId });
  createdGroupIds.push(id);
  return id;
}

/** 그 그룹에 담긴 설문을 하나 심는다. */
async function seedSurveyIn(groupId: string, title: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(surveysTable).values({
    id,
    title,
    teamId: TEAM_A,
    visibility: 'team',
    assignmentStatus: 'assigned',
    ownerUserId: MEMBER_ID,
    createdBy: MEMBER_ID,
    surveyGroupId: groupId,
  });
  createdSurveyIds.push(id);
  return id;
}

/** 그룹 행의 구조 칸 — 서비스를 거치지 않고 DB 에 남은 값을 그대로 본다. */
async function groupRow(groupId: string) {
  const [row] = await db
    .select({
      parentGroupId: surveyGroupsTable.parentGroupId,
      depth: surveyGroupsTable.depth,
      order: surveyGroupsTable.order,
    })
    .from(surveyGroupsTable)
    .where(eq(surveyGroupsTable.id, groupId));
  return row ?? null;
}

/** 팀 A 의 구조 전체 — 「아무것도 바뀌지 않았다」를 한 번에 비교한다. */
async function structureOfTeamA() {
  const rows = await db
    .select({
      id: surveyGroupsTable.id,
      parentGroupId: surveyGroupsTable.parentGroupId,
      depth: surveyGroupsTable.depth,
      order: surveyGroupsTable.order,
      updatedAt: surveyGroupsTable.updatedAt,
    })
    .from(surveyGroupsTable)
    .where(eq(surveyGroupsTable.teamId, TEAM_A));
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

describe.skipIf(!isLocalDb)('그룹을 통째로 옮기기 (real local DB)', () => {
  const member = clientFor(MEMBER_ID);
  const outsider = clientFor(OUTSIDER_ID);

  /** 이정운 ─ 2026 ─ 상반기 / 김서연 */
  async function seedChain() {
    const top = await seedGroup(member, TEAM_A, '이정운');
    const second = await seedGroup(member, TEAM_A, '2026', top);
    const third = await seedGroup(member, TEAM_A, '상반기', second);
    const other = await seedGroup(member, TEAM_A, '김서연');
    return { top, second, third, other };
  }

  beforeAll(async () => {
    if (!isLocalDb) return;
    await db.insert(usersTable).values(
      [MEMBER_ID, OUTSIDER_ID].map((id) => ({
        id,
        name: `사용자-${id.slice(0, 4)}`,
        email: `group-relocate-${id}@example.com`,
        emailVerified: true,
        status: 'active' as const,
        isSuperadmin: false,
        userType: 'internal' as const,
      })),
    );
    await db.insert(teamsTable).values([
      { id: TEAM_A, name: `옮기기팀A-${TEAM_A.slice(0, 8)}` },
      { id: TEAM_B, name: `옮기기팀B-${TEAM_B.slice(0, 8)}` },
    ]);
    // MEMBER 는 팀 A 의 **팀원**(팀장 아님) — 그룹 구조는 팀 공용이라 이걸로 충분해야 한다.
    await db.insert(teamMembersTable).values([
      { teamId: TEAM_A, userId: MEMBER_ID, role: 'member' },
      { teamId: TEAM_B, userId: OUTSIDER_ID, role: 'leader' },
    ]);
  });

  async function cleanRows() {
    if (createdSurveyIds.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, createdSurveyIds));
      createdSurveyIds.length = 0;
    }
    // 부모와 자식을 한 문장으로 지운다 — ON DELETE 가 NO ACTION 이라 부모만 따로 지우면 막힌다.
    if (createdGroupIds.length > 0) {
      await db.delete(surveyGroupsTable).where(inArray(surveyGroupsTable.id, createdGroupIds));
      createdGroupIds.length = 0;
    }
  }

  beforeEach(async () => {
    if (!isLocalDb) return;
    await cleanRows();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    await cleanRows();
    if (createdTeamIds.length > 0) {
      await db.delete(surveyGroupsTable).where(inArray(surveyGroupsTable.teamId, createdTeamIds));
    }
    const userIds = [MEMBER_ID, OUTSIDER_ID];
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, userIds));
    await db.delete(teamsTable).where(inArray(teamsTable.id, [TEAM_A, TEAM_B, ...createdTeamIds]));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  });

  describe('옮겨진다 — 하위 그룹이 함께 따라온다', () => {
    it('최상위로 옮기면 하위 그룹은 그 밑에 남은 채 깊이가 한 단 올라간다', async () => {
      const { top, second, third } = await seedChain();

      await member.surveyGroups.relocate({ groupId: second, parentGroupId: null });

      expect(await groupRow(second)).toMatchObject({ parentGroupId: null, depth: 1 });
      expect(await groupRow(third)).toMatchObject({ parentGroupId: second, depth: 2 });
      expect(await groupRow(top)).toMatchObject({ parentGroupId: null, depth: 1 });
    });

    it('다른 그룹 밑으로 옮기면 하위 그룹의 깊이가 새 자리에 맞게 바뀐다', async () => {
      const { second, third, other } = await seedChain();
      // 최상위로 올렸다가(상반기 = 2단계) 김서연 밑으로 내린다(상반기 = 3단계).
      await member.surveyGroups.relocate({ groupId: second, parentGroupId: null });
      const info = vi.spyOn(logger, 'info');

      await member.surveyGroups.relocate({ groupId: second, parentGroupId: other });

      expect(await groupRow(second)).toMatchObject({ parentGroupId: other, depth: 2 });
      expect(await groupRow(third)).toMatchObject({ parentGroupId: second, depth: 3 });
      // 옮겨진 하위 그룹 수를 남긴다 — 어느 그룹이 얼마나 달고 옮겨 갔는지의 유일한 기록이다.
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: second, parentGroupId: other, movedSubgroups: 1 }),
        expect.any(String),
      );
    });

    it('옮겨 온 그룹은 새 부모의 맨 뒤에 붙는다', async () => {
      const { second, other } = await seedChain();
      await seedGroup(member, TEAM_A, '2025', other);
      await seedGroup(member, TEAM_A, '2024', other);

      await member.surveyGroups.relocate({ groupId: second, parentGroupId: other });
      // 김서연 밑: 2025(0) · 2024(1) · 2026(2)
      expect((await groupRow(second))?.order).toBe(2);

      // 최상위로 — 최상위끼리의 맨 뒤다: 이정운(0) · 김서연(1) · 2026(2)
      await member.surveyGroups.relocate({ groupId: second, parentGroupId: null });
      expect((await groupRow(second))?.order).toBe(2);
    });

    it('안에 담긴 설문의 소속 그룹은 바뀌지 않는다', async () => {
      const { second, third, other } = await seedChain();
      const inSecond = await seedSurveyIn(second, '2026 에 직접 담긴 설문');
      const inThird = await seedSurveyIn(third, '상반기에 담긴 설문');
      const [before] = await db
        .select({ updatedAt: surveysTable.updatedAt })
        .from(surveysTable)
        .where(eq(surveysTable.id, inSecond));

      await member.surveyGroups.relocate({ groupId: second, parentGroupId: null });
      await member.surveyGroups.relocate({ groupId: second, parentGroupId: other });

      const rows = await db
        .select({
          id: surveysTable.id,
          surveyGroupId: surveysTable.surveyGroupId,
          updatedAt: surveysTable.updatedAt,
        })
        .from(surveysTable)
        .where(inArray(surveysTable.id, [inSecond, inThird]));
      expect(rows.find((r) => r.id === inSecond)?.surveyGroupId).toBe(second);
      expect(rows.find((r) => r.id === inThird)?.surveyGroupId).toBe(third);
      // 폴더를 옮기는 일은 설문 내용 수정이 아니다 — 「최신 수정순」이 뒤집히지 않는다.
      expect(rows.find((r) => r.id === inSecond)?.updatedAt).toEqual(before?.updatedAt);
    });

    it('같은 자리로 옮기기는 아무것도 바꾸지 않고 성공한다', async () => {
      const { top, second } = await seedChain();
      const before = await structureOfTeamA();

      await expect(
        member.surveyGroups.relocate({ groupId: second, parentGroupId: top }),
      ).resolves.toEqual({ success: true });
      // 최상위 그룹을 최상위로.
      await expect(
        member.surveyGroups.relocate({ groupId: top, parentGroupId: null }),
      ).resolves.toEqual({ success: true });

      // 순서도 수정 시각도 그대로다 — 맨 뒤로 다시 붙지 않는다.
      expect(await structureOfTeamA()).toEqual(before);
    });
  });

  describe('거부는 아무것도 바꾸지 않는다', () => {
    it('자기 자신 밑으로는 옮길 수 없다', async () => {
      const { second } = await seedChain();
      const before = await structureOfTeamA();

      await expect(
        member.surveyGroups.relocate({ groupId: second, parentGroupId: second }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: '그룹을 자기 자신이나 자기 하위 그룹 밑으로 옮길 수 없습니다.',
      });

      expect(await structureOfTeamA()).toEqual(before);
    });

    it('자기 하위 그룹 밑으로는 옮길 수 없다 — 한 단 아래든 두 단 아래든', async () => {
      const { top, second, third } = await seedChain();
      const before = await structureOfTeamA();

      for (const parentGroupId of [second, third]) {
        await expect(
          member.surveyGroups.relocate({ groupId: top, parentGroupId }),
        ).rejects.toMatchObject({
          code: 'CONFLICT',
          message: '그룹을 자기 자신이나 자기 하위 그룹 밑으로 옮길 수 없습니다.',
        });
        // DB 의 CHECK(23514 → 500)에 닿기 전에 서비스가 알맞은 사유로 답한다.
        await expect(
          svc.relocateSurveyGroup({ groupId: top, parentGroupId }),
        ).rejects.toBeInstanceOf(SurveyGroupRelocationCycleError);
      }

      expect(await structureOfTeamA()).toEqual(before);
    });

    it('옮긴 결과가 3단계를 넘는 자리로는 옮길 수 없다 — 새 상위의 깊이 + 가지의 높이', async () => {
      const { top, second, third, other } = await seedChain();
      const leaf = await seedGroup(member, TEAM_A, '2025', other);
      const before = await structureOfTeamA();

      // 이정운(높이 3) → 김서연(1단계) 밑: 상반기가 4단계.
      // 2026(높이 2) → 2025(2단계) 밑: 상반기가 4단계.
      // 2025(높이 1) → 상반기(3단계) 밑: 2025 가 4단계.
      for (const [groupId, parentGroupId] of [
        [top, other],
        [second, leaf],
        [leaf, third],
      ] as const) {
        await expect(
          member.surveyGroups.relocate({ groupId, parentGroupId }),
        ).rejects.toMatchObject({
          code: 'CONFLICT',
          message: '이 자리로 옮기면 그룹이 3단계를 넘습니다.',
        });
        await expect(
          svc.relocateSurveyGroup({ groupId, parentGroupId }),
        ).rejects.toBeInstanceOf(SurveyGroupRelocationTooDeepError);
      }

      expect(await structureOfTeamA()).toEqual(before);

      // 꼭 3단계가 되는 자리는 된다 — 2026(높이 2) → 김서연(1단계) 밑.
      await member.surveyGroups.relocate({ groupId: second, parentGroupId: other });
      expect(await groupRow(third)).toMatchObject({ depth: 3 });
    });

    it('그 자리에 같은 이름의 그룹이 있으면 옮길 수 없다', async () => {
      const { second, third, other } = await seedChain();
      await seedGroup(member, TEAM_A, '2026', other);
      await seedGroup(member, TEAM_A, '상반기');
      const before = await structureOfTeamA();

      // 김서연 밑에 이미 「2026」이 있다.
      await expect(
        member.surveyGroups.relocate({ groupId: second, parentGroupId: other }),
      ).rejects.toMatchObject({ code: 'CONFLICT', message: '같은 이름의 그룹이 이미 있습니다.' });
      await expect(
        svc.relocateSurveyGroup({ groupId: second, parentGroupId: other }),
      ).rejects.toBeInstanceOf(DuplicateSurveyGroupNameError);
      // 최상위에 이미 「상반기」가 있다.
      await expect(
        member.surveyGroups.relocate({ groupId: third, parentGroupId: null }),
      ).rejects.toMatchObject({ code: 'CONFLICT', message: '같은 이름의 그룹이 이미 있습니다.' });

      expect(await structureOfTeamA()).toEqual(before);
    });

    it('다른 팀의 그룹은 옮길 수 없다 — 없는 그룹과 같은 답이다', async () => {
      const { second } = await seedChain();
      const before = await structureOfTeamA();

      // 팀 B 사람에게 팀 A 의 그룹은 없는 그룹이다.
      for (const groupId of [second, crypto.randomUUID()]) {
        await expect(
          outsider.surveyGroups.relocate({ groupId, parentGroupId: null }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND', message: '그룹을 찾을 수 없습니다.' });
      }

      expect(await structureOfTeamA()).toEqual(before);
    });

    it('다른 팀의 그룹 밑으로는 옮길 수 없다 — 관문도 서비스도 없는 그룹으로 접는다', async () => {
      const { second } = await seedChain();
      const theirs = await seedGroup(outsider, TEAM_B, '남의 그룹');
      const before = await structureOfTeamA();

      for (const parentGroupId of [theirs, crypto.randomUUID()]) {
        await expect(
          member.surveyGroups.relocate({ groupId: second, parentGroupId }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND', message: '그룹을 찾을 수 없습니다.' });
        // 관문을 건너뛴 서비스 — 잠긴 값으로 같은 판정을 다시 한다.
        await expect(
          svc.relocateSurveyGroup({ groupId: second, parentGroupId }),
        ).rejects.toBeInstanceOf(SurveyGroupNotFoundError);
      }

      expect(await structureOfTeamA()).toEqual(before);
      expect(await groupRow(theirs)).toMatchObject({ parentGroupId: null, depth: 1 });
    });

    /**
     * 관문의 active 팀 확인은 별도 왕복이라, 그 사이 해산이 커밋되면 감사 계보로 남기기로 한
     * archived 팀의 구조가 바뀐다. 관문을 건너뛰고 서비스를 직접 불러 잠금 아래의 재확인만 본다.
     */
    it('해산된 팀의 그룹은 옮기기가 막힌다', async () => {
      const teamId = crypto.randomUUID();
      await db.insert(teamsTable).values({ id: teamId, name: `해산예정팀-${teamId.slice(0, 8)}` });
      createdTeamIds.push(teamId);
      await db.insert(teamMembersTable).values({ teamId, userId: MEMBER_ID, role: 'leader' });
      const top = await seedGroup(member, teamId, '해산 전 그룹');
      const child = await seedGroup(member, teamId, '해산 전 하위 그룹', top);
      await db
        .update(teamsTable)
        .set({ status: 'archived', archivedAt: new Date() })
        .where(eq(teamsTable.id, teamId));

      await expect(
        svc.relocateSurveyGroup({ groupId: child, parentGroupId: null }),
      ).rejects.toBeInstanceOf(TeamNotFoundError);
      // 관문도 같은 팀을 없는 것으로 본다.
      await expect(
        member.surveyGroups.relocate({ groupId: child, parentGroupId: null }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(await groupRow(child)).toMatchObject({ parentGroupId: top, depth: 2 });
    });
  });

  /**
   * 구조 쓰기는 팀 키 advisory lock 한 줄에 선다. 테스트가 같은 키를 먼저 쥐고 두 요청이 그 뒤에
   * 줄 선 것을 본 다음 놓는다 — 둘이 정말로 겹쳐야 「먼저 끝난 쪽의 결과를 나중 쪽이 읽는다」가
   * 확인된다. 판정이 잠금 밖에 있으면 둘 다 낡은 구조를 읽고 통과한다.
   */
  describe('동시에 옮겨도 구조가 깨지지 않는다', () => {
    async function raceBehindTeamKey<T>(start: () => Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let holderReady!: (pid: number) => void;
      const ready = new Promise<number>((resolve) => (holderReady = resolve));
      const holder = db.transaction(async (tx) => {
        // 서비스의 `lockTeamGroupStructure` 가 잡는 것과 같은 키다.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('survey-groups-' || ${TEAM_A}))`);
        holderReady(await backendPid(tx));
        await released;
      });
      const holderPid = await ready;

      const attempts = start();
      try {
        await waitForLockWaitersBehind(
          holderPid,
          attempts.length,
          '옮기기 요청들이 팀 키 잠금 뒤에 줄 서지 않았습니다',
        );
      } finally {
        release();
        await holder;
      }
      return Promise.allSettled(attempts);
    }

    it('두 요청이 서로의 하위로 동시에 옮기면 하나만 성공하고 순환이 생기지 않는다', async () => {
      const first = await seedGroup(member, TEAM_A, '2025');
      const second = await seedGroup(member, TEAM_A, '이정운');

      const settled = await raceBehindTeamKey(() => [
        member.surveyGroups.relocate({ groupId: first, parentGroupId: second }),
        member.surveyGroups.relocate({ groupId: second, parentGroupId: first }),
      ]);

      expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      // 진 쪽은 오류 화면(500)이 아니라 읽을 사유로 거부된다.
      expect(rejected[0]?.reason).toMatchObject({
        code: 'CONFLICT',
        message: '그룹을 자기 자신이나 자기 하위 그룹 밑으로 옮길 수 없습니다.',
      });

      // 정확히 한쪽이 최상위에 남고 다른 쪽이 그 밑에 있다.
      const rows = [await groupRow(first), await groupRow(second)];
      expect(rows.map((row) => row?.depth).sort()).toEqual([1, 2]);
      expect(rows.filter((row) => row?.parentGroupId === null)).toHaveLength(1);
    });

    it('두 요청이 동시에 깊이를 늘려도 4단계가 생기지 않는다', async () => {
      // 이정운 / 2026 ─ 상반기 / 김서연
      const top = await seedGroup(member, TEAM_A, '이정운');
      const branch = await seedGroup(member, TEAM_A, '2026');
      const leaf = await seedGroup(member, TEAM_A, '상반기', branch);
      const other = await seedGroup(member, TEAM_A, '김서연');

      // 따로 보면 둘 다 되는 요청이다 — 2026 을 이정운 밑으로(상반기 3단계), 이정운을 김서연 밑으로.
      // 둘이 함께 되면 김서연 › 이정운 › 2026 › 상반기, 4단계다.
      const settled = await raceBehindTeamKey(() => [
        member.surveyGroups.relocate({ groupId: branch, parentGroupId: top }),
        member.surveyGroups.relocate({ groupId: top, parentGroupId: other }),
      ]);

      expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected[0]?.reason).toMatchObject({
        code: 'CONFLICT',
        message: '이 자리로 옮기면 그룹이 3단계를 넘습니다.',
      });

      // 어느 쪽이 이겼든 4단계는 없다(이긴 쪽에 따라 가장 깊은 곳이 2단계이거나 3단계다).
      const depths = (await structureOfTeamA()).map((row) => row.depth);
      expect(Math.max(...depths)).toBeLessThanOrEqual(3);
      expect((await groupRow(leaf))?.parentGroupId).toBe(branch);
    });
  });
});
