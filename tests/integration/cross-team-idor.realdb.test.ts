/**
 * 교차 팀 IDOR 실 DB 왕복 — **설문 관문이 통과한 뒤** 남는 축 (역할 모델 v2 티켓 15).
 *
 * 형제 스위트(cross-team-idor-rpc)는 "타 팀 설문 id 를 넣으면 멈추는가" 를 전 표면에서 본다.
 * 그것이 막고 나면 남는 IDOR 는 하나다 — **내 설문 + 남의 하위 행**:
 *
 *     contacts.attempts.add({ surveyId: 내_설문, contactTargetId: 남의_컨택 })
 *
 * 관문은 통과한다(내 설문이 맞다). 그래서 서비스의 WHERE 에 surveyId 가 함께 들어 있지 않으면
 * 남의 팀 컨택·응답·템플릿·질문이 그대로 수정·삭제된다. **하위 행 id 는 전역 PK 라** FK 도
 * 설문 경계를 모른다(Codex 하드닝의 「하위 행은 전역 PK 다」와 같은 축).
 *
 * 이건 목으로는 볼 수 없다 — 목이 돌려주는 행은 언제나 테스트가 정한 행이라 WHERE 절이
 * 무엇이든 통과한다. 실 DB 에서 **행이 살아남았는지**를 직접 확인해야 판정이 선다.
 *
 * 함께 보는 것: 판정 코어를 실 멤버십·실 설문 행 위에서 물어보는 매트릭스. 순수 함수
 * 테스트(survey-access.test)는 입력을 손으로 만들지만 여기서는 DB 가 만든다.
 *
 * 실행 조건: DATABASE_URL 이 127.0.0.1/localhost 일 때만 (pnpm test:integration).
 */
import { createRouterClient } from '@orpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  contactAttempts,
  contactTargets,
  mailCampaigns,
  mailTemplates,
  questionGroups,
  questions,
  surveyGroups as surveyGroupsTable,
  surveyResponses,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { loadSurveyCapabilities } from '@/server/survey-access';
import { getSurveyListWithCounts } from '@/server/survey-builder/services/survey-read';
import { attempts } from '@/server/contacts/procedures/attempts';
import { campaigns } from '@/server/mail/procedures/campaigns';
import { preview } from '@/server/mail/procedures/preview';
import { unsubscribe } from '@/server/mail/procedures/unsubscribe';
import { edit } from '@/server/survey-response/procedures/edit';
import { targets } from '@/server/contacts/procedures/targets';
import { groups as questionGroupProcedures } from '@/server/survey-builder/procedures/groups';
import { questions as questionProcedures } from '@/server/survey-builder/procedures/questions';
import { templates } from '@/server/mail/procedures/templates';
import { manage } from '@/server/survey-response/procedures/manage';
import { surveyGroups } from '@/server/workspace/procedures/survey-groups';
import type { SurveyCapability } from '@/shared/contracts/workspace';
import { internalActorContext } from '@tests/helpers/rpc-context';

/**
 * 콘솔 서비스 일부는 요청 스코프(`next/headers`)를 읽어 실/테스트 파티션을 정한다.
 * realdb 스위트는 요청 컨텍스트 밖에서 돌기 때문에 빈 쿠키·헤더를 준다 — 판정은 결국
 * 설문의 testModeEnabled 로 떨어지므로 이 목이 팀 경계 검증에 개입하지 않는다.
 */
/**
 * 데이터 스코프 판정은 「이 뷰어가 게스트인가」를 세션으로 묻는다. 이 스위트는 주체를
 * 직접 만들어 procedure 컨텍스트로 넣으므로 세션이 없다 — 게스트가 아님만 알려 준다.
 * 팀 경계 판정은 컨텍스트의 user 로 돌아가므로 이 목이 개입하지 않는다.
 */
vi.mock('@/lib/auth/guest-viewer', () => ({ isGuestViewer: async () => false }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () => new Headers(),
}));

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const SUPERADMIN_ID = '5c000000-0000-4000-8000-0000000ad001';
/** A팀 팀장 — 자기 팀 설문에는 전권이라 「관문은 통과한다」를 만드는 주체. */
const A_LEADER_ID = '5c000000-0000-4000-8000-0000000a0001';
/** A팀 팀원 — 팀 공개 설문만, 그것도 응답·컨택·메일 없이 본다. */
const A_MEMBER_ID = '5c000000-0000-4000-8000-0000000a0002';
/** B팀 팀장 — 피해자 쪽. */
const B_LEADER_ID = '5c000000-0000-4000-8000-0000000b0001';
/** 팀 미배치 — 어디에도 속하지 않는다. */
const UNASSIGNED_ID = '5c000000-0000-4000-8000-0000000c0001';

const createdUserIds = [SUPERADMIN_ID, A_LEADER_ID, A_MEMBER_ID, B_LEADER_ID, UNASSIGNED_ID];
const createdTeamIds: string[] = [];
const createdSurveyIds: string[] = [];

/** A팀 팀장으로 부르는 클라이언트 — 자기 팀 설문에서는 전권이다. */
const aLeader = createRouterClient(
  {
    targets,
    attempts,
    templates,
    campaigns,
    preview,
    unsubscribe,
    edit,
    manage,
    questions: questionProcedures,
    questionGroups: questionGroupProcedures,
    surveyGroups,
  },
  { context: internalActorContext({ id: A_LEADER_ID }) },
);

interface Fixture {
  teamAId: string;
  teamBId: string;
  /** A팀 팀 공개 설문 — 공격자가 정당하게 다룰 수 있는 설문. */
  surveyAId: string;
  /** A팀 invite_only 설문 — 팀원에게만 숨긴다. */
  surveyAHiddenId: string;
  /** B팀 설문 — 하위 행의 주인. */
  surveyBId: string;
  /** 배치 대기 설문 — 팀이 정해지기 전에는 아무도 못 연다. */
  surveyPendingId: string;
  /** A팀 설문 그룹 — 담기의 목적지. */
  groupAId: string;
  contactBId: string;
  responseBId: string;
  templateBId: string;
  campaignBId: string;
  attemptBId: string;
  questionBId: string;
  questionGroupBId: string;
}

let fx: Fixture;

async function seedUser(id: string, isSuperadmin: boolean): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: `사용자-${id.slice(-4)}`,
    email: `idor-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin,
    userType: 'internal',
  });
}

async function seedTeam(label: string): Promise<string> {
  const teamId = crypto.randomUUID();
  await db.insert(teamsTable).values({ id: teamId, name: `IDOR-${label}-${teamId.slice(0, 8)}` });
  createdTeamIds.push(teamId);
  return teamId;
}

async function seedSurvey(input: {
  teamId: string | null;
  ownerUserId: string | null;
  visibility?: 'team' | 'invite_only';
  assignmentStatus?: 'assigned' | 'assignment_pending';
  title: string;
}): Promise<string> {
  const surveyId = crypto.randomUUID();
  await db.insert(surveysTable).values({
    id: surveyId,
    title: input.title,
    teamId: input.teamId,
    visibility: input.visibility ?? 'team',
    assignmentStatus: input.assignmentStatus ?? 'assigned',
    ownerUserId: input.ownerUserId,
    createdBy: input.ownerUserId,
    isPublic: true,
    status: 'published',
  });
  createdSurveyIds.push(surveyId);
  return surveyId;
}

describe.skipIf(!isLocalDb)('교차 팀 IDOR (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(SUPERADMIN_ID, true);
    for (const id of [A_LEADER_ID, A_MEMBER_ID, B_LEADER_ID, UNASSIGNED_ID]) {
      await seedUser(id, false);
    }

    const teamAId = await seedTeam('A');
    const teamBId = await seedTeam('B');
    await db.insert(teamMembersTable).values([
      { teamId: teamAId, userId: A_LEADER_ID, role: 'leader' },
      { teamId: teamAId, userId: A_MEMBER_ID, role: 'member' },
      { teamId: teamBId, userId: B_LEADER_ID, role: 'leader' },
    ]);

    const surveyAId = await seedSurvey({
      teamId: teamAId,
      ownerUserId: A_LEADER_ID,
      title: 'A팀 공개 설문',
    });
    const surveyAHiddenId = await seedSurvey({
      teamId: teamAId,
      ownerUserId: A_LEADER_ID,
      visibility: 'invite_only',
      title: 'A팀 비공개 설문',
    });
    const surveyBId = await seedSurvey({
      teamId: teamBId,
      ownerUserId: B_LEADER_ID,
      title: 'B팀 설문',
    });
    const surveyPendingId = await seedSurvey({
      teamId: null,
      ownerUserId: B_LEADER_ID,
      assignmentStatus: 'assignment_pending',
      title: '배치 대기 설문',
    });

    const groupAId = crypto.randomUUID();
    await db.insert(surveyGroupsTable).values({
      id: groupAId,
      teamId: teamAId,
      name: 'A팀 폴더',
      order: 0,
      createdBy: A_LEADER_ID,
    });

    // B팀 설문에 딸린 하위 행들 — 이 스위트가 지키려는 대상.
    const contactBId = crypto.randomUUID();
    await db.insert(contactTargets).values({
      id: contactBId,
      surveyId: surveyBId,
      resid: 1,
      inviteCode: `idor-${contactBId.slice(0, 8)}`,
      attrs: { 이름: 'B팀 응답자' },
    });

    const responseBId = crypto.randomUUID();
    await db.insert(surveyResponses).values({
      id: responseBId,
      surveyId: surveyBId,
      questionResponses: {},
      sessionId: `idor-${responseBId.slice(0, 8)}`,
      isCompleted: true,
      status: 'completed',
    });

    const attemptBId = crypto.randomUUID();
    await db.insert(contactAttempts).values({
      id: attemptBId,
      contactTargetId: contactBId,
      attemptNo: 1,
      resultCode: '부재',
    });

    const templateBId = crypto.randomUUID();
    await db.insert(mailTemplates).values({
      id: templateBId,
      surveyId: surveyBId,
      name: 'B팀 템플릿',
      subject: 'B팀',
      bodyHtml: '<p>B팀</p>',
    });

    const campaignBId = crypto.randomUUID();
    await db.insert(mailCampaigns).values({
      id: campaignBId,
      surveyId: surveyBId,
      mailTemplateId: templateBId,
      runNumber: 1,
      kind: 'bulk',
      title: 'B팀 캠페인',
      subjectSnapshot: 'B팀',
      bodyHtmlSnapshot: '<p>B팀</p>',
      fromLocalSnapshot: 'no-reply',
      fromNameSnapshot: 'B팀',
      status: 'draft',
      createdBy: B_LEADER_ID,
    });

    const questionGroupBId = crypto.randomUUID();
    await db.insert(questionGroups).values({
      id: questionGroupBId,
      surveyId: surveyBId,
      name: 'B팀 문항 그룹',
      order: 0,
    });

    const questionBId = crypto.randomUUID();
    await db.insert(questions).values({
      id: questionBId,
      surveyId: surveyBId,
      type: 'text',
      title: 'B팀 질문',
      order: 0,
    });

    fx = {
      teamAId,
      teamBId,
      surveyAId,
      surveyAHiddenId,
      surveyBId,
      surveyPendingId,
      groupAId,
      contactBId,
      responseBId,
      templateBId,
      campaignBId,
      attemptBId,
      questionBId,
      questionGroupBId,
    };
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    // 설문 하위 행은 FK CASCADE 가 함께 지운다. 그룹·팀·사용자는 RESTRICT 라 순서가 있다.
    await db.delete(surveyGroupsTable).where(inArray(surveyGroupsTable.teamId, createdTeamIds));
    if (createdSurveyIds.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, createdSurveyIds));
    }
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.teamId, createdTeamIds));
    await db.delete(teamsTable).where(inArray(teamsTable.id, createdTeamIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 판정 매트릭스 — 실 멤버십·실 설문 행 위에서
  // ───────────────────────────────────────────────────────────────────────────

  describe('capability 판정을 실 데이터로 물어본다', () => {
    async function capsOf(userId: string, surveyId: string, isSuperadmin = false) {
      return loadSurveyCapabilities(
        { id: userId, isSuperadmin, userType: 'internal' },
        surveyId,
      );
    }

    it('A팀 팀장은 자기 팀 설문에 전권, B팀 설문에는 아무것도 없다', async () => {
      const own = await capsOf(A_LEADER_ID, fx.surveyAId);
      expect(own.has('survey.edit')).toBe(true);
      expect(own.has('contacts.manage')).toBe(true);
      expect(own.has('export.download')).toBe(true);

      const foreign = await capsOf(A_LEADER_ID, fx.surveyBId);
      expect(foreign.size).toBe(0);
    });

    it('A팀 팀원은 팀 공개 설문만, 그것도 응답·컨택·메일 없이 본다', async () => {
      const open = await capsOf(A_MEMBER_ID, fx.surveyAId);
      expect(open.has('survey.view')).toBe(true);
      expect(open.has('survey.edit')).toBe(true);
      expect(open.has('responses.view')).toBe(false);
      expect(open.has('contacts.view')).toBe(false);
      expect(open.has('mail.view')).toBe(false);
      expect(open.has('export.download')).toBe(false);

      // invite_only 는 **팀원에게만** 숨긴다 — 같은 팀 팀장은 그대로 본다.
      expect((await capsOf(A_MEMBER_ID, fx.surveyAHiddenId)).size).toBe(0);
      expect((await capsOf(A_LEADER_ID, fx.surveyAHiddenId)).has('survey.edit')).toBe(true);
    });

    it('팀 미배치 사용자는 어느 설문도 열지 못한다', async () => {
      for (const surveyId of [fx.surveyAId, fx.surveyBId, fx.surveyAHiddenId]) {
        expect((await capsOf(UNASSIGNED_ID, surveyId)).size).toBe(0);
      }
    });

    it('배치 대기 설문은 소유자에게도 닫히고 슈퍼어드민만 연다', async () => {
      // 소유자는 B팀 팀장이지만 팀이 정해지기 전에는 아무도 못 연다(ADR-0006).
      expect((await capsOf(B_LEADER_ID, fx.surveyPendingId)).size).toBe(0);
      expect((await capsOf(SUPERADMIN_ID, fx.surveyPendingId, true)).size).toBeGreaterThan(0);
    });

    it('슈퍼어드민은 팀 소속이 없어도 전 설문에 선다', async () => {
      const caps = await capsOf(SUPERADMIN_ID, fx.surveyBId, true);
      const expected: SurveyCapability[] = ['survey.view', 'survey.delete', 'export.download'];
      for (const capability of expected) expect(caps.has(capability)).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 하위 행 주입 — 관문이 통과한 뒤에도 남의 팀 행은 움직이지 않는다
  // ───────────────────────────────────────────────────────────────────────────

  describe('내 설문 + 남의 하위 행 = 아무 일도 일어나지 않는다', () => {
    /** 관문·스코프 조건이 낸 거부. 500 은 여기 없다 — 사고와 거부를 가르는 목록이다. */
    const REFUSAL_CODES = new Set(['NOT_FOUND', 'FORBIDDEN', 'CONFLICT', 'BAD_REQUEST']);

    /**
     * 거부의 **코드**는 표면마다 다르다 — 없는 행이면 NOT_FOUND, 소속 불일치면 CONFLICT.
     * 지켜야 하는 계약은 코드가 아니라 「남의 행이 그대로다」이므로 여기서는 거부만 확인하고
     * 행의 생존은 각 검사가 DB 를 직접 읽어 확인한다.
     */
    async function expectRejected(promise: Promise<unknown>): Promise<void> {
      const error = await promise.then(
        (value) => {
          throw new Error(`거부돼야 하는데 통과했다: ${JSON.stringify(value)}`);
        },
        (err: unknown) => err,
      );
      const code = (error as { code?: string }).code;
      // **의도한 거부**여야 한다. 아무 예외나 통과시키면 500(관문이 아니라 사고로 멈춘 것)도
      // 초록이 되어, 실제로는 스코프 조건이 빠졌는데 다른 데서 터진 경우를 못 가른다.
      expect(REFUSAL_CODES, `의도한 거부가 아니다: ${String(error)}`).toContain(code);
    }

    /**
     * **조용한 무동작** — WHERE 에 surveyId 가 함께 들어 있어 0행이 영향받고, 표면은 그대로
     * `{ ok: true }` 를 돌려준다.
     *
     * 보안상으로는 거부와 같다(남의 행이 안 움직인다). 다만 호출자에게는 "했다" 고 말하므로
     * 두 부류를 갈라 적어 둔다 — 어느 쪽인지 모른 채 초록이면, 나중에 누가 `surveyId` 조건을
     * 빼도 "원래 ok 를 주던 표면" 으로 보여 리뷰를 통과한다. 무동작 목록은 **행 생존 확인이
     * 필수**다.
     */
    async function expectSilentNoop(promise: Promise<unknown>): Promise<void> {
      await expect(promise).resolves.toEqual({ ok: true });
    }

    it('컨택 수정·삭제', async () => {
      await expectRejected(
        aLeader.targets.update({ surveyId: fx.surveyAId, id: fx.contactBId, attrs: { 이름: '탈취' } }),
      );
      await expectRejected(aLeader.targets.remove({ surveyId: fx.surveyAId, id: fx.contactBId }));

      const [row] = await db
        .select({ attrs: contactTargets.attrs, surveyId: contactTargets.surveyId })
        .from(contactTargets)
        .where(eq(contactTargets.id, fx.contactBId));
      expect(row?.surveyId).toBe(fx.surveyBId);
      expect(row?.attrs).toEqual({ 이름: 'B팀 응답자' });
    });

    it('결과코드 회차 쓰기 3종', async () => {
      await expectRejected(
        aLeader.attempts.add({
          surveyId: fx.surveyAId,
          contactTargetId: fx.contactBId,
          resultCode: '완료',
        }),
      );
      await expectRejected(
        aLeader.attempts.update({
          surveyId: fx.surveyAId,
          contactTargetId: fx.contactBId,
          id: fx.attemptBId,
          resultCode: '탈취',
        }),
      );
      await expectRejected(
        aLeader.attempts.remove({
          surveyId: fx.surveyAId,
          contactTargetId: fx.contactBId,
          id: fx.attemptBId,
        }),
      );

      const [row] = await db
        .select({ resultCode: contactAttempts.resultCode })
        .from(contactAttempts)
        .where(eq(contactAttempts.id, fx.attemptBId));
      expect(row?.resultCode).toBe('부재');
    });

    it('수신거부 해제 — 남의 컨택은 건드리지 못한다', async () => {
      // 이 표면은 예외가 아니라 **결과 객체**로 거부한다(화면이 문구를 그대로 띄운다).
      // 거부의 모양이 표면마다 다른 것 자체는 문제가 아니지만, 적어 두지 않으면 다음 사람이
      // "예외가 안 났으니 통과했다" 로 읽는다.
      await expect(
        aLeader.unsubscribe.revertByContactId({
          surveyId: fx.surveyAId,
          contactId: fx.contactBId,
        }),
      ).resolves.toMatchObject({ ok: false });
    });

    it('관리자 응답 수정 — 남의 응답은 열리지 않는다', async () => {
      await expectRejected(
        aLeader.edit.saveAdminEdit({
          surveyId: fx.surveyAId,
          responseId: fx.responseBId,
          questionResponses: { q1: '탈취' },
          versionId: crypto.randomUUID(),
        }),
      );

      const [row] = await db
        .select({ questionResponses: surveyResponses.questionResponses })
        .from(surveyResponses)
        .where(eq(surveyResponses.id, fx.responseBId));
      expect(row?.questionResponses).toEqual({});
    });

    it('메일 미리보기·발송 후보 — 남의 컨택·템플릿을 끌어오지 못한다', async () => {
      // 미리보기 샘플은 「컨택 0건이면 null」이 계약이라 거부도 null 이다 — 조회 자체가
      // surveyId 로 좁혀져 남의 컨택은 애초에 안 잡힌다(수신거부 해제와 같은 무예외 부류).
      await expect(
        aLeader.preview.sample({ surveyId: fx.surveyAId, contactTargetId: fx.contactBId }),
      ).resolves.toBeNull();
      // 프리플라이트는 mutation 이 아니라 **집계 보고**라 거부도 숫자로 나온다.
      // 남의 컨택이 발송 후보로 서지 않는다는 것이 여기서 확인해야 할 사실이다.
      await expect(
        aLeader.campaigns.previewPreflight({
          surveyId: fx.surveyAId,
          selectedContactIds: [fx.contactBId],
        }),
      ).resolves.toMatchObject({ validCount: 0, notFoundCount: 1 });
      await expectRejected(
        aLeader.campaigns.create({
          surveyId: fx.surveyAId,
          mailTemplateId: fx.templateBId,
          title: '탈취 캠페인',
          contactTargetIds: [fx.contactBId],
        }),
      );
      await expectRejected(
        aLeader.campaigns.sendSingle({
          surveyId: fx.surveyAId,
          contactTargetId: fx.contactBId,
          mailTemplateId: fx.templateBId,
        }),
      );
    });

    it('응답 관리 4종 — 조용한 무동작이지만 행은 그대로다', async () => {
      // 응답 관리는 UPDATE 의 WHERE 에 surveyId 를 함께 걸어 0행을 만든다. 표면은 ok 를
      // 돌려주지만(idempotent 계약) 남의 응답은 어느 컬럼도 바뀌지 않는다.
      await expectSilentNoop(
        aLeader.manage.softDelete({ surveyId: fx.surveyAId, responseId: fx.responseBId }),
      );
      await expectSilentNoop(
        aLeader.manage.restore({ surveyId: fx.surveyAId, responseId: fx.responseBId }),
      );
      await expectSilentNoop(
        aLeader.manage.allowReedit({ surveyId: fx.surveyAId, responseId: fx.responseBId }),
      );
      await expectSilentNoop(
        aLeader.manage.hardReset({ surveyId: fx.surveyAId, responseId: fx.responseBId }),
      );

      const [row] = await db
        .select({
          deletedAt: surveyResponses.deletedAt,
          isCompleted: surveyResponses.isCompleted,
          status: surveyResponses.status,
          questionResponses: surveyResponses.questionResponses,
        })
        .from(surveyResponses)
        .where(eq(surveyResponses.id, fx.responseBId));
      expect(row).toEqual({
        deletedAt: null,
        isCompleted: true,
        status: 'completed',
        questionResponses: {},
      });

      // hardReset 은 컨택 unlink 도 한다 — 티켓 10 이 그 해제에 surveyId 스코프를 붙였다.
      const [contact] = await db
        .select({ surveyId: contactTargets.surveyId })
        .from(contactTargets)
        .where(eq(contactTargets.id, fx.contactBId));
      expect(contact?.surveyId).toBe(fx.surveyBId);
    });

    it('메일 템플릿 수정·삭제', async () => {
      await expectRejected(
        aLeader.templates.update({
          surveyId: fx.surveyAId,
          templateId: fx.templateBId,
          input: {
            name: '탈취',
            subject: '탈취',
            bodyHtml: '<p>탈취</p>',
            fromLocal: 'no-reply',
            fromName: '탈취',
            replyTo: 'attacker@example.com',
          },
        }),
      );
      await expectRejected(
        aLeader.templates.remove({ surveyId: fx.surveyAId, templateId: fx.templateBId }),
      );

      const [row] = await db
        .select({ name: mailTemplates.name, deletedAt: mailTemplates.deletedAt })
        .from(mailTemplates)
        .where(eq(mailTemplates.id, fx.templateBId));
      expect(row).toEqual({ name: 'B팀 템플릿', deletedAt: null });
    });

    it('메일 캠페인 취소·재동기화', async () => {
      await expectRejected(
        aLeader.campaigns.cancel({ surveyId: fx.surveyAId, campaignId: fx.campaignBId }),
      );
      await expectRejected(
        aLeader.campaigns.resync({ surveyId: fx.surveyAId, campaignId: fx.campaignBId }),
      );

      const [row] = await db
        .select({ status: mailCampaigns.status, surveyId: mailCampaigns.surveyId })
        .from(mailCampaigns)
        .where(eq(mailCampaigns.id, fx.campaignBId));
      expect(row).toEqual({ status: 'draft', surveyId: fx.surveyBId });
    });

    it('질문·문항 그룹 수정·삭제', async () => {
      await expectRejected(
        aLeader.questions.update({
          surveyId: fx.surveyAId,
          questionId: fx.questionBId,
          data: { title: '탈취' },
        }),
      );
      // 삭제 둘은 무동작 부류다 — DELETE 의 WHERE 에 surveyId 가 함께 걸려 0행이 지워지고
      // 표면은 ok 를 돌려준다(수정은 0행을 실패로 보고 던진다 — 부류가 갈리는 자리).
      await expectSilentNoop(
        aLeader.questions.remove({ surveyId: fx.surveyAId, questionId: fx.questionBId }),
      );
      await expectSilentNoop(
        aLeader.questionGroups.remove({ surveyId: fx.surveyAId, groupId: fx.questionGroupBId }),
      );

      const [question] = await db
        .select({ title: questions.title })
        .from(questions)
        .where(eq(questions.id, fx.questionBId));
      expect(question?.title).toBe('B팀 질문');

      const [group] = await db
        .select({ name: questionGroups.name })
        .from(questionGroups)
        .where(eq(questionGroups.id, fx.questionGroupBId));
      expect(group?.name).toBe('B팀 문항 그룹');
    });

    it('정렬 — 남의 행 id 가 섞이면 통째로 거부한다', async () => {
      await expectRejected(
        aLeader.questions.reorder({ surveyId: fx.surveyAId, questionIds: [fx.questionBId] }),
      );
      await expectRejected(
        aLeader.questionGroups.reorder({
          surveyId: fx.surveyAId,
          groupIds: [fx.questionGroupBId],
        }),
      );
    });

    it('참조 주입 — 내 질문을 남의 팀 그룹에 매달지 못한다', async () => {
      // 행 자체는 내 것이라 위 검사들이 못 잡는 축이다. FK 는 그룹의 존재만 보고 설문
      // 경계를 모르며 parentGroupId 에는 FK 조차 없다(티켓 15).
      await expectRejected(
        aLeader.questions.create({
          surveyId: fx.surveyAId,
          id: crypto.randomUUID(),
          groupId: fx.questionGroupBId,
          type: 'text',
          title: '주입 질문',
          order: 0,
        }),
      );
      await expectRejected(
        aLeader.questionGroups.create({
          surveyId: fx.surveyAId,
          id: crypto.randomUUID(),
          name: '주입 그룹',
          parentGroupId: fx.questionGroupBId,
          order: 0,
        }),
      );
    });

    it('설문 그룹 담기·이동 — 남의 팀 설문은 내 폴더에 들어오지 않는다', async () => {
      await expectRejected(
        aLeader.surveyGroups.collect({ groupId: fx.groupAId, surveyIds: [fx.surveyBId] }),
      );
      await expectRejected(
        aLeader.surveyGroups.move({ surveyId: fx.surveyBId, groupId: fx.groupAId }),
      );

      const [row] = await db
        .select({ groupId: surveysTable.surveyGroupId, teamId: surveysTable.teamId })
        .from(surveysTable)
        .where(eq(surveysTable.id, fx.surveyBId));
      expect(row).toEqual({ groupId: null, teamId: fx.teamBId });
    });

    it('정상 경로는 살아 있다 — 거부가 뭉뚱그려진 것이 아니다', async () => {
      // 같은 호출이 자기 팀 설문의 하위 행에는 그대로 통한다. 이 대조가 없으면 위 검사들은
      // "이 표면은 늘 실패한다" 와 구분되지 않는다.
      const contactAId = crypto.randomUUID();
      await db.insert(contactTargets).values({
        id: contactAId,
        surveyId: fx.surveyAId,
        resid: 1,
        inviteCode: `idor-ok-${contactAId.slice(0, 8)}`,
        attrs: { 이름: 'A팀 응답자' },
      });

      await aLeader.targets.update({
        surveyId: fx.surveyAId,
        id: contactAId,
        attrs: { 이름: 'A팀 응답자(수정)' },
      });

      const [row] = await db
        .select({ attrs: contactTargets.attrs })
        .from(contactTargets)
        .where(eq(contactTargets.id, contactAId));
      expect(row?.attrs).toEqual({ 이름: 'A팀 응답자(수정)' });

      await db.delete(contactTargets).where(eq(contactTargets.id, contactAId));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 목록 격리 — 조회에도 팀 경계가 선다
  // ───────────────────────────────────────────────────────────────────────────

  describe('목록 조회는 팀 밖 설문을 담지 않는다', () => {
    it('B팀 설문은 A팀 사람의 어떤 범위에서도 나오지 않는다', async () => {
      for (const userId of [A_LEADER_ID, A_MEMBER_ID]) {
        const result = await getSurveyListWithCounts(
          { id: userId, isSuperadmin: false, userType: 'internal' },
          fx.teamAId,
        );
        const ids = result.surveys.map((survey) => survey.id);
        expect(ids).not.toContain(fx.surveyBId);
        expect(ids).not.toContain(fx.surveyPendingId);
        expect(ids).toContain(fx.surveyAId);
      }
    });

    it('invite_only 는 같은 팀 팀원의 목록에서만 빠진다', async () => {
      const asMember = await getSurveyListWithCounts(
        { id: A_MEMBER_ID, isSuperadmin: false, userType: 'internal' },
        fx.teamAId,
      );
      expect(asMember.surveys.map((s) => s.id)).not.toContain(fx.surveyAHiddenId);

      const asLeader = await getSurveyListWithCounts(
        { id: A_LEADER_ID, isSuperadmin: false, userType: 'internal' },
        fx.teamAId,
      );
      expect(asLeader.surveys.map((s) => s.id)).toContain(fx.surveyAHiddenId);
    });

    it('삭제되지 않은 설문만 센다 — 시드가 실제로 조회 대상이었다는 확인', async () => {
      const [row] = await db
        .select({ id: surveysTable.id })
        .from(surveysTable)
        .where(and(eq(surveysTable.id, fx.surveyAId), isNull(surveysTable.deletedAt)));
      expect(row?.id).toBe(fx.surveyAId);
    });
  });
});
