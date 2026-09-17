import 'server-only';

import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { getSurveyById } from '@/server/read-models/survey-structure';
import {
  assertSurveyCapability,
  loadAccessSubject,
  SurveyAccessError,
  type SurveyAccessUser,
} from '@/server/survey-access';
import { resolveWorkScope } from '@/server/work-scope';
import type { CompleteQuestionWrite } from '@/db/schema/question-persisted-fields';
import { db, type DbOrTx } from '@/db';
import {
  NewQuestion,
  NewQuestionGroup,
  NewSurvey,
  questionGroups,
  questions,
  surveys,
  teams,
} from '@/db/schema';
import { mailCampaigns } from '@/db/schema/mail';
import { registerDeletionCandidates } from '@/server/storage-lifecycle/deletion-queue';
import { collectSurveyContentKeys } from '@/server/storage-lifecycle/entity-collectors';
import { collectFieldLimitedSaveDiff } from '@/server/storage-lifecycle/save-diff-collector';
import { promoteSurveyResponseHeader } from '@/lib/survey/survey-image-promote';
import { generateId } from '@/lib/utils';
import { stripOptionCodes } from '@/utils/option-code-generator';

import { copyKeepsOriginalTeam, SurveyOwnershipRequiredError } from '../domain/survey';
import type {
  CreateSurveyInput,
  EnsureSurveyInDbInput,
  EnsureSurveyResult,
  SurveyIdInput,
  SurveyRow,
  UpdateSurveyInput,
} from '../domain/survey';

// ========================
// 설문 CRUD 서비스
// ========================
//
// 인증은 authed 미들웨어가 담당(requireAuth 제거). 캐시 갱신(revalidatePath)은
// 소비처 query invalidation(use-survey-sync)으로 대체한다.


/**
 * 새 설문이 붙을 팀 (역할 모델 v2 티켓 07).
 *
 * 팀 범위에서만 설문을 만들 수 있다. 시스템 전체 보기는 teams 행이 아니라 조회 범위라
 * 소유 목적지가 될 수 없고(.pen 6-2 노트), 팀 미배치 사용자는 애초에 내부 설문 경로가 닫혀
 * 있다. 화면은 두 경우 모두 생성 버튼을 비활성으로 두지만 판정은 여기서 다시 한다.
 *
 * 설문을 만드는 네 경로(ensure·create·duplicate·saveWithDetails 생성 모드)가 전부 이
 * 함수를 지나야 한다 — 하나라도 비켜가면 소유자 없는 배치 대기 설문이 생긴다.
 */
export async function resolveNewSurveyOwnership(
  actor: SurveyAccessUser,
  requestedScope: string | null | undefined,
  /** INSERT 와 **같은 트랜잭션**을 넘겨야 한다 — 아래 FOR SHARE 가 그때만 의미를 갖는다. */
  executor: DbOrTx = db,
): Promise<{ teamId: string; ownerUserId: string; createdBy: string; assignmentStatus: 'assigned' }> {
  const scope = await resolveWorkScope(actor, requestedScope ?? null);
  if (scope.kind !== 'team') {
    throw new SurveyOwnershipRequiredError();
  }

  // 해산된 팀에는 아무것도 새로 붙지 않는다 (티켓 13).
  //
  // 일반 사용자는 여기까지 못 온다 — 유효 소속에서 archived 팀이 빠져 범위가 none 으로
  // 접힌다. 그런데 **슈퍼어드민의 팀 범위는 멤버십으로 걸러지지 않는다**(work-scope 의
  // UUID 형식 검사만 지난다). 해산 전에 그 팀을 보고 있었다면 `work_scope` 쿠키에 id 가
  // 남아, 해산 뒤 만든 설문이 archived 팀 소유로 붙는다 — 배치 대기도 아니고 아무도 못 보는
  // (슈퍼어드민 외) 유령 설문이 된다.
  //
  // 잠금이 `FOR SHARE` 인 것이 핵심이다. 그냥 읽으면 확인과 INSERT 사이에 해산이 커밋되어
  // 같은 유령이 생긴다 — INSERT 의 FK 검사가 잡는 `FOR KEY SHARE` 는 해산의 UPDATE 가 잡는
  // `FOR NO KEY UPDATE` 와 **충돌하지 않아** DB 도 막아주지 않는다. `FOR SHARE` 는 충돌하므로
  // 해산이 팀 행을 잠근 뒤에는 여기서 대기하다 archived 를 보고 거부된다(해산이 팀을 설문보다
  // 먼저 잠그는 이유가 이것이다).
  const [team] = await executor
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, scope.teamId), eq(teams.status, 'active')))
    .for('share');
  if (!team) throw new SurveyOwnershipRequiredError();

  return {
    teamId: scope.teamId,
    ownerUserId: actor.id,
    createdBy: actor.id,
    assignmentStatus: 'assigned',
  };
}

// 설문이 DB에 존재하는지 확인하고, 없으면 최소한의 레코드를 생성 (idempotent)
export async function ensureSurveyInDb(
  actor: SurveyAccessUser,
  input: EnsureSurveyInDbInput,
): Promise<EnsureSurveyResult> {
  const existing = await db.query.surveys.findFirst({
    where: eq(surveys.id, input.id),
    columns: { id: true },
  });

  if (existing) {
    // 존재 오라클 봉인(티켓 09 리뷰) — 관문 없이 { created: false } 를 돌려주면 타 팀
    // 설문 id 의 존재가 확인된다. 기존 행에 대한 ensure 는 편집 흐름의 일부이므로
    // survey.edit 을 요구한다(권한이 없으면 not_found 로 접혀 없는 설문과 같아진다).
    await assertSurveyCapability(actor, input.id, 'survey.edit');
    return { surveyId: input.id, created: false };
  }

  // R2 승격은 트랜잭션 밖에서 먼저 끝낸다 — 팀 행을 잠근 채 외부 왕복을 기다리면 그동안
  // 해산이 막힌다.
  const responseHeader = (await promoteSurveyResponseHeader(input.settings.responseHeader)) ?? null;

  await db.transaction(async (tx) => {
    // 귀속 판정과 INSERT 가 같은 트랜잭션이어야 FOR SHARE 가 해산을 막는다.
    const ownership = await resolveNewSurveyOwnership(actor, input.scope, tx);

    await tx.insert(surveys).values({
      ...ownership,
      id: input.id,
      title: input.title,
      privateToken: input.privateToken,
      isPublic: input.settings.isPublic ?? true,
      allowMultipleResponses: input.settings.allowMultipleResponses ?? false,
      showProgressBar: input.settings.showProgressBar ?? true,
      shuffleQuestions: input.settings.shuffleQuestions ?? false,
      requireLogin: input.settings.requireLogin ?? false,
      thankYouMessage: input.settings.thankYouMessage ?? '응답해주셔서 감사합니다!',
      screenedOutMessage: input.settings.screenedOutMessage ?? null,
      responseHeader,
    });
  });

  return { surveyId: input.id, created: true };
}

// 설문 생성
export async function createSurvey(
  actor: SurveyAccessUser,
  data: CreateSurveyInput,
): Promise<SurveyRow> {
  // R2 승격은 팀 행을 잠그기 전에 끝낸다 — 잠근 채 외부 왕복을 기다리면 그동안 해산이 막힌다.
  const responseHeader = (await promoteSurveyResponseHeader(data.settings?.responseHeader)) ?? null;

  const survey = await db.transaction(async (tx) => {
    // 귀속 판정과 INSERT 가 같은 트랜잭션이어야 FOR SHARE 가 해산을 막는다.
    const ownership = await resolveNewSurveyOwnership(actor, data.scope, tx);
    const newSurvey: NewSurvey = {
      ...ownership,
      title: data.title,
      description: data.description,
      slug: data.slug,
      isPublic: data.isPublic ?? true,
      allowMultipleResponses: data.settings?.allowMultipleResponses ?? false,
      showProgressBar: data.settings?.showProgressBar ?? true,
      shuffleQuestions: data.settings?.shuffleQuestions ?? false,
      requireLogin: data.settings?.requireLogin ?? false,
      endDate: data.settings?.endDate ? new Date(data.settings.endDate) : null,
      maxResponses: data.settings?.maxResponses ?? null,
      thankYouMessage: data.settings?.thankYouMessage ?? '응답해주셔서 감사합니다!',
      screenedOutMessage: data.settings?.screenedOutMessage ?? null,
      responseHeader,
    };

    const [row] = await tx.insert(surveys).values(newSurvey).returning();
    return row;
  });
  if (!survey) throw new Error('createSurvey: 설문 생성 실패');

  return survey;
}

/**
 * 설문 설정 업데이트 — **갱신 가능한 컬럼은 아래 픽업이 정한다.**
 *
 * payload 를 `.set()` 에 그대로 펼치지 않는다. 도메인 스키마가 이미 allowlist 지만, 이 자리는
 * 권한·귀속·삭제 컬럼(ownerUserId·teamId·assignmentStatus·visibility·surveyGroupId·deletedAt)이
 * 한 번의 스프레드로 갱신될 수 있는 지점이라 두 겹으로 막는다. 새 설정 필드를 열 때는
 * 스키마와 이 픽업을 함께 늘려야 한다 — 한쪽만 늘리면 통과는 하는데 저장이 안 된다.
 */
export async function updateSurvey(input: UpdateSurveyInput): Promise<SurveyRow> {
  const { surveyId, data } = input;

  const picked: Partial<SurveyRow> = {};
  if (data.title !== undefined) picked.title = data.title;
  if (data.description !== undefined) picked.description = data.description;
  if (data.slug !== undefined) picked.slug = data.slug;
  if (data.isPublic !== undefined) picked.isPublic = data.isPublic;
  if (data.allowMultipleResponses !== undefined) {
    picked.allowMultipleResponses = data.allowMultipleResponses;
  }
  if (data.showProgressBar !== undefined) picked.showProgressBar = data.showProgressBar;
  if (data.shuffleQuestions !== undefined) picked.shuffleQuestions = data.shuffleQuestions;
  if (data.requireLogin !== undefined) picked.requireLogin = data.requireLogin;
  if (data.endDate !== undefined) picked.endDate = data.endDate;
  if (data.maxResponses !== undefined) picked.maxResponses = data.maxResponses;
  if (data.thankYouMessage !== undefined) picked.thankYouMessage = data.thankYouMessage;
  if (data.screenedOutMessage !== undefined) picked.screenedOutMessage = data.screenedOutMessage;

  // responseHeader 가 실려 온 경우에만 로고 tmp-to-permanent 승격 후 set(미포함 시 기존 값 보존)
  const dataToUpdate: Partial<SurveyRow> =
    data.responseHeader === undefined
      ? picked
      : {
          ...picked,
          responseHeader: await promoteSurveyResponseHeader(data.responseHeader),
        };

  // 저장 전 행 read → write → 저장 diff 등록·부활 취소를 같은 트랜잭션으로.
  // 로고 교체 시 빠진 키가 유예 삭제 큐 후보로 등록된다 (payload 존재 필드 한정).
  return db.transaction(async (tx) => {
    const [oldRow] = await tx.select().from(surveys).where(eq(surveys.id, surveyId));

    const [updated] = await tx
      .update(surveys)
      .set({
        ...dataToUpdate,
        updatedAt: new Date(),
      })
      .where(eq(surveys.id, surveyId))
      .returning();
    if (!updated) throw new Error('updateSurvey: 설문 업데이트 실패');

    if (oldRow) {
      await collectFieldLimitedSaveDiff(tx, {
        oldRow,
        payloadRow: dataToUpdate as Record<string, unknown>,
        reason: `설문 설정 수정: ${oldRow.title || surveyId}`,
      });
    }

    return updated;
  });
}

/**
 * 설문 삭제 — **soft delete** 다 (역할 모델 v2 티켓 17).
 *
 * 예전에는 `tx.delete` 로 행을 지웠고 CASCADE 가 질문·응답·컨택·메일을 함께 없앴다. 참여자
 * (티켓 18)에게까지 삭제권이 넓어지는 이상 되돌릴 수 없는 파괴는 전제가 될 수 없어(스펙 §4
 * 「삭제 전제」) `deleted_at` 을 찍는 것으로 바꿨다. **행과 응답 데이터는 그대로 남는다** —
 * 복구(restoreSurvey)가 팀·소유자·상태를 되돌릴 것이 아니라 애초에 건드리지 않는다.
 *
 * 조회에서 사라지는 것은 이 함수가 아니라 읽는 쪽이 진다 — capability 코어가
 * `deleted_at IS NULL` 로 조회하므로 관문을 지나는 내부 표면 전부가 자동으로 닫히고,
 * 관문이 없는 응답자(pub) 경로는 각자 같은 조건을 건다(tests/integration/soft-delete-*).
 *
 * R2 는 **관행 그대로** 유예 삭제 큐에 후보를 등록한다(티켓 17 지시). 실제로 지워지지는
 * 않는다 — 집행자가 보는 참조 표면(REFERENCE_SURFACE)에 `surveys`·`questions` 가
 * deletedAt 술어 없이 들어 있어, 살아남은 행이 그 키의 참조를 계속 주장하기 때문이다.
 * 그 사실이 이 티켓의 「R2 파일은 삭제하지 않음」을 지탱한다.
 *
 * 옛 코드의 `deleteKeyRefsBySourceIds`(survey_versions)는 뺐다. 그것이 있던 이유는
 * "행이 소멸하는데 인덱스만 남아 후보를 전부 '보존됨' 으로 닫는다" 였는데, soft delete 에서는
 * 버전 행이 소멸하지 않아 전제가 사라졌다. 남겨두면 인덱스만 스캔보다 좁아져
 * `indexMisses`(위험 방향 드리프트 신호)가 삭제할 때마다 헛되이 오른다.
 */
export async function deleteSurvey(input: SurveyIdInput): Promise<void> {
  const { surveyId } = input;

  await db.transaction(async (tx) => {
    const { keys } = await collectSurveyContentKeys(tx, surveyId);
    await registerDeletionCandidates(tx, {
      keys,
      source: 'survey-delete',
      reason: `설문 삭제: ${surveyId}`,
    });

    // 이미 삭제된 설문에는 시각을 덮어쓰지 않는다 — 관문이 먼저 막지만 그 조회와 이
    // UPDATE 는 별도 왕복이고, 덮어쓰면 "언제 지워졌나" 가 두 번째 요청 시각으로 밀린다.
    const updated = await tx
      .update(surveys)
      .set({ deletedAt: new Date() })
      .where(and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)))
      .returning({ id: surveys.id });
    if (updated.length === 0) throw new SurveyAccessError('not_found');

    // 예약·진행 중 캠페인을 **같은 트랜잭션에서** 접는다.
    //
    // 예전 hard delete 는 CASCADE 가 캠페인·수신자를 함께 지워 Inngest dispatcher 가 볼
    // 것이 없었다. soft delete 는 그 행들을 살려두므로, 접지 않으면 삭제된 설문의 초대
    // 메일이 계속 나가고 과금되며 수신자는 열리지 않는 링크를 받는다.
    //
    // `cancelCampaign`(운영자 취소)과 달리 **sending 도 접는다** — 저쪽은 "발송 시작 후에는
    // 취소 불가" 라는 운영 규칙이지만, 여기서는 설문 자체가 사라져 남은 수신자에게 보낼
    // 이유가 하나도 없다. 이미 lease 를 인수한 수신자 한 건은 나갈 수 있다(dispatcher 가
    // campaign 행을 잠근 채 발송 중이면 이 UPDATE 가 그 뒤에 선다) — 그보다 좁힐 수는 없다.
    //
    // 파티션(isTest)을 가리지 않는다: 설문이 통째로 지워지므로 실·테스트 양쪽 다 접는다.
    // 삭제 순서가 **설문 → 캠페인**인 것이 계약이다 — dispatch 쪽 재검증이 캠페인을 잠근 뒤
    // 설문을 잠금 없이 읽는 것과 짝을 이뤄 데드락을 만들지 않는다.
    await tx
      .update(mailCampaigns)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(mailCampaigns.surveyId, surveyId),
          inArray(mailCampaigns.status, ['queued', 'sending']),
        ),
      );
  });
}

/**
 * 삭제 취소 (티켓 17) — 슈퍼어드민 전용.
 *
 * 되살릴 것이 `deleted_at` 하나뿐인 것이 soft delete 의 요점이다. 팀·소유자·공개 범위·그룹·
 * 배포 버전은 삭제가 건드리지 않았으므로 복구도 건드리지 않는다 — "원래 팀·소유자·상태
 * 그대로" 는 되돌리는 코드가 아니라 **아무것도 잃지 않은 삭제**가 지킨다.
 *
 * 이미 살아 있는 설문은 not_found 다. 「복구했다」는 응답이 실제로는 아무 일도 없었던
 * 경우와 구별되지 않으면, 목록이 먼저 갱신된 두 번째 관리자가 성공 문구만 보고 지나간다.
 */
export async function restoreSurvey(input: SurveyIdInput): Promise<void> {
  const restored = await db
    .update(surveys)
    .set({ deletedAt: null })
    .where(and(eq(surveys.id, input.surveyId), isNotNull(surveys.deletedAt)))
    .returning({ id: surveys.id });
  if (restored.length === 0) throw new SurveyAccessError('not_found');
}

// 복제 시 질문 id 는 새로 발번되므로 JSONB 안의 질문 id 참조 — 표시조건의
// sourceQuestionId, expression 조건의 questionId(CellRef·question operand),
// 분기 goto 의 targetQuestionId/targetQuestionMap 값 — 를 새 id 로 치환한다.
// 맵에 없는 id(삭제된 질문 참조 등)는 그대로 둔다. 셀 id·LUT id 는 복제 시
// 값이 보존되므로 재매핑 대상이 아니다.
const QUESTION_REF_KEYS = new Set(['sourceQuestionId', 'questionId', 'targetQuestionId']);

function remapUnknownRefs(value: unknown, idMap: Map<string, string>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value.map((item) => remapUnknownRefs(item, idMap));
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (QUESTION_REF_KEYS.has(key) && typeof v === 'string') {
      out[key] = idMap.get(v) ?? v;
    } else if (key === 'targetQuestionMap' && v && typeof v === 'object' && !Array.isArray(v)) {
      out[key] = Object.fromEntries(
        Object.entries(v as Record<string, string>).map(([label, qid]) => [
          label,
          idMap.get(qid) ?? qid,
        ]),
      );
    } else {
      out[key] = remapUnknownRefs(v, idMap);
    }
  }
  return out;
}

// 재귀 워커는 unknown 으로만 다루고, 타입 단언은 이 wrapper 한 곳에만 둔다.
// 재매핑은 키 치환만 하므로 입력 타입 구조가 보존된다.
function remapQuestionIdRefs<T>(value: T, idMap: Map<string, string>): T {
  return remapUnknownRefs(value, idMap) as T;
}

// 설문 복제
export async function duplicateSurvey(
  actor: SurveyAccessUser,
  input: SurveyIdInput,
): Promise<SurveyRow | null> {
  const { surveyId } = input;

  // 복제는 원본을 읽어 새 설문을 만드는 일이라 **원본 접근 권한이 먼저다**. 이 검사가 없으면
  // id 만 아는 내부 사용자가 타 팀 설문을 복제해 그 사본의 소유자가 된다(팀 경계 우회).
  // 요구는 편집이다(플랜 D7) — 열람만 가진 주체(이후 게스트·실사의 제한 화면)가 사본을
  // 만들어 그 사본의 전권을 얻는 우회를 막는다. 지금 내부 프리셋은 view=edit 라 무변경.
  await assertSurveyCapability(actor, surveyId, 'survey.edit');

  const original = await getSurveyById(surveyId);
  if (!original) return null;
  const subject = await loadAccessSubject(actor);
  const keepsOriginalTeam = copyKeepsOriginalTeam(subject, original.teamId);

  return await db.transaction(async (tx) => {
    const originalGroups = await tx.query.questionGroups.findMany({
      where: eq(questionGroups.surveyId, surveyId),
      orderBy: [questionGroups.order],
    });

    const originalQuestions = await tx.query.questions.findMany({
      where: eq(questions.surveyId, surveyId),
      orderBy: [questions.order],
    });

    // 원본 팀 소속(또는 슈퍼어드민)이면 원본의 귀속을 잇고, 원본 팀 밖의 참여자면 새 설문
    // 만들기와 같은 귀속을 받는다(copyKeepsOriginalTeam 참조). 잇는 쪽은
    // resolveNewSurveyOwnership 을 지나지 않으므로 해산 가드도 여기서 따로 진다 — 원본을 읽은 뒤
    // 복제 트랜잭션이 도는 동안(질문·그룹 수십 ms) 그 팀이 해산되면 사본만 archived 팀에 붙어
    // 만든 사람도 못 여는 유령이 된다. 팀이 이미 해산됐으면 원본이 그랬듯 배치 대기로 떨어뜨린다.
    let ownership: {
      teamId: string | null;
      assignmentStatus: 'assigned' | 'assignment_pending';
      ownerUserId: string;
      createdBy: string;
    };
    if (keepsOriginalTeam) {
      const ownedTeam =
        original.teamId === null
          ? null
          : (
              await tx
                .select({ id: teams.id })
                .from(teams)
                .where(and(eq(teams.id, original.teamId), eq(teams.status, 'active')))
                .for('share')
            )[0] ?? null;
      const copyTeamId = ownedTeam ? original.teamId : null;
      ownership = {
        teamId: copyTeamId,
        assignmentStatus: copyTeamId === null ? 'assignment_pending' : 'assigned',
        ownerUserId: actor.id,
        createdBy: actor.id,
      };
    } else {
      ownership = await resolveNewSurveyOwnership(actor, null, tx);
    }

    const newSurveyRows = await tx
      .insert(surveys)
      .values({
        // 공개 범위는 원본을 잇는다 — invite_only 설문의 사본이 팀 공개로 풀리면 안 된다.
        ...ownership,
        visibility: original.visibility,
        title: `${original.title} (복사본)`,
        description: original.description,
        isPublic: original.isPublic,
        allowMultipleResponses: original.allowMultipleResponses,
        showProgressBar: original.showProgressBar,
        shuffleQuestions: original.shuffleQuestions,
        requireLogin: original.requireLogin,
        endDate: original.endDate,
        piiRetentionUntil: original.piiRetentionUntil,
        maxResponses: original.maxResponses,
        thankYouMessage: original.thankYouMessage,
        screenedOutMessage: original.screenedOutMessage,
        responseHeader: original.responseHeader ?? null,
        // LUT 사본은 질문(옵션 소스·조건)이 id 로 참조하므로 함께 복사해야 복제본이 깨지지 않는다.
        lookups: original.lookups ?? [],
      })
      .returning();
    const newSurvey = newSurveyRows[0];
    if (!newSurvey) throw new Error('copySurvey: 새 설문 생성 실패');

    // 질문 id 를 선발번해 JSONB 재매핑(그룹 표시조건 포함)에 쓸 맵을 먼저 완성한다
    const questionIdMap = new Map<string, string>();
    for (const question of originalQuestions) {
      questionIdMap.set(question.id, generateId());
    }

    // 그룹 정렬 (상위 그룹부터 하위 그룹 순으로)
    const sortedGroups: typeof originalGroups = [];
    if (originalGroups.length > 0) {
      const processedGroupIds = new Set<string>();
      const topLevelGroups = originalGroups
        .filter((g) => !g.parentGroupId)
        .sort((a, b) => a.order - b.order);
      sortedGroups.push(...topLevelGroups);
      topLevelGroups.forEach((g) => processedGroupIds.add(g.id));

      const addSubGroups = (parentId: string) => {
        const subGroups = originalGroups
          .filter((g) => g.parentGroupId === parentId && !processedGroupIds.has(g.id))
          .sort((a, b) => a.order - b.order);

        subGroups.forEach((g) => {
          sortedGroups.push(g);
          processedGroupIds.add(g.id);
          addSubGroups(g.id);
        });
      };

      topLevelGroups.forEach((group) => {
        addSubGroups(group.id);
      });
    }

    // 그룹 ID 매핑 및 데이터 준비
    const groupIdMap = new Map<string, string>();
    const newGroupsData = sortedGroups.map((group) => {
      const newGroupId = generateId();
      groupIdMap.set(group.id, newGroupId);
      return {
        id: newGroupId,
        surveyId: newSurvey.id,
        name: group.name,
        description: group.description,
        order: group.order,
        parentGroupId: group.parentGroupId ? groupIdMap.get(group.parentGroupId) : null,
        color: group.color,
        collapsed: group.collapsed,
        nameDesign: group.nameDesign as NewQuestionGroup['nameDesign'],
        displayCondition: remapQuestionIdRefs(
          group.displayCondition as NewQuestionGroup['displayCondition'],
          questionIdMap,
        ),
      };
    });

    if (newGroupsData.length > 0) {
      await tx.insert(questionGroups).values(newGroupsData);
    }

    // 질문 데이터 준비 — id 는 선발번 맵에서 가져오고, 완성된 행 전체를 재귀 재매핑한다
    const newQuestionsData = originalQuestions.map((question) => {
      const newQuestionId = questionIdMap.get(question.id);
      if (!newQuestionId) throw new Error('duplicateSurvey: 질문 id 매핑 누락');
      const row = {
        id: newQuestionId,
        surveyId: newSurvey.id,
        groupId: question.groupId ? groupIdMap.get(question.groupId) : null,
        type: question.type,
        title: question.title,
        description: question.description,
        required: question.required,
        requiredMessage: question.requiredMessage,
        order: question.order,
        options: (question.options ? stripOptionCodes(question.options) : question.options) as NewQuestion['options'],
        selectLevels: question.selectLevels as NewQuestion['selectLevels'],
        tableTitle: question.tableTitle,
        tableColumns: question.tableColumns as NewQuestion['tableColumns'],
        tableRowsData: question.tableRowsData as NewQuestion['tableRowsData'],
        tableHeaderGrid: question.tableHeaderGrid as NewQuestion['tableHeaderGrid'],
        allowOtherOption: question.allowOtherOption,
        optionsColumns: question.optionsColumns,
        optionsAlign: question.optionsAlign,
        mobileOptionsColumns: question.mobileOptionsColumns,
        minSelections: question.minSelections,
        maxSelections: question.maxSelections,
        rankingConfig: question.rankingConfig as NewQuestion['rankingConfig'],
        choiceGroups: question.choiceGroups as NewQuestion['choiceGroups'],
        noticeContent: question.noticeContent,
        noticeBgColor: question.noticeBgColor,
        requiresAcknowledgment: question.requiresAcknowledgment,
        placeholder: question.placeholder,
        defaultValueTemplate: question.defaultValueTemplate,
        inputType: question.inputType,
        emptyDefault: question.emptyDefault,
        piiEncrypted: question.piiEncrypted,
        questionCode: question.questionCode,
        isCustomSpssVarName: question.isCustomSpssVarName,
        exportLabel: question.exportLabel,
        spssVarType: question.spssVarType,
        spssMeasure: question.spssMeasure,
        tableValidationRules: question.tableValidationRules as NewQuestion['tableValidationRules'],
        numberFormat: question.numberFormat as NewQuestion['numberFormat'],
        textValidation: question.textValidation as NewQuestion['textValidation'],
        inputRows: question.inputRows ?? null,
        inputAutoGrow: question.inputAutoGrow ?? null,
        titleHtml: question.titleHtml ?? null,
        sumConstraints: question.sumConstraints as NewQuestion['sumConstraints'],
        dynamicRowConfigs: question.dynamicRowConfigs as NewQuestion['dynamicRowConfigs'],
        rowRepeatConfig: question.rowRepeatConfig as NewQuestion['rowRepeatConfig'],
        hideColumnLabels: question.hideColumnLabels,
        stickyColumnCount: question.stickyColumnCount ?? null,
        exportCellOrder: question.exportCellOrder ?? null,
        mobileOriginalTable: question.mobileOriginalTable,
        mobileTableDisplayMode: question.mobileTableDisplayMode,
        mobileDrilldownOmitLeadingColumns: question.mobileDrilldownOmitLeadingColumns,
        mobileDrilldownRepeatHeaderStartRow: question.mobileDrilldownRepeatHeaderStartRow,
        mobileDrilldownRepeatHeaderEndRow: question.mobileDrilldownRepeatHeaderEndRow,
        hideTitle: question.hideTitle,
        pageBreakBefore: question.pageBreakBefore,
        displayCondition: question.displayCondition as NewQuestion['displayCondition'],
        priorAnswerCondition:
          question.priorAnswerCondition as NewQuestion['priorAnswerCondition'],
        priorAnswerDisabled:
          question.priorAnswerDisabled as NewQuestion['priorAnswerDisabled'],
        answerQuoteEnabled: question.answerQuoteEnabled,
        answerQuoteName: question.answerQuoteName,
        answerQuoteText: question.answerQuoteText,
      } satisfies CompleteQuestionWrite;
      return remapQuestionIdRefs(row, questionIdMap);
    });

    if (newQuestionsData.length > 0) {
      await tx.insert(questions).values(newQuestionsData);
    }

    return newSurvey;
  });
}
