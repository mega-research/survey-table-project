/**
 * 실사 조사 대상 — 원본 열람과 결과 기록 (역할 모델 v2 티켓 26) — 실 로컬 DB.
 *
 * 실 DB 인 이유가 이 파일의 전부다. 검증하려는 것이 **복호된 원문이 실제로 실려 오는가**,
 * **작성자가 행에 남는가**, **파티션이 real 로 고정되는가**인데 셋 다 암호화·INSERT·WHERE 라
 * 목으로는 무엇이든 통과한다.
 *
 * 축 다섯:
 *  ① **원본 전체** — PII 가 마스킹이 아니라 복호된 평문으로 온다(게스트 투영의 정반대).
 *  ② **기록** — 결과코드·메모가 시도 회차로 쌓이고 **작성자가 남는다**.
 *  ③ **파생 시야는 열람 한정** — 팀장이 본인 미초대 설문에서 기록을 시도하면 거부된다.
 *  ④ **파티션 고정** — 테스트 모드가 켜져 있어도 실사는 real 을 읽고 real 에 쓴다.
 *  ⑤ **차단** — 업로드·컨택 수정·메일·export·응답 상세는 초대돼 있어도 전부 거부.
 */
import { createRouterClient } from '@orpc/server';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  contactAttempts as attemptsTable,
  contactPii as piiTable,
  contactTargets as targetsTable,
  fieldworkOrgs as orgsTable,
  surveyParticipants as participantsTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { encryptPii } from '@/lib/crypto/aes';
import { blindIndex } from '@/lib/crypto/blind';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';
import type { ORPCContext } from '@/server/context';
import { attempts as attemptProcedures } from '@/server/contacts/procedures/attempts';
import { targets as targetProcedures } from '@/server/contacts/procedures/targets';
import { listFieldworkContacts } from '@/server/read-models/fieldwork-contacts';
import { loadSurveyCapabilities } from '@/server/survey-access';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const RUN = crypto.randomUUID().slice(0, 8);

const OWNER_ID = crypto.randomUUID();
const ORG_ID = crypto.randomUUID();
const WORKER_ID = crypto.randomUUID();
const LEADER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();

const FIELDWORK_IDS = [WORKER_ID, LEADER_ID];
const INTERNAL_IDS = [OWNER_ID];

let surveyId = '';
let targetId = '';

/** 컬럼 스킴 — 이름은 attrs, 전화번호는 PII 다(.pen 10-2 의 두 열). */
const SCHEME: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '번호(ID)', source: 'system.resid', order: 0 },
    { key: '이름', label: '이름', source: 'attrs.이름', order: 1 },
    { key: '전화번호', label: '전화번호', source: 'pii.전화번호', order: 2 },
    // 숨긴 컬럼 — 실사는 **원본 전체**를 보므로 이것도 그려져야 한다(스킴의 hidden 무시).
    { key: '비고', label: '비고', source: 'attrs.비고', order: 3, hidden: true },
  ],
};

const PHONE = '010-4821-3357';

function contextFor(
  userId: string,
  userType: 'internal' | 'fieldwork',
  isSuperadmin = false,
): ORPCContext {
  return {
    db,
    user: {
      id: userId,
      email: `fw-contacts-${userId}@example.com`,
      name: '실사테스터',
      status: 'active',
      isSuperadmin,
      userType,
    },
    headers: new Headers(),
  };
}

const attemptClient = (userId: string, userType: 'internal' | 'fieldwork' = 'fieldwork') =>
  createRouterClient(
    { attempts: attemptProcedures },
    { context: contextFor(userId, userType) },
  );

const targetClient = (userId: string) =>
  createRouterClient({ targets: targetProcedures }, { context: contextFor(userId, 'fieldwork') });

async function seedUser(
  id: string,
  over: { userType?: 'internal' | 'fieldwork'; role?: 'leader' | 'worker' } = {},
): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: `사용자-${id.slice(0, 4)}`,
    email: `fw-contacts-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    userType: over.userType ?? 'internal',
    ...(over.userType === 'fieldwork'
      ? { fieldworkOrgId: ORG_ID, fieldworkRole: over.role ?? 'worker' }
      : {}),
  });
}

async function invite(userId: string): Promise<void> {
  await db
    .insert(participantsTable)
    .values({ surveyId, userId, kind: 'fieldwork', addedBy: OWNER_ID });
}

describe.skipIf(!isLocalDb)('실사 조사 대상 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(OWNER_ID);
    await db
      .insert(orgsTable)
      .values({ id: ORG_ID, name: `실사업체-${RUN}`, createdBy: OWNER_ID });
    await seedUser(WORKER_ID, { userType: 'fieldwork', role: 'worker' });
    await seedUser(LEADER_ID, { userType: 'fieldwork', role: 'leader' });
    await db.insert(teamsTable).values({ id: TEAM_ID, name: `실사컨택팀-${RUN}` });
    await db.insert(teamMembersTable).values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'member' });
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));

    surveyId = crypto.randomUUID();
    await db.insert(surveysTable).values({
      id: surveyId,
      title: '실사 조사',
      teamId: TEAM_ID,
      visibility: 'team',
      assignmentStatus: 'assigned',
      ownerUserId: OWNER_ID,
      createdBy: OWNER_ID,
      contactColumns: SCHEME,
      contactResultCodes: [
        { code: '부재중', label: '부재중', order: 0 },
        { code: '통화 완료', label: '통화 완료', order: 1 },
      ],
    });

    targetId = crypto.randomUUID();
    await db.insert(targetsTable).values({
      id: targetId,
      surveyId,
      resid: 1024,
      isTest: false,
      groupValue: '서울',
      attrs: { 이름: '김민준', 비고: '숨긴 컬럼 값' },
      inviteToken: crypto.randomUUID(),
      inviteCode: `fw${RUN}`,
    });
    // 전화번호는 암호화 저장이다 — 실사 화면이 이것을 **복호해서** 보여주는지가 ① 의 질문이다.
    await db.insert(piiTable).values({
      contactTargetId: targetId,
      fieldType: 'phone',
      columnKey: '전화번호',
      cipher: encryptPii(PHONE),
      blindIndex: blindIndex('phone', PHONE),
      maskHint: '010-****-3357',
    });
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, INTERNAL_IDS));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    // 실사 계정 → 업체 → 내부 계정 순서다 — FK 가 양쪽을 서로 잡는다(티켓 24).
    await db.delete(usersTable).where(inArray(usersTable.id, FIELDWORK_IDS));
    await db.delete(orgsTable).where(eq(orgsTable.id, ORG_ID));
    await db.delete(usersTable).where(inArray(usersTable.id, INTERNAL_IDS));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ① 원본 전체
  // ───────────────────────────────────────────────────────────────────────────

  describe('원본 전체를 본다', () => {
    it('PII 가 마스킹이 아니라 복호된 평문으로 온다', async () => {
      const page = await listFieldworkContacts({ surveyId, page: 1 });
      const phoneIndex = page.columns.findIndex((column) => column.label === '전화번호');

      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]?.cells[phoneIndex]).toBe(PHONE);
      // 게스트 투영이 주는 힌트가 아니라는 것이 요점이다 — 두 콘솔의 정의가 갈리는 지점.
      expect(page.rows[0]?.cells[phoneIndex]).not.toContain('*');
    });

    it('스킴이 숨긴 컬럼도 그린다 — 실사용 스킴은 따로 없다', async () => {
      const page = await listFieldworkContacts({ surveyId, page: 1 });
      expect(page.columns.map((column) => column.label)).toContain('비고');
    });

    it('메일 열은 아예 없다 — 실사에게 메일 축은 항상 차단이다', async () => {
      await db
        .update(surveysTable)
        .set({
          contactColumns: {
            ...SCHEME,
            columns: [
              ...SCHEME.columns,
              { key: 'email', label: '메일', source: 'system.email_count', order: 9 },
            ],
          },
        })
        .where(eq(surveysTable.id, surveyId));

      const page = await listFieldworkContacts({ surveyId, page: 1 });
      expect(page.columns.map((column) => column.label)).not.toContain('메일');
    });

    it('대행 진입에 쓸 초대 토큰이 행에 실려 온다 — 게스트 행에서 뺀 것과 정반대다', async () => {
      const page = await listFieldworkContacts({ surveyId, page: 1 });
      expect(page.rows[0]?.inviteToken).toBeTruthy();
    });

    it('진척 배지는 필터와 무관한 전체 수다', async () => {
      const filtered = await listFieldworkContacts({ surveyId, page: 1, q: '없는이름' });
      expect(filtered.rows).toHaveLength(0);
      // 검색으로 목록이 비어도 분모는 그대로다 — 검색어가 목표를 줄이지 않는다.
      expect(filtered.progress.total).toBe(1);
    });

    it('그룹·결과코드 선택지는 이 설문에 실제로 있는 값이다', async () => {
      const page = await listFieldworkContacts({ surveyId, page: 1 });
      expect(page.groups).toEqual(['서울']);
      expect(page.resultCodes).toEqual(['부재중', '통화 완료']);
    });

    it('그룹으로 좁힌다', async () => {
      expect(
        (await listFieldworkContacts({ surveyId, page: 1, groupValue: '서울' })).rows,
      ).toHaveLength(1);
      expect(
        (await listFieldworkContacts({ surveyId, page: 1, groupValue: '부산' })).rows,
      ).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ② 기록 — 작성자가 남는다
  // ───────────────────────────────────────────────────────────────────────────

  describe('결과코드·메모 기록', () => {
    beforeEach(async () => {
      if (!isLocalDb) return;
      await invite(WORKER_ID);
    });

    it('시도 회차로 쌓이고 작성자가 실사 계정으로 남는다', async () => {
      await attemptClient(WORKER_ID).attempts.add({
        surveyId,
        contactTargetId: targetId,
        resultCode: '부재중',
        note: '3회 부재. 저녁 시간대 재시도 예정',
      });

      const [row] = await db
        .select({
          attemptNo: attemptsTable.attemptNo,
          resultCode: attemptsTable.resultCode,
          note: attemptsTable.note,
          createdBy: attemptsTable.createdBy,
        })
        .from(attemptsTable)
        .where(eq(attemptsTable.contactTargetId, targetId));

      expect(row).toMatchObject({
        attemptNo: 1,
        resultCode: '부재중',
        note: '3회 부재. 저녁 시간대 재시도 예정',
        // 담당 연구원이 「이 부재중은 누가 찍었나」를 물을 수 있어야 한다.
        createdBy: WORKER_ID,
      });
    });

    it('표의 「최근 결과」·「시도」가 함께 움직인다', async () => {
      await attemptClient(WORKER_ID).attempts.add({
        surveyId,
        contactTargetId: targetId,
        resultCode: '부재중',
      });
      await attemptClient(WORKER_ID).attempts.add({
        surveyId,
        contactTargetId: targetId,
        resultCode: '통화 완료',
      });

      const page = await listFieldworkContacts({ surveyId, page: 1 });
      expect(page.rows[0]).toMatchObject({ latestResultCode: '통화 완료', attemptCount: 2 });
    });

    it('결과코드로 좁힌다', async () => {
      await attemptClient(WORKER_ID).attempts.add({
        surveyId,
        contactTargetId: targetId,
        resultCode: '부재중',
      });
      expect(
        (await listFieldworkContacts({ surveyId, page: 1, resultCode: '부재중' })).rows,
      ).toHaveLength(1);
      expect(
        (await listFieldworkContacts({ surveyId, page: 1, resultCode: '통화 완료' })).rows,
      ).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 파생 시야는 열람 한정
  // ───────────────────────────────────────────────────────────────────────────

  describe('팀장의 파생 시야', () => {
    it('소속원 초대만 있으면 열람은 되고 기록은 거부된다', async () => {
      await invite(WORKER_ID);

      // 열람 — 화면이 열린다.
      const caps = [...(await loadSurveyCapabilities(
        { id: LEADER_ID, isSuperadmin: false, userType: 'fieldwork' },
        surveyId,
      ))];
      expect(caps).toContain('contacts.view');
      expect(caps).not.toContain('contacts.writeAttempts');

      // 기록 — 서버가 막는다. 화면이 버튼을 안 그리는 것과 별개로 강제는 여기다.
      await expect(
        attemptClient(LEADER_ID).attempts.add({
          surveyId,
          contactTargetId: targetId,
          resultCode: '부재중',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('본인도 초대되면 기록할 수 있다 — 「본인 초대 시」가 그 한 칸이다', async () => {
      await invite(LEADER_ID);
      await expect(
        attemptClient(LEADER_ID).attempts.add({
          surveyId,
          contactTargetId: targetId,
          resultCode: '부재중',
        }),
      ).resolves.toMatchObject({ attemptNo: 1 });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ④ 파티션 고정 — 테스트 모드가 켜져 있어도 real
  // ───────────────────────────────────────────────────────────────────────────

  it('테스트 모드가 켜져 있어도 실사는 real 을 읽고 real 에 쓴다', async () => {
    await invite(WORKER_ID);
    await db
      .update(surveysTable)
      .set({ testModeEnabled: true, testToken: crypto.randomUUID() })
      .where(eq(surveysTable.id, surveyId));

    // 테스트 파티션에도 컨택을 하나 심는다 — 실사 목록이 그것을 집으면 안 된다.
    const testTargetId = crypto.randomUUID();
    await db.insert(targetsTable).values({
      id: testTargetId,
      surveyId,
      resid: 1,
      isTest: true,
      attrs: { 이름: '테스트대상' },
      inviteToken: crypto.randomUUID(),
      inviteCode: `fwt${RUN}`,
    });

    const page = await listFieldworkContacts({ surveyId, page: 1 });
    expect(page.rows.map((row) => row.contactTargetId)).toEqual([targetId]);

    // 쓰기도 real 이다 — read 는 real 인데 write 만 test 로 가면 자기 쓴 기록을 못 본다.
    await attemptClient(WORKER_ID).attempts.add({
      surveyId,
      contactTargetId: targetId,
      resultCode: '부재중',
    });
    const rows = await db
      .select({ id: attemptsTable.id })
      .from(attemptsTable)
      .where(eq(attemptsTable.contactTargetId, targetId));
    expect(rows).toHaveLength(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑤ 차단 — 초대돼 있어도 열리지 않는 것
  // ───────────────────────────────────────────────────────────────────────────

  describe('초대돼 있어도 차단되는 표면', () => {
    beforeEach(async () => {
      if (!isLocalDb) return;
      await invite(WORKER_ID);
    });

    it('컨택 정보 수정은 거부된다 — 명단은 담당 연구원 몫이다', async () => {
      await expect(
        targetClient(WORKER_ID).targets.update({
          surveyId,
          id: targetId,
          attrs: { 이름: '바꿔치기' },
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('컨택 추가도 거부된다', async () => {
      await expect(
        targetClient(WORKER_ID).targets.add({ surveyId, attrs: { 이름: '몰래추가' } }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('미초대 설문 id 를 주입하면 존재를 알리지 않는다', async () => {
      const otherSurveyId = crypto.randomUUID();
      await db.insert(surveysTable).values({
        id: otherSurveyId,
        title: '초대되지 않은 조사',
        teamId: TEAM_ID,
        visibility: 'team',
        assignmentStatus: 'assigned',
        ownerUserId: OWNER_ID,
        createdBy: OWNER_ID,
      });
      try {
        await expect(
          attemptClient(WORKER_ID).attempts.add({
            surveyId: otherSurveyId,
            contactTargetId: targetId,
            resultCode: '부재중',
          }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      } finally {
        await db.delete(surveysTable).where(eq(surveysTable.id, otherSurveyId));
      }
    });

    it('내 설문의 회차라도 남의 컨택 id 는 움직이지 않는다', async () => {
      // 관문이 통과한 뒤 남는 축 — 서비스의 WHERE 에 surveyId 가 함께 걸려 있는가(티켓 15).
      const otherSurveyId = crypto.randomUUID();
      const otherTargetId = crypto.randomUUID();
      await db.insert(surveysTable).values({
        id: otherSurveyId,
        title: '남의 조사',
        teamId: TEAM_ID,
        visibility: 'team',
        assignmentStatus: 'assigned',
        ownerUserId: OWNER_ID,
        createdBy: OWNER_ID,
      });
      await db.insert(targetsTable).values({
        id: otherTargetId,
        surveyId: otherSurveyId,
        resid: 1,
        isTest: false,
        attrs: {},
        inviteToken: crypto.randomUUID(),
        inviteCode: `fwo${RUN}`,
      });

      try {
        await expect(
          attemptClient(WORKER_ID).attempts.add({
            surveyId,
            contactTargetId: otherTargetId,
            resultCode: '부재중',
          }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });

        const rows = await db
          .select({ id: attemptsTable.id })
          .from(attemptsTable)
          .where(eq(attemptsTable.contactTargetId, otherTargetId));
        expect(rows).toHaveLength(0);
      } finally {
        await db.delete(surveysTable).where(eq(surveysTable.id, otherSurveyId));
      }
    });

    it('capability 집합에 업로드·메일·응답 상세·export 가 하나도 없다', async () => {
      const caps = await loadSurveyCapabilities(
        { id: WORKER_ID, isSuperadmin: false, userType: 'fieldwork' },
        surveyId,
      );
      for (const blocked of [
        'contacts.manage',
        'mail.view',
        'mail.send',
        'responses.view',
        'export.download',
        'analytics.view',
        'survey.edit',
      ] as const) {
        expect(caps.has(blocked), `${blocked} 가 실사에게 서면 안 된다`).toBe(false);
      }
    });
  });
});
