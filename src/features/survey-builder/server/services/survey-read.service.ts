import 'server-only';

import { cache } from 'react';

import { and, desc, eq, ilike, ne } from 'drizzle-orm';

import { getResponseCountsGroupedBySurvey } from '@/data/responses';
import * as libraryData from '@/data/library';
import { getSurveyWithDetails as getSurveyWithDetailsData } from '@/data/surveys';
import { db } from '@/db';
import { questionGroups, questions, surveyVersions, surveys } from '@/db/schema';
import {
  getVariableCatalog,
  type VariableDef,
} from '@/components/operations/mail-template/variable-catalog';
import { normalizeQuestions } from '@/lib/question';
import { isValidTestToken } from '@/lib/survey-control';
import { normalizeResponseHeaderConfig } from '@/lib/survey/response-header-config';
import type { QuestionGroup, Question as QuestionType, Survey as SurveyType } from '@/types/survey';
import { generateAllCellCodes } from '@/utils/table-cell-code-generator';

import type {
  SlugAvailableInput,
  SurveyBySlugInput,
  SurveyByPrivateTokenInput,
  SurveyForResponseInput,
  SurveyForResponseResult,
  SurveyListItem,
} from '../../domain/survey-read';

// 이 service 는 actions/query-actions 의 requireAuth 를 제거한다.
// 관리(빌더) 경로는 procedure 의 authed 미들웨어가 인증을 대체하고,
// 공개(응답자) 경로는 pub 미들웨어로 남겨 인증 강도를 byte 보존한다.
//
// 코드 복원(generateAllOptionCodes/generateAllCellCodes)·snapshot 우선+fallback·React.cache
// 불변식(E·G)은 유지한다. getSurveyWithDetails 본문은 publish/analytics 가 공유하는
// data/surveys.ts 단일 구현에 위임해 매핑 로직 중복(신규 컬럼 누락 위험)을 제거한다.

// ========================
// 설문 조회 (authed)
// ========================

// 설문 목록 조회
export async function getSurveys() {
  const result = await db.query.surveys.findMany({
    columns: {
      id: true,
      title: true,
      description: true,
      slug: true,
      privateToken: true,
      createdAt: true,
      updatedAt: true,
      isPublic: true,
    },
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

// 슬러그 사용 가능 여부 확인
export async function isSlugAvailable(input: SlugAvailableInput): Promise<boolean> {
  const { slug, excludeSurveyId } = input;
  const existing = await db.query.surveys.findFirst({
    where: excludeSurveyId
      ? and(eq(surveys.slug, slug), ne(surveys.id, excludeSurveyId))
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

// ========================
// 질문 그룹 / 질문 조회 (authed)
// ========================

// 설문의 질문 그룹 조회
export async function getQuestionGroupsBySurvey(surveyId: string) {
  const groups = await db.query.questionGroups.findMany({
    where: eq(questionGroups.surveyId, surveyId),
    orderBy: [questionGroups.order],
  });
  return groups;
}

// 설문의 질문 조회
export async function getQuestionsBySurvey(surveyId: string) {
  const result = await db.query.questions.findMany({
    where: eq(questions.surveyId, surveyId),
    orderBy: [questions.order],
  });
  return result;
}

// ========================
// 복합 조회 (authed)
// ========================

// 전체 설문 데이터 조회 (설문 + 그룹 + 질문)
// publish/analytics 와 동일한 매핑을 보장하기 위해 data/surveys.ts 단일 구현에 위임한다.
export async function getSurveyWithDetails(surveyId: string): Promise<SurveyType | null> {
  return getSurveyWithDetailsData(surveyId);
}

// 전체 설문 목록 조회 (요약 정보)
export async function getSurveyListWithCounts(): Promise<SurveyListItem[]> {
  const surveyList = await getSurveys();
  const responseCounts = await getResponseCountsGroupedBySurvey(
    surveyList.map((survey) => survey.id),
  );

  return surveyList.map((survey) => ({
    id: survey.id,
    title: survey.title,
    description: survey.description,
    slug: survey.slug,
    privateToken: survey.privateToken,
    responseCount: responseCounts.get(survey.id)?.total ?? 0,
    completedResponseCount: responseCounts.get(survey.id)?.completed ?? 0,
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt,
    isPublic: survey.isPublic,
  }));
}

// ========================
// 공개(pub) 응답자 조회 — requireAuth 없음
// ========================

// 슬러그로 설문 조회
export async function getSurveyBySlug(input: SurveyBySlugInput) {
  const survey = await db.query.surveys.findFirst({
    where: eq(surveys.slug, input.slug),
  });
  return survey;
}

// 비공개 토큰으로 설문 조회
export async function getSurveyByPrivateToken(input: SurveyByPrivateTokenInput) {
  const survey = await db.query.surveys.findFirst({
    where: eq(surveys.privateToken, input.token),
  });
  return survey;
}

// 응답 페이지용 설문 조회 (배포 버전 스냅샷 우선, fallback 기존 방식)
export async function getSurveyForResponse(
  input: SurveyForResponseInput,
  options: { requirePublished?: boolean } = {},
): Promise<SurveyForResponseResult> {
  const { surveyId } = input;
  const survey = await getSurveyById(surveyId);
  if (!survey) return null;

  // 응답 페이지 첫 화면 게이트용 라이브 제어값. snapshot 밖 값이므로 항상 현재
  // surveys 행에서 읽는다 — snapshot.settings 에서 가져오면 안 된다.
  const testSession: 'none' | 'valid' | 'invalid' =
    input.testToken == null
      ? 'none'
      : isValidTestToken(survey, input.testToken)
        ? 'valid'
        : 'invalid';
  const control = {
    isPaused: survey.isPaused,
    pausedMessage: survey.pausedMessage,
    testSession,
  };

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
          // publish 시점 freeze 값. 이전 publish 본은 undefined → 현재 surveys 행으로 fallback.
          requireInviteToken?: boolean;
          responseHeader?: SurveyType['settings']['responseHeader'];
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
        // survey_versions 스냅샷 읽기 경계(공개 응답자 경로): 세대별 키셋이 다른 질문을
        // 정규화(보존 모드)로 수렴 — 무변형 passthrough, 알 수 없는 형태만 관측 로그.
        // 이후 table 셀 코드 복원 불변식은 동일하게 유지한다.
        questions: normalizeQuestions(snapshot.questions).map((q) => {
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
          // snapshot 기반 원칙: published 응답 페이지는 freeze 된 snapshot 값을 따른다.
          // 빌더 draft 의 invite-token 토글이 live 응답 페이지에 새지 않도록 현재 surveys 행으로
          // 덮어쓰지 않는다. snapshot 에 값이 없는 이전 publish 본만 현재 행으로 fallback.
          requireInviteToken: snapshot.settings.requireInviteToken ?? survey.requireInviteToken,
          // snapshot 기반 원칙 동일: published 응답 페이지는 freeze 된 snapshot 값을 따른다.
          // 값이 없는 이전 publish 본은 현재 surveys 행이 아니라 새 기본형으로 fallback.
          responseHeader: normalizeResponseHeaderConfig(snapshot.settings.responseHeader),
        },
        lookups: snapshot.lookups ?? survey.lookups ?? [],
        ...(survey.contactColumns != null ? { contactColumns: survey.contactColumns } : {}),
        quotaGate:
          survey.quotaConfig && survey.quotaConfig.enabled
            ? { questionIds: survey.quotaConfig.dimensions.map((d) => d.questionId) }
            : null,
        contactEmail: survey.contactEmail ?? null,
        createdAt: survey.createdAt,
        updatedAt: survey.updatedAt,
      };

      return { survey: surveyData, versionId: version.id, control };
    }
  }

  if (options.requirePublished) return null;

  // 미배포 설문: 기존 방식 fallback
  const surveyData = await getSurveyWithDetails(surveyId);
  if (!surveyData) return null;

  const quotaGate =
    survey.quotaConfig && survey.quotaConfig.enabled
      ? { questionIds: survey.quotaConfig.dimensions.map((d) => d.questionId) }
      : null;

  return { survey: { ...surveyData, quotaGate }, versionId: null, control };
}

// ========================
// Library 태그 / Variable Catalog (authed)
// ========================

// 보관함 질문 전체에서 사용 중인 태그 목록 (data/library 위임 — 코드 변경 없음)
export async function getAllTags(): Promise<string[]> {
  return libraryData.getAllTags();
}

// 빌더 변수 메뉴(prefill)용 카탈로그. getVariableCatalog 는 이미 server-only + React.cache.
// 이동하지 않고 제자리 import (불변식 — cache 유지).
export async function getVariableCatalogForSurvey(surveyId: string): Promise<VariableDef[]> {
  return getVariableCatalog(surveyId, { purpose: 'survey' });
}
