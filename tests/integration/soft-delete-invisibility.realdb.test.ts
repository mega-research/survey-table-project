/**
 * soft delete 음성 스위트 — 삭제된 설문은 어디에서도 열리지 않는다 (역할 모델 v2 티켓 17).
 *
 * 실 DB 인 이유가 이 파일의 전부다. 확인하려는 것이 **WHERE 절에 `deleted_at` 이 들어 있는가**
 * 인데, 목이 돌려주는 행은 언제나 테스트가 정한 행이라 조건이 있든 없든 같은 결과가 나온다
 * (티켓 15 가 하위 행 축을 realdb 로 보낸 것과 같은 이유). 표면 목록의 출처는
 * `tests/helpers/deleted-survey-surfaces.ts` 이고, 그 목록이 라우터와 어긋나지 않는지는
 * `soft-delete-surface-inventory.test.ts` 가 기본 게이트에서 본다.
 *
 * 세 축을 본다.
 *  ① **관문이 있는 내부 표면** — capability 코어 하나가 `deleted_at IS NULL` 로 조회하므로
 *     표면마다가 아니라 코어를 확인한다. 여기가 무너지면 티켓 09~11 이 배선한 전 표면이 함께
 *     열린다.
 *  ② **관문이 없는 응답자(pub) 경로** — 각자 조건을 걸어야 한다. 슬러그·비공개 토큰·미리보기
 *     토큰은 삭제된 설문을 여는 마지막 열쇠라 특히 그렇다.
 *  ③ **데이터는 남는다** — 삭제가 파괴가 아니어야 복구가 성립한다(스펙 §4 「삭제 전제」).
 *     응답·컨택·질문·버전 행을 세어 확인하고, 복구 뒤 ①②가 그대로 되돌아오는지 본다.
 */
import { createRouterClient } from '@orpc/server';
import { PUB_SURVEY_SURFACES } from '@tests/helpers/deleted-survey-surfaces';
import { count, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  contactTargets as contactTargetsTable,
  questions as questionsTable,
  surveyResponses as surveyResponsesTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { lookupContactAttrs } from '@/server/contacts/services/contact-attrs';
import { resolveInviteCode } from '@/server/contacts/services/contact-invite';
import type { ORPCContext } from '@/server/context';
import { getQuotaConfig } from '@/server/quota/services/quota';
import { getSurveyControlFlags } from '@/server/read-models/survey-control';
import { getSurveyById } from '@/server/read-models/survey-structure';
import { SurveyAccessError, loadSurveyCapabilities } from '@/server/survey-access';
import { surveys as surveysProcedures } from '@/server/survey-builder/procedures/surveys';
import * as surveyReadSvc from '@/server/survey-builder/services/survey-read';
import { loadSurveyGateRow } from '@/server/survey-response/services/response-gate';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const SUPERADMIN_ID = crypto.randomUUID();
const OWNER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();

const SLUG = `soft-delete-${TEAM_ID.slice(0, 8)}`;
const PRIVATE_TOKEN = crypto.randomUUID();
const PREVIEW_TOKEN = crypto.randomUUID();
const INVITE_TOKEN = crypto.randomUUID();
const INVITE_CODE = `sd${TEAM_ID.slice(0, 8)}`;

let surveyId = '';
let responseId = '';
let contactId = '';
let questionId = '';

function contextFor(userId: string, isSuperadmin: boolean): ORPCContext {
  return {
    db,
    user: {
      id: userId,
      email: `soft-delete-${userId}@example.com`,
      name: '삭제테스터',
      status: 'active',
      isSuperadmin,
      userType: 'internal',
    },
  };
}

const owner = { id: OWNER_ID, isSuperadmin: false, userType: 'internal' as const };

/** 설문 + 질문 + 응답 + 컨택을 한 벌 심는다 — 삭제가 무엇을 보존하는지 세려면 하위 행이 필요하다. */
async function seedSurvey(): Promise<void> {
  surveyId = crypto.randomUUID();
  await db.insert(surveysTable).values({
    id: surveyId,
    title: '삭제 대상 조사',
    slug: SLUG,
    privateToken: PRIVATE_TOKEN,
    previewToken: PREVIEW_TOKEN,
    isPublic: true,
    status: 'published',
    teamId: TEAM_ID,
    visibility: 'team',
    assignmentStatus: 'assigned',
    ownerUserId: OWNER_ID,
    createdBy: OWNER_ID,
  });

  questionId = crypto.randomUUID();
  await db.insert(questionsTable).values({
    id: questionId,
    surveyId,
    type: 'text',
    title: '이름을 알려주세요',
    order: 0,
  });

  responseId = crypto.randomUUID();
  await db.insert(surveyResponsesTable).values({
    id: responseId,
    surveyId,
    sessionId: crypto.randomUUID(),
    questionResponses: {},
    isCompleted: true,
    status: 'completed',
  });

  contactId = crypto.randomUUID();
  await db.insert(contactTargetsTable).values({
    id: contactId,
    surveyId,
    resid: 1,
    inviteToken: INVITE_TOKEN,
    inviteCode: INVITE_CODE,
    attrs: { 이름: '홍길동' },
  });
}

async function softDelete(): Promise<void> {
  await db.update(surveysTable).set({ deletedAt: new Date() }).where(eq(surveysTable.id, surveyId));
}

describe.skipIf(!isLocalDb)('삭제된 설문 불가시성 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    for (const [id, isSuperadmin] of [
      [SUPERADMIN_ID, true],
      [OWNER_ID, false],
    ] as const) {
      await db.insert(usersTable).values({
        id,
        name: `사용자-${id.slice(0, 4)}`,
        email: `soft-delete-${id}@example.com`,
        emailVerified: true,
        status: 'active',
        isSuperadmin,
        userType: 'internal',
      });
    }
    await db.insert(teamsTable).values({ id: TEAM_ID, name: `삭제팀-${TEAM_ID.slice(0, 8)}` });
    await db.insert(teamMembersTable).values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'member' });
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    await seedSurvey();
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    await db
      .delete(teamMembersTable)
      .where(inArray(teamMembersTable.userId, [OWNER_ID, SUPERADMIN_ID]));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    await db.delete(usersTable).where(inArray(usersTable.id, [OWNER_ID, SUPERADMIN_ID]));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ① 관문이 있는 내부 표면 — 코어 하나가 전부를 접는다
  // ───────────────────────────────────────────────────────────────────────────

  describe('내부 표면 — capability 코어가 접는다', () => {
    it('삭제 전에는 소유자가 전권을 갖는다', async () => {
      const caps = await loadSurveyCapabilities(owner, surveyId);
      expect([...caps]).toContain('survey.edit');
    });

    it('삭제 후에는 소유자·슈퍼어드민 모두 not_found 다', async () => {
      await softDelete();

      // 없는 설문과 같은 사유여야 한다 — forbidden 이면 삭제된 설문의 존재가 드러난다.
      await expect(loadSurveyCapabilities(owner, surveyId)).rejects.toBeInstanceOf(
        SurveyAccessError,
      );
      await expect(
        loadSurveyCapabilities({ ...owner, id: SUPERADMIN_ID, isSuperadmin: true }, surveyId),
      ).rejects.toMatchObject({ reason: 'not_found' });
    });

    it('목록에서 사라진다 — 팀 범위와 시스템 전체 보기 둘 다', async () => {
      const before = await surveyReadSvc.getSurveyListWithCounts(owner, TEAM_ID);
      expect(before.surveys.map((s) => s.id)).toContain(surveyId);

      await softDelete();

      const afterTeam = await surveyReadSvc.getSurveyListWithCounts(owner, TEAM_ID);
      expect(afterTeam.surveys.map((s) => s.id)).not.toContain(surveyId);

      const superadmin = { id: SUPERADMIN_ID, isSuperadmin: true, userType: 'internal' as const };
      const afterSystem = await surveyReadSvc.getSurveyListWithCounts(superadmin, 'system');
      expect(afterSystem.surveys.map((s) => s.id)).not.toContain(surveyId);
    });

    it('공통 입구 getSurveyById 가 닫힌다 — 빌더 상세·운영 RSC·미리보기가 함께 닫힌다', async () => {
      expect((await getSurveyById(surveyId))?.id).toBe(surveyId);
      await softDelete();
      expect(await getSurveyById(surveyId)).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ② 관문이 없는 응답자(pub) 경로 — 각자 조건을 걸어야 한다
  // ───────────────────────────────────────────────────────────────────────────

  describe('응답자 경로 — 토큰을 알아도 열리지 않는다', () => {
    it('슬러그·비공개 토큰·미리보기 토큰·초대 코드 전부 막힌다', async () => {
      // 삭제 전에는 넷 다 열린다 — 그래야 삭제가 무언가를 닫았다는 뜻이 된다.
      expect(await surveyReadSvc.getSurveyBySlug({ slug: SLUG })).toBeDefined();
      expect(await surveyReadSvc.getSurveyByPrivateToken({ token: PRIVATE_TOKEN })).toBeDefined();
      expect(await surveyReadSvc.getSurveyByPreviewToken({ token: PREVIEW_TOKEN })).toBeDefined();
      expect(await resolveInviteCode(INVITE_CODE)).not.toBeNull();

      await softDelete();

      expect(await surveyReadSvc.getSurveyBySlug({ slug: SLUG })).toBeUndefined();
      expect(await surveyReadSvc.getSurveyByPrivateToken({ token: PRIVATE_TOKEN })).toBeUndefined();
      expect(await surveyReadSvc.getSurveyByPreviewToken({ token: PREVIEW_TOKEN })).toBeUndefined();
      expect(await resolveInviteCode(INVITE_CODE)).toBeNull();
    });

    it('응답 페이지 조회(forResponse)가 null 이 된다', async () => {
      expect(await surveyReadSvc.getSurveyForResponse({ surveyId })).not.toBeNull();
      await softDelete();
      expect(await surveyReadSvc.getSurveyForResponse({ surveyId })).toBeNull();
    });

    it('초대 토큰 attrs 조회가 null 이 된다 — PII 가 새지 않는다', async () => {
      expect(await lookupContactAttrs({ surveyId, inviteToken: INVITE_TOKEN })).toEqual({
        이름: '홍길동',
      });
      await softDelete();
      expect(await lookupContactAttrs({ surveyId, inviteToken: INVITE_TOKEN })).toBeNull();
    });

    /**
     * 슬러그만 방향이 반대다 — 감추는 것이 아니라 자리를 지킨다. `surveys.slug` 가 UNIQUE 라,
     * 삭제됐다고 내주면 다른 설문이 가져가고 그때부터 복구가 제약 위반으로 영영 실패한다.
     */
    it('슬러그는 삭제 후에도 예약된 채 남는다 — 복구가 제약 위반으로 막히지 않게', async () => {
      await softDelete();
      expect(await surveyReadSvc.isSlugAvailable({ slug: SLUG })).toBe(false);
    });

    it('쿼터 플랜 조회가 null 이 된다 — 삭제된 설문이 마감 계산을 이어가지 않는다', async () => {
      await db
        .update(surveysTable)
        .set({ quotaConfig: { enabled: true, dimensions: [], cells: [], closedMessage: null } })
        .where(eq(surveysTable.id, surveyId));
      expect(await getQuotaConfig(surveyId)).not.toBeNull();

      await softDelete();
      expect(await getQuotaConfig(surveyId)).toBeNull();
    });

    /**
     * 인벤토리에 등재된 pub 표면이 실제로 이 스위트가 다루는 경로에 대응하는지 못 박는다.
     * 등재만 하고 케이스를 안 쓰면 목록이 서류가 되므로, 개수와 사유 존재를 함께 본다.
     */
    it('인벤토리의 pub 표면 전부가 이 스위트의 축 안에 있다', () => {
      const paths = Object.keys(PUB_SURVEY_SURFACES);
      expect(paths.length).toBeGreaterThan(0);
      // 응답 생성 계열은 게이트가, 조회 계열은 조회 조건이 막는다 — 아래 두 케이스가 각 축의 대표다.
      expect(paths).toContain('surveyResponse.response.createWithFirstAnswer');
      expect(paths).toContain('surveyBuilder.publicRead.forResponse');
    });

    /**
     * **진행 중 응답의 쓰기는 계속된다 — 지금은 의도된 동작이다**(deleted-survey-surfaces 주석).
     *
     * 삭제가 soft delete 라 그 응답 행은 보존되고, 제출만 게이트가 막는다. 응답자는 쓰던 것을
     * 잃지 않고 복구되면 그대로 이어갈 수 있다. 이 축으로는 아무것도 노출되지 않으므로 티켓의
     * 요구(미노출 + 데이터 보존)는 지켜진다.
     *
     * 여기 적어 두는 이유는 **선택이었다는 사실을 남기기 위해서**다. 언젠가 막기로 정하면 이
     * 케이스가 그 자리에서 빨개져, 응답자 화면 문구까지 함께 정하도록 강제한다.
     */
    it('삭제돼도 진행 중 응답의 제어 플래그 조회만 닫히고 행은 살아 있다', async () => {
      await softDelete();

      // 제어 플래그는 닫힌다 — 이것이 fail-open 의 입력이다.
      expect(await getSurveyControlFlags(surveyId)).toBeNull();
      // 응답 행은 그대로다. 제출 차단은 loadSurveyGateRow 가 진다.
      const [row] = await db
        .select({ id: surveyResponsesTable.id })
        .from(surveyResponsesTable)
        .where(eq(surveyResponsesTable.id, responseId));
      expect(row?.id).toBe(responseId);
      await expect(loadSurveyGateRow(surveyId)).rejects.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 데이터는 남는다 — 삭제가 파괴가 아니어야 복구가 성립한다
  // ───────────────────────────────────────────────────────────────────────────

  describe('보존과 복구', () => {
    async function childCounts() {
      const [q] = await db
        .select({ value: count() })
        .from(questionsTable)
        .where(eq(questionsTable.surveyId, surveyId));
      const [r] = await db
        .select({ value: count() })
        .from(surveyResponsesTable)
        .where(eq(surveyResponsesTable.surveyId, surveyId));
      const [c] = await db
        .select({ value: count() })
        .from(contactTargetsTable)
        .where(eq(contactTargetsTable.surveyId, surveyId));
      return { questions: q?.value ?? 0, responses: r?.value ?? 0, contacts: c?.value ?? 0 };
    }

    it('설문 행과 질문·응답·컨택이 그대로 남는다', async () => {
      const before = await childCounts();
      expect(before).toEqual({ questions: 1, responses: 1, contacts: 1 });

      await softDelete();

      // 예전 구현은 여기서 CASCADE 로 전부 사라졌다 — 그것이 티켓 17 이 청산한 갭이다.
      expect(await childCounts()).toEqual(before);
      const [row] = await db
        .select({ deletedAt: surveysTable.deletedAt, teamId: surveysTable.teamId })
        .from(surveysTable)
        .where(eq(surveysTable.id, surveyId));
      expect(row?.deletedAt).not.toBeNull();
      // 팀·소유자는 삭제가 건드리지 않는다 — 복구가 되돌릴 것이 없어야 "그대로" 가 성립한다.
      expect(row?.teamId).toBe(TEAM_ID);
    });

    it('슈퍼어드민 복구로 목록·상세·응답자 경로가 모두 되돌아온다', async () => {
      await softDelete();
      const client = createRouterClient(
        { surveys: surveysProcedures },
        { context: contextFor(SUPERADMIN_ID, true) },
      );

      await client.surveys.restore({ surveyId });

      const list = await surveyReadSvc.getSurveyListWithCounts(owner, TEAM_ID);
      expect(list.surveys.map((s) => s.id)).toContain(surveyId);
      expect([...(await loadSurveyCapabilities(owner, surveyId))]).toContain('survey.edit');
      expect(await surveyReadSvc.getSurveyBySlug({ slug: SLUG })).toBeDefined();
    });

    it('일반 사용자는 복구할 수 없다 — 슈퍼어드민 베이스가 막는다', async () => {
      await softDelete();
      const client = createRouterClient(
        { surveys: surveysProcedures },
        { context: contextFor(OWNER_ID, false) },
      );

      await expect(client.surveys.restore({ surveyId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('이미 살아 있는 설문의 복구는 NOT_FOUND — 조용한 성공이 아니다', async () => {
      const client = createRouterClient(
        { surveys: surveysProcedures },
        { context: contextFor(SUPERADMIN_ID, true) },
      );

      await expect(client.surveys.restore({ surveyId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('휴지통 목록은 슈퍼어드민의 시스템 전체 보기에서만 열린다', async () => {
      await softDelete();
      const superadmin = { id: SUPERADMIN_ID, isSuperadmin: true, userType: 'internal' as const };

      const trash = await surveyReadSvc.getSurveyListWithCounts(superadmin, 'system', {
        deleted: true,
      });
      expect(trash.surveys.map((s) => s.id)).toContain(surveyId);
      expect(trash.surveys.find((s) => s.id === surveyId)?.deletedAt).not.toBeNull();
      expect(trash.deletedCount).toBeGreaterThan(0);

      // 팀 범위에서는 슈퍼어드민이라도 열리지 않는다 — 휴지통은 팀 경계로 좁힐 수 없다.
      await expect(
        surveyReadSvc.getSurveyListWithCounts(superadmin, TEAM_ID, { deleted: true }),
      ).rejects.toBeInstanceOf(SurveyAccessError);
      // 일반 사용자는 시스템 범위 자체를 못 고른다(work-scope 가 먼저 거부한다).
      await expect(
        surveyReadSvc.getSurveyListWithCounts(owner, TEAM_ID, { deleted: true }),
      ).rejects.toBeInstanceOf(SurveyAccessError);
    });

    it('일반 목록에는 deletedCount 가 오지 않는다 — 휴지통 유무 자체가 권한이다', async () => {
      const asOwner = await surveyReadSvc.getSurveyListWithCounts(owner, TEAM_ID);
      expect(asOwner.deletedCount).toBeNull();

      const superadmin = { id: SUPERADMIN_ID, isSuperadmin: true, userType: 'internal' as const };
      const asSuperadminTeam = await surveyReadSvc.getSurveyListWithCounts(superadmin, TEAM_ID);
      expect(asSuperadminTeam.deletedCount).toBeNull();

      const asSuperadminSystem = await surveyReadSvc.getSurveyListWithCounts(superadmin, 'system');
      expect(asSuperadminSystem.deletedCount).not.toBeNull();
    });
  });
});
