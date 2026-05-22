import { cache } from 'react';

import { and, desc, eq, gte, ilike, lte } from 'drizzle-orm';

import { db } from '@/db';
import { questionGroups, questions, surveys, surveyVersions } from '@/db/schema';
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
    description: survey.description ?? undefined,
    slug: survey.slug ?? undefined,
    privateToken: survey.privateToken ?? undefined,
    groups: groups.map((g) => ({
      id: g.id,
      surveyId: g.surveyId,
      name: g.name,
      description: g.description ?? undefined,
      order: g.order,
      parentGroupId: g.parentGroupId ?? undefined,
      color: g.color ?? undefined,
      collapsed: g.collapsed ?? undefined,
      displayCondition: g.displayCondition as QuestionGroup['displayCondition'],
    })),
    questions: questionList.map((q) => {
      const mapped: QuestionType = {
        id: q.id,
        type: q.type as QuestionType['type'],
        title: q.title,
        description: q.description ?? undefined,
        required: q.required,
        groupId: q.groupId ?? undefined,
        options: q.options as QuestionType['options'],
        selectLevels: q.selectLevels as QuestionType['selectLevels'],
        tableTitle: q.tableTitle ?? undefined,
        tableColumns: q.tableColumns as QuestionType['tableColumns'],
        tableRowsData: q.tableRowsData as QuestionType['tableRowsData'],
        tableHeaderGrid: q.tableHeaderGrid as QuestionType['tableHeaderGrid'],
        imageUrl: q.imageUrl ?? undefined,
        videoUrl: q.videoUrl ?? undefined,
        order: q.order,
        allowOtherOption: q.allowOtherOption ?? undefined,
        optionsColumns: q.optionsColumns ?? undefined,
        rankingConfig: (q as any).rankingConfig as QuestionType['rankingConfig'],
        minSelections: q.minSelections ?? undefined,
        maxSelections: q.maxSelections ?? undefined,
        noticeContent: q.noticeContent ?? undefined,
        requiresAcknowledgment: q.requiresAcknowledgment ?? undefined,
        placeholder: q.placeholder ?? undefined,
        defaultValueTemplate: q.defaultValueTemplate ?? undefined,
        tableValidationRules: q.tableValidationRules as QuestionType['tableValidationRules'],
        dynamicRowConfigs: q.dynamicRowConfigs as QuestionType['dynamicRowConfigs'],
        hideColumnLabels: q.hideColumnLabels ?? undefined,
        displayCondition: q.displayCondition as QuestionType['displayCondition'],
        questionCode: q.questionCode ?? undefined,
        isCustomSpssVarName: q.isCustomSpssVarName ?? undefined,
        exportLabel: q.exportLabel ?? undefined,
        spssVarType: (q as any).spssVarType ?? undefined,
        spssMeasure: (q as any).spssMeasure ?? undefined,
      };
      // strip된 셀 데이터를 hydrate (cellCode, exportLabel, spssVarType 등 복원)
      if (mapped.type === 'table' && mapped.tableRowsData && mapped.tableColumns) {
        mapped.tableRowsData = generateAllCellCodes(
          mapped.questionCode, mapped.title, mapped.tableColumns, mapped.tableRowsData,
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
      endDate: survey.endDate ?? undefined,
      maxResponses: survey.maxResponses ?? undefined,
      thankYouMessage: survey.thankYouMessage,
      requireInviteToken: survey.requireInviteToken,
    },
    lookups: survey.lookups ?? [],
    contactColumns: survey.contactColumns ?? undefined,
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
        groups: Array<{
          id: string;
          surveyId: string;
          name: string;
          description?: string;
          order: number;
          parentGroupId?: string;
          color?: string;
          collapsed?: boolean;
          displayCondition?: QuestionGroup['displayCondition'];
        }>;
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

      const surveyData: SurveyType = {
        id: survey.id,
        title: snapshot.title,
        description: snapshot.description,
        slug: survey.slug ?? undefined,
        privateToken: survey.privateToken ?? undefined,
        groups: snapshot.groups,
        questions: snapshot.questions.map((q) => {
          if (q.type === 'table' && q.tableRowsData && q.tableColumns) {
            return {
              ...q,
              tableRowsData: generateAllCellCodes(
                q.questionCode, q.title, q.tableColumns, q.tableRowsData,
              ),
            };
          }
          return q;
        }),
        settings: {
          ...snapshot.settings,
          endDate: snapshot.settings.endDate
            ? new Date(snapshot.settings.endDate)
            : undefined,
          requireInviteToken: survey.requireInviteToken,
        },
        lookups: snapshot.lookups ?? survey.lookups ?? [],
        contactColumns: survey.contactColumns ?? undefined,
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
  const surveyList = await getSurveys();

  // 각 설문의 질문 수 조회
  const surveysWithCounts = await Promise.all(
    surveyList.map(async (survey) => {
      const questionList = await db.query.questions.findMany({
        where: eq(questions.surveyId, survey.id),
      });

      return {
        id: survey.id,
        title: survey.title,
        description: survey.description,
        slug: survey.slug,
        privateToken: survey.privateToken,
        questionCount: questionList.length,
        responseCount: 0,
        createdAt: survey.createdAt,
        updatedAt: survey.updatedAt,
        isPublic: survey.isPublic,
      };
    }),
  );

  return surveysWithCounts;
}
