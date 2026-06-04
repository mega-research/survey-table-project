import { cache } from 'react';

import { and, count, desc, eq, gte, ilike, lte } from 'drizzle-orm';

import { db } from '@/db';
import { questionGroups, questions, surveyVersions, surveys } from '@/db/schema';
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

// 슬러그로 설문 조회
export async function getSurveyBySlug(slug: string) {
  const survey = await db.query.surveys.findFirst({
    where: eq(surveys.slug, slug),
  });
  return survey;
}

// 비공개 토큰으로 설문 조회
export async function getSurveyByPrivateToken(token: string) {
  const survey = await db.query.surveys.findFirst({
    where: eq(surveys.privateToken, token),
  });
  return survey;
}

// 슬러그 사용 가능 여부 확인
export async function isSlugAvailable(slug: string, excludeSurveyId?: string) {
  const existing = await db.query.surveys.findFirst({
    where: excludeSurveyId
      ? and(eq(surveys.slug, slug), eq(surveys.id, excludeSurveyId))
      : eq(surveys.slug, slug),
  });
  return !existing;
}

// 설문 검색
export async function searchSurveys(query: string) {
  const result = await db.query.surveys.findMany({
    where: ilike(surveys.title, `%${query}%`),
    orderBy: [desc(surveys.createdAt)],
  });
  return result;
}

// 날짜 범위로 설문 조회
export async function getSurveysByDateRange(startDate: Date, endDate: Date) {
  const result = await db.query.surveys.findMany({
    where: and(gte(surveys.createdAt, startDate), lte(surveys.createdAt, endDate)),
    orderBy: [desc(surveys.createdAt)],
  });
  return result;
}

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
        ...(q.imageUrl != null ? { imageUrl: q.imageUrl } : {}),
        ...(q.videoUrl != null ? { videoUrl: q.videoUrl } : {}),
        order: q.order,
        ...(q.allowOtherOption != null ? { allowOtherOption: q.allowOtherOption } : {}),
        ...(q.optionsColumns != null ? { optionsColumns: q.optionsColumns } : {}),
        ...(q.rankingConfig != null ? { rankingConfig: q.rankingConfig } : {}),
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
        ...(q.hideColumnLabels != null ? { hideColumnLabels: q.hideColumnLabels } : {}),
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
      if (mapped.options && ['radio', 'checkbox', 'select', 'multiselect'].includes(mapped.type)) {
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
      thankYouMessage: survey.thankYouMessage,
      requireInviteToken: survey.requireInviteToken,
    },
    lookups: survey.lookups ?? [],
    ...(survey.contactColumns != null ? { contactColumns: survey.contactColumns } : {}),
    contactEmail: survey.contactEmail ?? null,
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt,
  };

  return surveyData;
}

// 응답 페이지용 설문 조회 (배포 버전 스냅샷 우선, fallback 기존 방식)
export async function getSurveyForResponse(
  surveyId: string,
): Promise<{ survey: SurveyType; versionId: string | null } | null> {
  const survey = await getSurveyById(surveyId);
  if (!survey) return null;

  // 배포된 버전이 있으면 스냅샷 기반으로 반환
  if (survey.currentVersionId) {
    const version = await db.query.surveyVersions.findFirst({
      where: eq(surveyVersions.id, survey.currentVersionId),
    });

    if (version && version.snapshot) {
      const snapshot = version.snapshot as {
        title: string;
        description?: string;
        questions: QuestionType[];
        groups: QuestionGroup[];
        settings: {
          isPublic: boolean;
          allowMultipleResponses: boolean;
          showProgressBar: boolean;
          shuffleQuestions: boolean;
          requireLogin: boolean;
          endDate?: string;
          maxResponses?: number;
          thankYouMessage: string;
        };
        // T17 이후 snapshot 에 포함. 이전 publish 본은 undefined → DB 의 현재 lookups 로 fallback.
        lookups?: SurveyType['lookups'];
      };

      // endDate 는 snapshot 에서 string 으로 보관되므로 spread 전에 분리해 Date 로 재구성한다
      // (base spread 가 string endDate 를 끌고오면 string | Date 로 충돌).
      const { endDate: snapshotEndDate, ...snapshotSettingsRest } = snapshot.settings;
      const surveyData: SurveyType = {
        id: survey.id,
        title: snapshot.title,
        ...(snapshot.description != null ? { description: snapshot.description } : {}),
        ...(survey.slug != null ? { slug: survey.slug } : {}),
        ...(survey.privateToken != null ? { privateToken: survey.privateToken } : {}),
        groups: snapshot.groups,
        questions: snapshot.questions.map((q) => {
          if (q.type === 'table' && q.tableRowsData && q.tableColumns) {
            return {
              ...q,
              tableRowsData: generateAllCellCodes(
                q.questionCode,
                q.title,
                q.tableColumns,
                q.tableRowsData,
              ),
            };
          }
          return q;
        }),
        settings: {
          ...snapshotSettingsRest,
          ...(snapshotEndDate ? { endDate: new Date(snapshotEndDate) } : {}),
          requireInviteToken: survey.requireInviteToken,
        },
        lookups: snapshot.lookups ?? survey.lookups ?? [],
        ...(survey.contactColumns != null ? { contactColumns: survey.contactColumns } : {}),
        contactEmail: survey.contactEmail ?? null,
        createdAt: survey.createdAt,
        updatedAt: survey.updatedAt,
      };

      return { survey: surveyData, versionId: version.id };
    }
  }

  // 미배포 설문: 기존 방식 fallback
  const surveyData = await getSurveyWithDetails(surveyId);
  if (!surveyData) return null;

  return { survey: surveyData, versionId: null };
}

// 전체 설문 목록 조회 (요약 정보)
export async function getSurveyListWithCounts() {
  // 모든 설문의 질문 수를 단일 GROUP BY 로 집계 (설문별 findMany N+1 제거)
  const [surveyList, questionCounts] = await Promise.all([
    getSurveys(),
    db
      .select({ surveyId: questions.surveyId, count: count() })
      .from(questions)
      .groupBy(questions.surveyId),
  ]);
  const questionCountMap = new Map(questionCounts.map((q) => [q.surveyId, Number(q.count)]));

  return surveyList.map((survey) => ({
    id: survey.id,
    title: survey.title,
    description: survey.description,
    slug: survey.slug,
    privateToken: survey.privateToken,
    questionCount: questionCountMap.get(survey.id) ?? 0,
    responseCount: 0,
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt,
    isPublic: survey.isPublic,
  }));
}
