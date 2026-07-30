import 'server-only';

import { eq } from 'drizzle-orm';

import { getSurveyById } from '@/data/surveys';
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
} from '../../domain/survey';

// ========================
// 설문 CRUD 서비스
// ========================
//
// 인증은 authed 미들웨어가 담당(requireAuth 제거). 캐시 갱신(revalidatePath)은
// 소비처 query invalidation(use-survey-sync)으로 대체한다.

// 설문이 DB에 존재하는지 확인하고, 없으면 최소한의 레코드를 생성 (idempotent)
export async function ensureSurveyInDb(
  input: EnsureSurveyInDbInput,
): Promise<EnsureSurveyResult> {
  const existing = await db.query.surveys.findFirst({
    where: eq(surveys.id, input.id),
    columns: { id: true },
  });

  if (existing) return { surveyId: input.id, created: false };

  await db.insert(surveys).values({
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
export async function createSurvey(data: CreateSurveyInput): Promise<SurveyRow> {
  const newSurvey: NewSurvey = {
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

  const [updated] = await db
    .update(surveys)
    .set({
      ...dataToUpdate,
      updatedAt: new Date(),
    })
    .where(eq(surveys.id, surveyId))
    .returning();
  if (!updated) throw new Error('updateSurvey: 설문 업데이트 실패');

  return updated;
}

// 설문 삭제 — 질문 이미지는 R2 에서 지우지 않는다. 복제 설문·보관함(saved_questions)이
// 같은 URL 을 공유 참조할 수 있어 무확인 삭제가 다른 설문/보관함 콘텐츠를 파괴한다.
export async function deleteSurvey(input: SurveyIdInput): Promise<void> {
  const { surveyId } = input;

  await db.delete(surveys).where(eq(surveys.id, surveyId));
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
  input: SurveyIdInput,
): Promise<SurveyRow | null> {
  const { surveyId } = input;

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
      } satisfies CompleteQuestionWrite;
      return remapQuestionIdRefs(row, questionIdMap);
    });

    if (newQuestionsData.length > 0) {
      await tx.insert(questions).values(newQuestionsData);
    }

    return newSurvey;
  });
}
