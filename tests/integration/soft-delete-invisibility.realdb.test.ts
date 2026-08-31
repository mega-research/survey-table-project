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
  surveyParticipants as participantsTable,
  surveyResponses as surveyResponsesTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { mailCampaigns as mailCampaignsTable } from '@/db/schema/mail';
import { lookupContactAttrs } from '@/server/contacts/services/contact-attrs';
import { resolveInviteCode } from '@/server/contacts/services/contact-invite';
import type { ORPCContext } from '@/server/context';
import { getQuotaConfig } from '@/server/quota/services/quota';
import { getSurveyControlFlags } from '@/server/read-models/survey-control';
import { getSurveyById } from '@/server/read-models/survey-structure';
import {
  SurveyAccessError,
  loadSurveyAccess,
  loadSurveyCapabilities,
} from '@/server/survey-access';
import { surveys as surveysProcedures } from '@/server/survey-builder/procedures/surveys';
import * as surveyReadSvc from '@/server/survey-builder/services/survey-read';
import { loadSurveyGateRow } from '@/server/survey-response/services/response-gate';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const SUPERADMIN_ID = crypto.randomUUID();
const OWNER_ID = crypto.randomUUID();
/** 타 팀 참여자 — 팀 축으로는 아무것도 없고 참여 행 하나로만 들어온다(티켓 18). */
const PARTICIPANT_ID = crypto.randomUUID();
/** 부여받은 게스트 — 팀도 소유권도 없이 부여 하나로만 들어온다(티켓 21). */
const GUEST_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();
const OTHER_TEAM_ID = crypto.randomUUID();

const ALL_USER_IDS = [OWNER_ID, SUPERADMIN_ID, PARTICIPANT_ID, GUEST_ID];

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
const participant = { id: PARTICIPANT_ID, isSuperadmin: false, userType: 'internal' as const };
const guest = { id: GUEST_ID, isSuperadmin: false, userType: 'guest' as const };

const surveyClient = (userId: string, isSuperadmin: boolean) =>
  createRouterClient(
    { surveys: surveysProcedures },
    { context: contextFor(userId, isSuperadmin) },
  );

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

  // 팀 경계를 넘는 두 통로 — 삭제가 이쪽도 닫는지가 아래 ①-b 의 질문이다.
  await db.insert(participantsTable).values([
    { surveyId, userId: PARTICIPANT_ID, kind: 'member', addedBy: OWNER_ID },
    { surveyId, userId: GUEST_ID, kind: 'guest', addedBy: OWNER_ID },
  ]);
}

async function softDelete(): Promise<void> {
  await db.update(surveysTable).set({ deletedAt: new Date() }).where(eq(surveysTable.id, surveyId));
}

describe.skipIf(!isLocalDb)('삭제된 설문 불가시성 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    for (const [id, isSuperadmin, userType] of [
      [SUPERADMIN_ID, true, 'internal'],
      [OWNER_ID, false, 'internal'],
      [PARTICIPANT_ID, false, 'internal'],
      [GUEST_ID, false, 'guest'],
    ] as const) {
      await db.insert(usersTable).values({
        id,
        name: `사용자-${id.slice(0, 4)}`,
        email: `soft-delete-${id}@example.com`,
        emailVerified: true,
        status: 'active',
        isSuperadmin,
        userType,
      });
    }
    await db.insert(teamsTable).values([
      { id: TEAM_ID, name: `삭제팀-${TEAM_ID.slice(0, 8)}` },
      { id: OTHER_TEAM_ID, name: `삭제타팀-${OTHER_TEAM_ID.slice(0, 8)}` },
    ]);
    await db.insert(teamMembersTable).values([
      { teamId: TEAM_ID, userId: OWNER_ID, role: 'member' },
      // 참여자는 **다른 팀** 사람이어야 한다 — 같은 팀에 두면 팀 축이 답을 내버려
      // 참여 행이 검증되지 않는다.
      { teamId: OTHER_TEAM_ID, userId: PARTICIPANT_ID, role: 'member' },
    ]);
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    await seedSurvey();
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, ALL_USER_IDS));
    await db.delete(teamsTable).where(inArray(teamsTable.id, [TEAM_ID, OTHER_TEAM_ID]));
    await db.delete(usersTable).where(inArray(usersTable.id, ALL_USER_IDS));
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
  // ①-b 팀 밖에서 들어오는 둘 — 참여자·게스트 (티켓 23, C 검증 게이트)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 위 블록은 **팀 축**으로 들어오는 주체만 봤다. 팀 경계를 넘는 통로는 둘 더 있고
   * (`survey_participants` 의 member·guest), 그 둘은 판정에서 팀·소유 사슬을 타지 않는다 —
   * 게스트는 아예 첫 분기에서 갈라진다(티켓 21).
   *
   * 그래서 삭제 필터가 **그 통로에도 서는가**를 따로 묻는다. 오늘은 로더가 `surveys` 에서
   * 시작해 참여 행을 LEFT JOIN 하므로 `deleted_at IS NULL` 하나가 셋을 함께 닫지만, 게스트
   * 홈처럼 「부여된 설문 목록」이 필요한 자리는 참여 행에서 시작하고 싶은 유혹이 있다 —
   * 그렇게 뒤집는 순간 삭제 필터는 설문 쪽 조인 조건으로 옮겨가고, 조건 하나만 빠뜨려도
   * 지워진 설문이 게스트에게만 계속 열린다. 그 회귀가 소유자 축 단언으로는 보이지 않는다.
   */
  describe('참여자·게스트 — 부여가 있어도 함께 닫힌다', () => {
    it('삭제 전에는 둘 다 자기 열을 갖는다', async () => {
      expect([...(await loadSurveyCapabilities(participant, surveyId))]).toContain('survey.edit');

      const before = await loadSurveyAccess(guest, surveyId);
      // 게스트 열은 둘뿐이다(스펙 §8) — 여기가 늘면 삭제와 무관하게 회귀다.
      expect([...before.capabilities].sort()).toEqual(['operations.view', 'survey.view']);
    });

    it('삭제 후 참여자는 not_found 다 — 참여 행은 그대로 남아 있는데도', async () => {
      await softDelete();

      await expect(loadSurveyCapabilities(participant, surveyId)).rejects.toMatchObject({
        reason: 'not_found',
      });

      // 행이 남아 있다는 것이 이 단언의 요점이다: 닫은 것은 삭제 필터이지 부여 소멸이 아니다.
      const rows = await db
        .select({ userId: participantsTable.userId })
        .from(participantsTable)
        .where(eq(participantsTable.surveyId, surveyId));
      expect(rows.map((r) => r.userId).sort()).toEqual([PARTICIPANT_ID, GUEST_ID].sort());
    });

    it('삭제 후 게스트도 not_found 다 — 탭이 열려 있어도 마찬가지다', async () => {
      await softDelete();

      await expect(loadSurveyAccess(guest, surveyId)).rejects.toBeInstanceOf(SurveyAccessError);
      await expect(loadSurveyAccess(guest, surveyId)).rejects.toMatchObject({
        reason: 'not_found',
      });
    });

    it('복구하면 둘 다 그대로 돌아온다 — 삭제는 부여를 지우지 않았다', async () => {
      await softDelete();
      await surveyClient(SUPERADMIN_ID, true).surveys.restore({ surveyId });

      expect([...(await loadSurveyCapabilities(participant, surveyId))]).toContain('survey.edit');
      expect([...(await loadSurveyAccess(guest, surveyId)).capabilities].sort()).toEqual([
        'operations.view',
        'survey.view',
      ]);
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
  // ②-b 예약 메일 — 삭제가 발송을 멈춘다
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * hard delete 시절에는 CASCADE 가 캠페인을 함께 지워 Inngest dispatcher 가 볼 것이 없었다.
   * soft delete 는 그 행을 살려두므로 **삭제가 직접 접지 않으면** 지워진 설문의 초대 메일이
   * 계속 나가고 과금되며, 수신자는 열리지 않는 링크를 받는다.
   *
   * 실 DB 인 이유는 이 파일의 다른 축과 같다 — 확인하려는 것이 UPDATE 의 WHERE 절
   * (`survey_id` + status IN (queued, sending))이라 목으로는 조건 유무가 드러나지 않는다.
   */
  describe('예약·진행 중 메일 — 삭제가 접는다', () => {
    async function seedCampaign(
      status: 'draft' | 'queued' | 'sending' | 'completed',
      runNumber: number,
    ): Promise<string> {
      const id = crypto.randomUUID();
      await db.insert(mailCampaignsTable).values({
        id,
        surveyId,
        runNumber,
        title: `캠페인-${status}`,
        kind: 'bulk',
        status,
        subjectSnapshot: '제목',
        bodyHtmlSnapshot: '<p>본문</p>',
        fromLocalSnapshot: 'noreply',
        fromNameSnapshot: '조사',
      });
      return id;
    }

    async function statusOf(id: string): Promise<string | undefined> {
      const [row] = await db
        .select({ status: mailCampaignsTable.status })
        .from(mailCampaignsTable)
        .where(eq(mailCampaignsTable.id, id));
      return row?.status;
    }

    it('queued·sending 캠페인이 삭제와 같은 트랜잭션에서 취소된다', async () => {
      const queued = await seedCampaign('queued', 1);
      const sending = await seedCampaign('sending', 2);

      await surveyClient(OWNER_ID, false).surveys.delete({ surveyId });

      expect(await statusOf(queued)).toBe('cancelled');
      // 운영자 취소(cancelCampaign)는 sending 을 못 접지만 삭제는 접는다 — 보낼 설문이 없다.
      expect(await statusOf(sending)).toBe('cancelled');
    });

    it('draft·completed 는 건드리지 않는다 — 발송 대기가 아닌 것까지 덮어쓰지 않는다', async () => {
      const draft = await seedCampaign('draft', 3);
      const completed = await seedCampaign('completed', 4);

      await surveyClient(OWNER_ID, false).surveys.delete({ surveyId });

      expect(await statusOf(draft)).toBe('draft');
      expect(await statusOf(completed)).toBe('completed');
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
