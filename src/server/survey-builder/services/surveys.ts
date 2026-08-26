import 'server-only';

import { eq } from 'drizzle-orm';

import { getSurveyById } from '@/server/read-models/survey-structure';
import { assertSurveyCapability, type SurveyAccessUser } from '@/server/survey-access';
import { resolveWorkScope } from '@/server/work-scope';
import type { CompleteQuestionWrite } from '@/db/schema/question-persisted-fields';
import { db } from '@/db';
import {
  NewQuestion,
  NewQuestionGroup,
  NewSurvey,
  questionGroups,
  questions,
  surveys,
} from '@/db/schema';
import { registerDeletionCandidates } from '@/server/storage-lifecycle/deletion-queue';
import { collectSurveyContentKeys } from '@/server/storage-lifecycle/entity-collectors';
import { deleteKeyRefsBySourceIds } from '@/server/storage-lifecycle/key-ref-index';
import { collectFieldLimitedSaveDiff } from '@/server/storage-lifecycle/save-diff-collector';
import { promoteSurveyResponseHeader } from '@/lib/survey/survey-image-promote';
import { generateId } from '@/lib/utils';
import { stripOptionCodes } from '@/utils/option-code-generator';

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
): Promise<{ teamId: string; ownerUserId: string; createdBy: string; assignmentStatus: 'assigned' }> {
  const scope = await resolveWorkScope(actor, requestedScope ?? null);
  if (scope.kind !== 'team') {
    throw new SurveyOwnershipRequiredError();
  }
  return {
    teamId: scope.teamId,
    ownerUserId: actor.id,
    createdBy: actor.id,
    assignmentStatus: 'assigned',
  };
}

/** 소유 팀을 정할 수 없어 설문을 만들 수 없다 — 화면은 팀을 먼저 고르라고 안내한다. */
export class SurveyOwnershipRequiredError extends Error {
  constructor() {
    super('설문을 만들려면 소유 팀을 먼저 선택해야 합니다.');
    this.name = 'SurveyOwnershipRequiredError';
  }
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

  if (existing) return { surveyId: input.id, created: false };

  const ownership = await resolveNewSurveyOwnership(actor, input.scope);

  await db.insert(surveys).values({
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
    responseHeader: (await promoteSurveyResponseHeader(input.settings.responseHeader)) ?? null,
  });

  return { surveyId: input.id, created: true };
}

// 설문 생성
export async function createSurvey(
  actor: SurveyAccessUser,
  data: CreateSurveyInput,
): Promise<SurveyRow> {
  const ownership = await resolveNewSurveyOwnership(actor, data.scope);
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
    responseHeader: (await promoteSurveyResponseHeader(data.settings?.responseHeader)) ?? null,
  };

  const [survey] = await db.insert(surveys).values(newSurvey).returning();
  if (!survey) throw new Error('createSurvey: 설문 생성 실패');

  return survey;
}

// 설문 업데이트
export async function updateSurvey(input: UpdateSurveyInput): Promise<SurveyRow> {
  const { surveyId, data } = input;

  // responseHeader 가 실려 온 경우에만 로고 tmp-to-permanent 승격 후 set(미포함 시 기존 값 보존)
  const dataToUpdate =
    data.responseHeader === undefined
      ? data
      : {
          ...data,
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

// 설문 삭제 — 질문 이미지는 R2 에서 지우지 않는다. 복제 설문·보관함(saved_questions)이
// 같은 URL 을 공유 참조할 수 있어 무확인 삭제가 다른 설문/보관함 콘텐츠를 파괴한다.
export async function deleteSurvey(input: SurveyIdInput): Promise<void> {
  const { surveyId } = input;

  // CASCADE 로 소멸될 콘텐츠 전체의 키를 삭제 전에 같은 트랜잭션에서 수집해
  // 유예 삭제 큐에 등록한다 — 삭제 후에는 참조를 복원할 수 없다.
  await db.transaction(async (tx) => {
    const { keys, versionIds } = await collectSurveyContentKeys(tx, surveyId);
    await registerDeletionCandidates(tx, {
      keys,
      source: 'survey-delete',
      reason: `설문 삭제: ${surveyId}`,
    });
    // r2_key_refs 에는 FK 가 없어 CASCADE 가 닿지 않는다. 남겨두면 소멸한
    // 버전이 인덱스로 참조를 계속 주장해 방금 등록한 후보를 전부 '보존됨'
    // 종결 상태로 닫아버린다. 가변 소스는 집행 직전 일일 리빌드가 테이블
    // 단위로 교체하므로 불변 소스인 survey_versions 만 여기서 거둔다.
    await deleteKeyRefsBySourceIds(tx, 'survey_versions', versionIds);
    await tx.delete(surveys).where(eq(surveys.id, surveyId));
  });
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
  await assertSurveyCapability(actor, surveyId, 'survey.view');

  const original = await getSurveyById(surveyId);
  if (!original) return null;

  return await db.transaction(async (tx) => {
    const originalGroups = await tx.query.questionGroups.findMany({
      where: eq(questionGroups.surveyId, surveyId),
      orderBy: [questionGroups.order],
    });

    const originalQuestions = await tx.query.questions.findMany({
      where: eq(questions.surveyId, surveyId),
      orderBy: [questions.order],
    });

    const newSurveyRows = await tx
      .insert(surveys)
      .values({
        // 복제본은 원본의 팀·공개 범위를 잇고 소유자만 복제한 사람이 된다. 팀을 잇지 않으면
        // 복제본이 배치 대기로 떨어져 만든 사람조차 목록에서 볼 수 없다.
        teamId: original.teamId,
        assignmentStatus: original.assignmentStatus,
        visibility: original.visibility,
        ownerUserId: actor.id,
        createdBy: actor.id,
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
        sumConstraints: question.sumConstraints as NewQuestion['sumConstraints'],
        dynamicRowConfigs: question.dynamicRowConfigs as NewQuestion['dynamicRowConfigs'],
        hideColumnLabels: question.hideColumnLabels,
        exportCellOrder: question.exportCellOrder ?? null,
        mobileOriginalTable: question.mobileOriginalTable,
        mobileTableDisplayMode: question.mobileTableDisplayMode,
        mobileDrilldownOmitLeadingColumns: question.mobileDrilldownOmitLeadingColumns,
        mobileDrilldownRepeatHeaderStartRow: question.mobileDrilldownRepeatHeaderStartRow,
        mobileDrilldownRepeatHeaderEndRow: question.mobileDrilldownRepeatHeaderEndRow,
        hideTitle: question.hideTitle,
        pageBreakBefore: question.pageBreakBefore,
        displayCondition: question.displayCondition as NewQuestion['displayCondition'],
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
