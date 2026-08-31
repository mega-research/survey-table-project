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
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  contactTargets as targetsTable,
  fieldworkOrgs as orgsTable,
  surveyParticipants as participantsTable,
  surveyResponses as responsesTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import type { ORPCContext } from '@/server/context';
import { resolveFieldworkProxy } from '@/server/fieldwork-proxy';
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
async function responseRow(): Promise<{ id: string; fieldworkUserId: string | null } | undefined> {
  const [row] = await db
    .select({ id: responsesTable.id, fieldworkUserId: responsesTable.fieldworkUserId })
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
        contactLabel: '김민준',
      });
      expect(proxy.kind === 'proxy' && proxy.orgName).toContain('그린리서치');
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
