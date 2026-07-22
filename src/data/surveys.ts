import { cache } from 'react';

import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { questionGroups, questions, surveys } from '@/db/schema';
import { retentionTimestampToDate } from '@/lib/survey/pii-retention';
import { normalizeResponseHeaderConfig } from '@/lib/survey/response-header-config';
import { isCodedChoiceType } from '@/types/question-types';
import type { QuestionGroup, Question as QuestionType, Survey as SurveyType } from '@/types/survey';
import { generateAllOptionCodes } from '@/utils/option-code-generator';
import { generateAllCellCodes } from '@/utils/table-cell-code-generator';

// ========================
// 설문 조회 함수
// ========================

// 설문 목록 조회
export async function getSurveys() {
  const result = await db.query.surveys.findMany({
    orderBy: [desc(surveys.createdAt)],
  });
  return result;
}

// 설문 단일 조회. React `cache()` 로 동일 RSC pass 내 중복 호출을 dedupe
// (예: layout 과 page 가 같은 surveyId 를 동시에 조회해도 DB 한 번).
export const getSurveyById = cache(async (surveyId: string) => {
  const survey = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
  });
  return survey;
});

// ========================
// 질문 그룹 조회 함수
// ========================

// 설문의 질문 그룹 조회
export async function getQuestionGroupsBySurvey(surveyId: string) {
  const groups = await db.query.questionGroups.findMany({
    where: eq(questionGroups.surveyId, surveyId),
    orderBy: [questionGroups.order],
  });
  return groups;
}

// ========================
// 질문 조회 함수
// ========================

// 설문의 질문 조회
export async function getQuestionsBySurvey(surveyId: string) {
  const result = await db.query.questions.findMany({
    where: eq(questions.surveyId, surveyId),
    orderBy: [questions.order],
  });
  return result;
}

// ========================
// 복합 조회 함수
// ========================

// 전체 설문 데이터 조회 (설문 + 그룹 + 질문)
export async function getSurveyWithDetails(surveyId: string): Promise<SurveyType | null> {
  const survey = await getSurveyById(surveyId);
  if (!survey) return null;

  const groups = await getQuestionGroupsBySurvey(surveyId);
  const questionList = await getQuestionsBySurvey(surveyId);

  // DB 데이터를 클라이언트 타입으로 변환
  const surveyData: SurveyType = {
    id: survey.id,
    title: survey.title,
    ...(survey.description != null ? { description: survey.description } : {}),
    ...(survey.slug != null ? { slug: survey.slug } : {}),
    ...(survey.privateToken != null ? { privateToken: survey.privateToken } : {}),
    groups: groups.map((g) => ({
      id: g.id,
      surveyId: g.surveyId,
      name: g.name,
      ...(g.description != null ? { description: g.description } : {}),
      order: g.order,
      ...(g.parentGroupId != null ? { parentGroupId: g.parentGroupId } : {}),
      ...(g.color != null ? { color: g.color } : {}),
      ...(g.collapsed != null ? { collapsed: g.collapsed } : {}),
      ...(g.hideName != null ? { hideName: g.hideName } : {}),
      ...(g.nameDesign != null ? { nameDesign: g.nameDesign as NonNullable<QuestionGroup['nameDesign']> } : {}),
      ...(g.displayCondition != null ? { displayCondition: g.displayCondition as NonNullable<QuestionGroup['displayCondition']> } : {}),
    })),
    questions: questionList.map((q) => {
      const mapped: QuestionType = {
        id: q.id,
        type: q.type as QuestionType['type'],
        title: q.title,
        ...(q.description != null ? { description: q.description } : {}),
        required: q.required,
        ...(q.groupId != null ? { groupId: q.groupId } : {}),
        ...(q.options != null ? { options: q.options as NonNullable<QuestionType['options']> } : {}),
        ...(q.selectLevels != null ? { selectLevels: q.selectLevels as NonNullable<QuestionType['selectLevels']> } : {}),
        ...(q.tableTitle != null ? { tableTitle: q.tableTitle } : {}),
        ...(q.tableColumns != null ? { tableColumns: q.tableColumns as NonNullable<QuestionType['tableColumns']> } : {}),
        ...(q.tableRowsData != null ? { tableRowsData: q.tableRowsData as NonNullable<QuestionType['tableRowsData']> } : {}),
        ...(q.tableHeaderGrid != null ? { tableHeaderGrid: q.tableHeaderGrid as NonNullable<QuestionType['tableHeaderGrid']> } : {}),
        order: q.order,
        ...(q.allowOtherOption != null ? { allowOtherOption: q.allowOtherOption } : {}),
        ...(q.optionsColumns != null ? { optionsColumns: q.optionsColumns } : {}),
        ...(q.optionsAlign != null ? { optionsAlign: q.optionsAlign } : {}),
        ...(q.rankingConfig != null ? { rankingConfig: q.rankingConfig } : {}),
        ...(q.choiceGroups != null ? { choiceGroups: q.choiceGroups } : {}),
        ...(q.minSelections != null ? { minSelections: q.minSelections } : {}),
        ...(q.maxSelections != null ? { maxSelections: q.maxSelections } : {}),
        ...(q.noticeContent != null ? { noticeContent: q.noticeContent } : {}),
        ...(q.requiresAcknowledgment != null ? { requiresAcknowledgment: q.requiresAcknowledgment } : {}),
        ...(q.placeholder != null ? { placeholder: q.placeholder } : {}),
        ...(q.defaultValueTemplate != null ? { defaultValueTemplate: q.defaultValueTemplate } : {}),
        ...((q.inputType as 'text' | 'number' | null) != null ? { inputType: q.inputType as 'text' | 'number' } : {}),
        ...(q.emptyDefault != null ? { emptyDefault: q.emptyDefault } : {}),
        ...(q.tableValidationRules != null ? { tableValidationRules: q.tableValidationRules as NonNullable<QuestionType['tableValidationRules']> } : {}),
        ...(q.dynamicRowConfigs != null ? { dynamicRowConfigs: q.dynamicRowConfigs as NonNullable<QuestionType['dynamicRowConfigs']> } : {}),
        ...(q.numberFormat != null ? { numberFormat: q.numberFormat as NonNullable<QuestionType['numberFormat']> } : {}),
        ...(q.sumConstraints != null ? { sumConstraints: q.sumConstraints as NonNullable<QuestionType['sumConstraints']> } : {}),
        ...(q.hideColumnLabels != null ? { hideColumnLabels: q.hideColumnLabels } : {}),
        ...(q.mobileOriginalTable != null ? { mobileOriginalTable: q.mobileOriginalTable } : {}),
        ...(q.mobileTableDisplayMode != null
          ? { mobileTableDisplayMode: q.mobileTableDisplayMode }
          : {}),
        ...(q.mobileDrilldownOmitLeadingColumns != null
          ? { mobileDrilldownOmitLeadingColumns: q.mobileDrilldownOmitLeadingColumns }
          : {}),
        mobileDrilldownRepeatHeaderStartRow: q.mobileDrilldownRepeatHeaderStartRow,
        mobileDrilldownRepeatHeaderEndRow: q.mobileDrilldownRepeatHeaderEndRow,
        ...(q.hideTitle != null ? { hideTitle: q.hideTitle } : {}),
        ...(q.pageBreakBefore != null ? { pageBreakBefore: q.pageBreakBefore } : {}),
        ...(q.displayCondition != null ? { displayCondition: q.displayCondition as NonNullable<QuestionType['displayCondition']> } : {}),
        ...(q.questionCode != null ? { questionCode: q.questionCode } : {}),
        ...(q.isCustomSpssVarName != null ? { isCustomSpssVarName: q.isCustomSpssVarName } : {}),
        ...(q.exportLabel != null ? { exportLabel: q.exportLabel } : {}),
        ...(q.spssVarType != null ? { spssVarType: q.spssVarType as NonNullable<QuestionType['spssVarType']> } : {}),
        ...(q.spssMeasure != null ? { spssMeasure: q.spssMeasure as NonNullable<QuestionType['spssMeasure']> } : {}),
      };
      // strip된 셀 데이터를 hydrate (cellCode, exportLabel, spssVarType 등 복원)
      if (mapped.type === 'table' && mapped.tableRowsData && mapped.tableColumns) {
        mapped.tableRowsData = generateAllCellCodes(
          mapped.questionCode,
          mapped.title,
          mapped.tableColumns,
          mapped.tableRowsData,
        );
      }
      // 일반 질문 옵션 코드 복원
      if (mapped.options && isCodedChoiceType(mapped.type)) {
        mapped.options = generateAllOptionCodes(mapped.options);
      }
      return mapped;
    }),
    settings: {
      isPublic: survey.isPublic,
      allowMultipleResponses: survey.allowMultipleResponses,
      showProgressBar: survey.showProgressBar,
      shuffleQuestions: survey.shuffleQuestions,
      requireLogin: survey.requireLogin,
      ...(survey.endDate != null ? { endDate: survey.endDate } : {}),
      ...(survey.maxResponses != null ? { maxResponses: survey.maxResponses } : {}),
      ...(survey.piiRetentionUntil
        ? { piiRetentionUntil: retentionTimestampToDate(survey.piiRetentionUntil) }
        : {}),
      thankYouMessage: survey.thankYouMessage,
      requireInviteToken: survey.requireInviteToken,
      responseHeader: normalizeResponseHeaderConfig(survey.responseHeader),
    },
    lookups: survey.lookups ?? [],
    ...(survey.contactColumns != null ? { contactColumns: survey.contactColumns } : {}),
    contactEmail: survey.contactEmail ?? null,
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt,
  };

  return surveyData;
}
