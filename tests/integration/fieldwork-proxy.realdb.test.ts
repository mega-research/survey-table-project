/**
 * 대리 응답 귀속 (역할 모델 v2 티켓 27) — 실 로컬 DB.
 *
 * 실 DB 인 이유: 검증하려는 것이 **행에 무엇이 찍히는가**와 **누가 대행으로 인정되는가**인데,
 * 전자는 INSERT/UPDATE 이고 후자는 조인 결과다 — 목은 어느 쪽도 증명하지 못한다.
 *
 * 축 다섯:
 *  ① **귀속** — 실사 세션의 진입에만 fieldworkUserId 가 찍힌다.
 *  ② **응답자 경로는 언제나 null** — 세션 없음·내부 계정 어느 쪽도 찍지 않는다.
 *  ③ **자격** — 미초대 실사·타 설문 토큰·팀장의 파생 시야는 대행이 아니다.
 *  ④ **이어서 대행** — 재개도 귀속을 남기고, 응답자가 이어받아도 지워지지 않는다.
 *  ⑤ **완료 대상 거부** — 대행 세션만 막히고 응답자 경로는 종전 그대로다.
 */
import { createRouterClient } from '@orpc/server';
import { countDistinct, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  contactTargets as targetsTable,
  surveyVersions as versionsTable,
  fieldworkOrgs as orgsTable,
  surveyParticipants as participantsTable,
  surveyResponses as responsesTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import type { ORPCContext } from '@/server/context';
import {
  describeProxyTarget,
  resolveFieldworkProxy,
  stampFieldworkAttribution,
} from '@/server/fieldwork-proxy';
import { lifecycle as lifecycleProcedures } from '@/server/survey-response/procedures/lifecycle';
import { response as responseProcedures } from '@/server/survey-response/procedures/response';

// 응답 진입 서비스가 Next 의 `headers()` 를 부른다 — 요청 스코프 밖에서는 던지므로
// 응답자 표면을 직접 부르는 스위트의 공통 요건이다(blank-response-fallback 과 같은 자리).
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (name: string) =>
      name === 'user-agent'
        ? 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0'
        : name === 'x-real-ip'
          ? '203.0.113.27'
          : null,
  })),
}));

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const RUN = crypto.randomUUID().slice(0, 8);

const OWNER_ID = crypto.randomUUID();
const ORG_ID = crypto.randomUUID();
const OTHER_ORG_ID = crypto.randomUUID();
const WORKER_ID = crypto.randomUUID();
const LEADER_ID = crypto.randomUUID();
const OUTSIDER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();

const FIELDWORK_IDS = [WORKER_ID, LEADER_ID, OUTSIDER_ID];

let surveyId = '';
let targetId = '';
let inviteToken = '';

function contextFor(userId: string | null, userType: 'internal' | 'fieldwork'): ORPCContext {
  return {
    db,
    user:
      userId === null
        ? null
        : {
            id: userId,
            email: `fw-proxy-${userId}@example.com`,
            name: userId === WORKER_ID ? '박현우' : '실사테스터',
            status: 'active',
            isSuperadmin: false,
            userType,
          },
    // 신뢰 IP 헤더가 없으면 레이트리밋이 fail-closed 로 막는다(orpc.ts) — pub 표면을
    // 직접 부르는 스위트의 공통 요건이다.
    headers: new Headers({ 'x-real-ip': '203.0.113.27' }),
  };
}

const responseClient = (userId: string | null, userType: 'internal' | 'fieldwork' = 'fieldwork') =>
  createRouterClient(
    { response: responseProcedures, lifecycle: lifecycleProcedures },
    { context: contextFor(userId, userType) },
  );

async function seedUser(
  id: string,
  over: { userType?: 'internal' | 'fieldwork'; role?: 'leader' | 'worker'; orgId?: string } = {},
): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: id === WORKER_ID ? '박현우' : `사용자-${id.slice(0, 4)}`,
    email: `fw-proxy-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    userType: over.userType ?? 'internal',
    ...(over.userType === 'fieldwork'
      ? { fieldworkOrgId: over.orgId ?? ORG_ID, fieldworkRole: over.role ?? 'worker' }
      : {}),
  });
}

async function invite(userId: string): Promise<void> {
  await db
    .insert(participantsTable)
    .values({ surveyId, userId, kind: 'fieldwork', addedBy: OWNER_ID });
}

/** 그 컨택의 응답 행 하나 — 귀속 컬럼이 이 스위트의 관심사 전부다. */
async function responseRow(): Promise<
  { id: string; fieldworkUserId: string | null; versionId: string | null } | undefined
> {
  const [row] = await db
    .select({
      id: responsesTable.id,
      fieldworkUserId: responsesTable.fieldworkUserId,
      versionId: responsesTable.versionId,
    })
    .from(responsesTable)
    .where(eq(responsesTable.contactTargetId, targetId));
  return row;
}

function entryInput(sessionId: string, token: string | undefined) {
  return {
    surveyId,
    sessionId,
    versionId: null,
    currentStepId: 'step-1',
    clientSignals: null,
    ...(token ? { inviteToken: token } : {}),
  };
}

describe.skipIf(!isLocalDb)('대리 응답 귀속 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(OWNER_ID);
    await db.insert(orgsTable).values([
      { id: ORG_ID, name: `그린리서치-${RUN}`, createdBy: OWNER_ID },
      { id: OTHER_ORG_ID, name: `타업체-${RUN}`, createdBy: OWNER_ID },
    ]);
    await seedUser(WORKER_ID, { userType: 'fieldwork', role: 'worker' });
    await seedUser(LEADER_ID, { userType: 'fieldwork', role: 'leader' });
    await seedUser(OUTSIDER_ID, { userType: 'fieldwork', role: 'worker', orgId: OTHER_ORG_ID });
    await db.insert(teamsTable).values({ id: TEAM_ID, name: `대행팀-${RUN}` });
    await db.insert(teamMembersTable).values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'member' });
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));

    surveyId = crypto.randomUUID();
    await db.insert(surveysTable).values({
      id: surveyId,
      title: '2026 고객 만족도 조사',
      teamId: TEAM_ID,
      visibility: 'team',
      assignmentStatus: 'assigned',
      ownerUserId: OWNER_ID,
      createdBy: OWNER_ID,
      status: 'published',
      isPublic: true,
    });

    targetId = crypto.randomUUID();
    inviteToken = crypto.randomUUID();
    await db.insert(targetsTable).values({
      id: targetId,
      surveyId,
      resid: 1024,
      isTest: false,
      attrs: { 이름: '김민준' },
      inviteToken,
      inviteCode: `fp${RUN}${Math.floor(Math.random() * 1000)}`,
    });
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    await db.delete(teamMembersTable).where(eq(teamMembersTable.userId, OWNER_ID));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    await db.delete(usersTable).where(inArray(usersTable.id, FIELDWORK_IDS));
    await db.delete(orgsTable).where(inArray(orgsTable.id, [ORG_ID, OTHER_ORG_ID]));
    await db.delete(usersTable).where(eq(usersTable.id, OWNER_ID));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ① 귀속
  // ───────────────────────────────────────────────────────────────────────────

  describe('귀속', () => {
    beforeEach(async () => {
      if (!isLocalDb) return;
      await invite(WORKER_ID);
    });

    it('초대된 실사가 대행 링크로 진입해 만든 응답에 실사원이 찍힌다', async () => {
      const result = await responseClient(WORKER_ID).response.createBlank(
        entryInput(crypto.randomUUID(), inviteToken),
      );
      expect(result.kind).toBe('created');
      expect((await responseRow())?.fieldworkUserId).toBe(WORKER_ID);
    });

    it('배너가 실사원·업체·대상을 서버에서 받는다', async () => {
      const proxy = await resolveFieldworkProxy(
        contextFor(WORKER_ID, 'fieldwork').user,
        surveyId,
        inviteToken,
      );
      expect(proxy).toMatchObject({
        kind: 'proxy',
        fieldworkUserId: WORKER_ID,
        fieldworkUserName: '박현우',
        resid: 1024,
      });
      expect(proxy.kind === 'proxy' && proxy.orgName).toContain('그린리서치');
      // 이름은 코어가 아니라 배너 표면이 읽는다 — 귀속만 필요한 경로가 PII 를 복호하지
      // 않게 갈라 뒀다(리뷰 지적).
      expect(
        proxy.kind === 'proxy' ? await describeProxyTarget(proxy.contactTargetId, proxy.attrs) : '',
      ).toBe('김민준');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ② 응답자 경로는 언제나 null
  // ───────────────────────────────────────────────────────────────────────────

  describe('응답자 경로', () => {
    it('세션이 없으면 같은 링크로 들어와도 귀속이 남지 않는다', async () => {
      await invite(WORKER_ID);
      const result = await responseClient(null).response.createBlank(
        entryInput(crypto.randomUUID(), inviteToken),
      );
      expect(result.kind).toBe('created');
      expect((await responseRow())?.fieldworkUserId).toBeNull();
    });

    it('내부 계정이 열어도 귀속이 남지 않는다 — 대행은 실사 유형만이다', async () => {
      const result = await responseClient(OWNER_ID, 'internal').response.createBlank(
        entryInput(crypto.randomUUID(), inviteToken),
      );
      expect(result.kind).toBe('created');
      expect((await responseRow())?.fieldworkUserId).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 자격
  // ───────────────────────────────────────────────────────────────────────────

  describe('대행 자격', () => {
    it('초대되지 않은 실사는 대행이 아니다', async () => {
      const result = await responseClient(WORKER_ID).response.createBlank(
        entryInput(crypto.randomUUID(), inviteToken),
      );
      expect(result.kind).toBe('created');
      expect((await responseRow())?.fieldworkUserId).toBeNull();
    });

    it('팀장의 파생 시야는 대행이 아니다 — 「본인도 초대돼야 한다」', async () => {
      // 소속원이 초대돼 팀장에게 열람은 열리지만, 그 열에는 writeAttempts 가 없다.
      await invite(WORKER_ID);
      expect(
        await resolveFieldworkProxy(contextFor(LEADER_ID, 'fieldwork').user, surveyId, inviteToken),
      ).toEqual({ kind: 'none' });
    });

    it('타 업체 실사는 대행이 아니다', async () => {
      await invite(WORKER_ID);
      expect(
        await resolveFieldworkProxy(
          contextFor(OUTSIDER_ID, 'fieldwork').user,
          surveyId,
          inviteToken,
        ),
      ).toEqual({ kind: 'none' });
    });

    it('초대 토큰 없이 들어오면 대행이 아니다 — 대행은 컨택을 지목해야 성립한다', async () => {
      await invite(WORKER_ID);
      expect(
        await resolveFieldworkProxy(contextFor(WORKER_ID, 'fieldwork').user, surveyId, null),
      ).toEqual({ kind: 'none' });
    });

    it('다른 설문의 토큰이면 대행이 아니다', async () => {
      await invite(WORKER_ID);
      expect(
        await resolveFieldworkProxy(
          contextFor(WORKER_ID, 'fieldwork').user,
          surveyId,
          crypto.randomUUID(),
        ),
      ).toEqual({ kind: 'none' });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ④ 이어서 대행
  // ───────────────────────────────────────────────────────────────────────────

  describe('이어서 대행', () => {
    it('응답자가 시작한 행을 실사가 재개하면 귀속이 찍힌다', async () => {
      await invite(WORKER_ID);
      const sessionId = crypto.randomUUID();
      await responseClient(null).response.createBlank(entryInput(sessionId, inviteToken));
      expect((await responseRow())?.fieldworkUserId).toBeNull();

      await responseClient(WORKER_ID).lifecycle.resume({ surveyId, sessionId, inviteToken });
      expect((await responseRow())?.fieldworkUserId).toBe(WORKER_ID);
    });

    it('실사가 시작한 행을 응답자가 이어받아도 귀속이 지워지지 않는다', async () => {
      await invite(WORKER_ID);
      const sessionId = crypto.randomUUID();
      await responseClient(WORKER_ID).response.createBlank(entryInput(sessionId, inviteToken));
      expect((await responseRow())?.fieldworkUserId).toBe(WORKER_ID);

      // 응답자 세션은 이 컬럼을 아예 넘기지 않는다 — null 로 덮어쓰면 그 응답이 대행이었다는
      // 사실이 사라진다(실제로 일부가 대행이다).
      await responseClient(null).lifecycle.resume({ surveyId, sessionId, inviteToken });
      expect((await responseRow())?.fieldworkUserId).toBe(WORKER_ID);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ④-2 진입 경로가 갈려도 귀속은 남는다 (리뷰가 짚은 세 구멍)
  // ───────────────────────────────────────────────────────────────────────────

  describe('진입 분기와 무관한 귀속', () => {
    beforeEach(async () => {
      if (!isLocalDb) return;
      await invite(WORKER_ID);
    });

    it('기존 행을 물려받는 생성에도 찍힌다 — INSERT 를 지나지 않는 분기다', async () => {
      // 응답자가 먼저 만들어 둔 활성 행이 있으면 생성 경로는 INSERT 없이 그 행을 물려받는다.
      // 귀속을 INSERT payload 에만 실으면 이 분기에서 통째로 버려진다.
      await responseClient(null).response.createBlank(
        entryInput(crypto.randomUUID(), inviteToken),
      );
      expect((await responseRow())?.fieldworkUserId).toBeNull();

      await responseClient(WORKER_ID).response.createBlank(
        entryInput(crypto.randomUUID(), inviteToken),
      );
      expect((await responseRow())?.fieldworkUserId).toBe(WORKER_ID);
    });

    it('버전 이관이 일어난 재개에도 찍힌다 — 그 분기는 touch 를 부르지 않는다', async () => {
      const oldVersionId = crypto.randomUUID();
      const newVersionId = crypto.randomUUID();
      for (const [id, versionNumber, status] of [
        [oldVersionId, 1, 'superseded'],
        [newVersionId, 2, 'published'],
      ] as const) {
        await db
          .insert(versionsTable)
          .values({
            id,
            surveyId,
            versionNumber,
            status,
            snapshot: {
              title: '2026 고객 만족도 조사',
              groups: [],
              questions: [],
              settings: {
                isPublic: true,
                allowMultipleResponses: false,
                showProgressBar: true,
                shuffleQuestions: false,
                requireLogin: false,
                thankYouMessage: '감사합니다',
              },
            },
          });
      }
      await db.update(surveysTable).set({ currentVersionId: newVersionId }).where(eq(surveysTable.id, surveyId));

      const sessionId = crypto.randomUUID();
      await responseClient(null).response.createBlank(entryInput(sessionId, inviteToken));
      // 응답 행을 옛 버전으로 되돌려 재개가 이관 분기를 타게 만든다.
      await db
        .update(responsesTable)
        .set({ versionId: oldVersionId })
        .where(eq(responsesTable.contactTargetId, targetId));

      await responseClient(WORKER_ID).lifecycle.resume({ surveyId, sessionId, inviteToken });

      const row = await responseRow();
      expect(row?.fieldworkUserId).toBe(WORKER_ID);
      // 이관 자체도 일어났어야 한다 — 아니면 이 테스트가 이관 분기를 안 지난 것이다.
      expect(row?.versionId).toBe(newVersionId);
    });

    it('초대의 컨택이 아닌 행에는 찍지 않는다', async () => {
      // 다른 컨택의 행을 지목해도 stamp 의 컨택 조건이 0행으로 접는다.
      const otherTargetId = crypto.randomUUID();
      await db.insert(targetsTable).values({
        id: otherTargetId,
        surveyId,
        resid: 2048,
        isTest: false,
        inviteToken: crypto.randomUUID(),
        inviteCode: `fpx${RUN}${Math.floor(Math.random() * 1000)}`,
      });
      const [other] = await db
        .insert(responsesTable)
        .values({
          surveyId,
          sessionId: crypto.randomUUID(),
          contactTargetId: otherTargetId,
          status: 'in_progress',
          questionResponses: {},
        })
        .returning({ id: responsesTable.id });

      const proxy = await resolveFieldworkProxy(
        contextFor(WORKER_ID, 'fieldwork').user,
        surveyId,
        inviteToken,
      );
      await stampFieldworkAttribution(other!.id, proxy);

      const [row] = await db
        .select({ fieldworkUserId: responsesTable.fieldworkUserId })
        .from(responsesTable)
        .where(eq(responsesTable.id, other!.id));
      expect(row?.fieldworkUserId).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ④-3 집계 — 대행과 직접이 갈린다 (티켓 28, D 검증 게이트)
  // ───────────────────────────────────────────────────────────────────────────

  describe('귀속 집계', () => {
    /**
     * 이 축이 묻는 것은 **쓰기 경로가 끝까지 둘을 가르는가**다. 검수·정산이 「이 설문의
     * 응답 중 몇 건이 대행인가」를 물을 때 답의 근거가 이 컬럼 하나이고, 그 컬럼은 진입
     * 분기가 여럿이라(생성·재개·물려받기·버전 이관) 한 곳만 새도 통계가 조용히 틀린다.
     *
     * 세는 쿼리는 여기 있지만 **검증 대상은 쿼리가 아니라 그 앞의 경로**다 — 응답을
     * 목으로 심으면 무엇을 세든 통과하므로, 실제 procedure 로 심는다.
     *
     * 운영 콘솔에 이 통계를 보여주는 화면은 아직 없다(티켓 27 이 남긴 것). 그래서 이
     * 테스트가 오늘은 **데이터가 그 화면을 지탱할 수 있는가**를 대신 지킨다.
     */
    it('실사 진입 3건과 응답자 직접 2건이 정확히 갈린다', async () => {
      await invite(WORKER_ID);

      const proxied: string[] = [];
      const direct: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const targetId = crypto.randomUUID();
        const token = crypto.randomUUID();
        await db.insert(targetsTable).values({
          id: targetId,
          surveyId,
          resid: 2000 + i,
          isTest: false,
          attrs: { 이름: `대상${i}` },
          inviteToken: token,
          inviteCode: `fpa${RUN}${i}${Math.floor(Math.random() * 100)}`,
        });
        // 앞 셋은 실사 세션, 뒤 둘은 응답자 세션 — 같은 표면·같은 입력이고 세션만 다르다.
        const asProxy = i < 3;
        await responseClient(asProxy ? WORKER_ID : null).response.createBlank(
          entryInput(crypto.randomUUID(), token),
        );
        (asProxy ? proxied : direct).push(targetId);
      }

      const [agg] = await db
        .select({
          total: countDistinct(responsesTable.id),
          byFieldwork: sql<number>`count(*) filter (where ${responsesTable.fieldworkUserId} is not null)::int`,
          byWorker: sql<number>`count(*) filter (where ${responsesTable.fieldworkUserId} = ${WORKER_ID})::int`,
        })
        .from(responsesTable)
        .where(inArray(responsesTable.contactTargetId, [...proxied, ...direct]));

      expect(agg).toEqual({ total: 5, byFieldwork: 3, byWorker: 3 });

      // 어느 행이 대행인지도 정확해야 한다 — 수가 맞아도 짝이 어긋나면 정산이 틀린다.
      const rows = await db
        .select({
          contactTargetId: responsesTable.contactTargetId,
          fieldworkUserId: responsesTable.fieldworkUserId,
        })
        .from(responsesTable)
        .where(inArray(responsesTable.contactTargetId, [...proxied, ...direct]));
      for (const r of rows) {
        const expected = proxied.includes(r.contactTargetId ?? '') ? WORKER_ID : null;
        expect(r.fieldworkUserId).toBe(expected);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑤ 완료 대상 거부
  // ───────────────────────────────────────────────────────────────────────────

  describe('완료된 대상', () => {
    beforeEach(async () => {
      if (!isLocalDb) return;
      await invite(WORKER_ID);
      await db.insert(responsesTable).values({
        surveyId,
        sessionId: crypto.randomUUID(),
        contactTargetId: targetId,
        isCompleted: true,
        completedAt: new Date(),
        status: 'completed',
        questionResponses: {},
      });
    });

    it('대행 진입을 서버가 거부한다 — 화면이 버튼을 지우는 것과 별개다', async () => {
      await expect(
        responseClient(WORKER_ID).response.createBlank(
          entryInput(crypto.randomUUID(), inviteToken),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('이어서 대행도 거부한다', async () => {
      await expect(
        responseClient(WORKER_ID).lifecycle.resume({
          surveyId,
          sessionId: crypto.randomUUID(),
          inviteToken,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('삭제된 완료 응답은 차단하지 않는다 — 재실사 지시가 정상 동선이다', async () => {
      await db
        .update(responsesTable)
        .set({ deletedAt: new Date() })
        .where(eq(responsesTable.contactTargetId, targetId));

      expect(
        await resolveFieldworkProxy(contextFor(WORKER_ID, 'fieldwork').user, surveyId, inviteToken),
      ).toMatchObject({ kind: 'proxy' });
    });

    it('응답자 경로는 막지 않는다 — 재응답 정책은 종전 그대로다', async () => {
      await expect(
        responseClient(null).lifecycle.resume({
          surveyId,
          sessionId: crypto.randomUUID(),
          inviteToken,
        }),
      ).resolves.toBeDefined();
    });
  });
});
