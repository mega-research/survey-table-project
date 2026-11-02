import { ORPCError } from '@orpc/server';
import * as z from 'zod';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc, toRpcSurveyAccessError } from '@/server/rpc-survey-access';
import { toRpcWorkScopeError } from '@/server/rpc-work-scope';

import {
  AllTagsOutput,
  ExportStringOutput,
  ResponseIdInput,
  SlugAvailableInput,
  SlugAvailableOutput,
  SurveyIdInput,
  SurveyListPageInput,
  SurveyListPageOutput,
  SurveyListQueryError,
  SurveyResponseArrayOutput,
  SurveyResponseOutput,
  SurveyRowOutput,
  SurveySuggestInput,
  SurveySuggestOutput,
  SurveySummaryListInput,
  SurveySummaryListOutput,
  SurveyVersionListOutput,
  SurveyWithDetailsOutput,
  VariableCatalogOutput,
} from '../domain/survey-read';
import * as responseSvc from '../services/response-read';
import * as surveySvc from '../services/survey-read';

// ─────────────────────────────────────────────────────────────────────────────
// 설문 조회 (authed)
//
// surveyId 를 받는 procedure 는 전부 handler 첫 줄에서 capability 관문을 지난다
// (역할 모델 v2 티켓 09). 설문 구조는 survey.view, 응답은 responses.view,
// 내보내기는 export.download — 스펙 §8 매트릭스의 열이 그대로 코드가 된다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 목록 조회(페이지·사이드바 요약·자동완성)의 거부 → RPC 에러. 매핑이 없으면 그 거부가 500 이 된다.
 *
 * - 일반 사용자의 system 요청(`WorkScopeError`)·휴지통 권한 없음(`SurveyAccessError`) → FORBIDDEN
 * - 내 것이 아닌 태그로 거르기(`SurveyListQueryError` tag_not_found) → NOT_FOUND, 태그 문구
 * - 휴지통에 즐겨찾기·태그 조건(`SurveyListQueryError` trash_with_personal_marks) → BAD_REQUEST
 */
function rethrowListError(error: unknown): never {
  if (error instanceof SurveyListQueryError) {
    throw error.reason === 'tag_not_found'
      ? new ORPCError('NOT_FOUND', { message: '태그를 찾을 수 없습니다.' })
      : new ORPCError('BAD_REQUEST', {
          message: '휴지통에서는 즐겨찾기·태그로 거를 수 없습니다.',
        });
  }
  throw toRpcSurveyAccessError(toRpcWorkScopeError(error));
}

/**
 * 설문 목록 한 페이지 — 서버가 거르고 정렬하고 24개씩 나눈다(설문 즐겨찾기·태그 티켓 03).
 *
 * 입력의 scope 는 화면이 기억하는 값일 뿐이라 서버가 멤버십으로 다시 판정한다. 일반 사용자의
 * system 요청은 거부되고, 내 팀이 아닌 teamId 는 첫 활성 팀으로 접힌다. 휴지통(deleted)은
 * 슈퍼어드민의 시스템 범위에서만 열린다.
 *
 * 전체 목록 조회(구 `read.list`)는 RPC 표면에서 걷었다 — 남은 소비자(분석 페이지)는 RSC 가
 * 서비스를 직접 부른다.
 */
const listPage = authed
  .input(SurveyListPageInput)
  .output(SurveyListPageOutput)
  .handler(({ context, input }) =>
    surveySvc.listSurveyPage(context.user, input).catch(rethrowListError),
  );

/**
 * 사이드바 요약 — 목록과 같은 작업 범위 필터, 응답 수 없음(설문 즐겨찾기·태그 티켓 02).
 *
 * 실사팀 사이드바의 참여 트리가 팀 → 그룹 → 미분류 묶음을 센다. 목록이 페이지 단위로
 * 바뀌어도 사이드바가 범위 전체를 세도록 목록 조회와 분리했다.
 */
const listSummaries = authed
  .input(SurveySummaryListInput)
  .output(SurveySummaryListOutput)
  .handler(({ context, input }) =>
    surveySvc.listSurveySummaries(context.user, input.scope ?? null).catch(rethrowListError),
  );

/**
 * 자동완성 설문 후보 — 작업 범위 + 검색어 → 최대 5건(설문 즐겨찾기·태그 티켓 05).
 *
 * 목록 페이지와 같은 범위 필터·같은 검색 조각을 타므로 볼 수 없는 설문은 후보에 안 나온다.
 * 응답 수는 세지 않는다. 서버 캐시 없음 — 같은 검색어는 화면의 TanStack Query 가 기억한다.
 */
const suggest = authed
  .input(SurveySuggestInput)
  .output(SurveySuggestOutput)
  .handler(({ context, input }) =>
    surveySvc.suggestSurveys(context.user, input).catch(rethrowListError),
  );

/** 설문 단일 조회(cache). */
const byId = authed
  .input(SurveyIdInput)
  .output(SurveyRowOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.view');
    return surveySvc.getSurveyById(input.surveyId);
  });

/** 설문+그룹+질문 복합 조회. */
const withDetails = authed
  .input(SurveyIdInput)
  .output(SurveyWithDetailsOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.view');
    return surveySvc.getSurveyWithDetails(input.surveyId);
  });

/** 슬러그 사용 가능 여부. */
const slugAvailable = authed
  .input(SlugAvailableInput)
  .output(SlugAvailableOutput)
  .handler(({ input }) => surveySvc.isSlugAvailable(input));

/** 설문의 질문 그룹 목록. */
const questionGroups = authed
  .input(SurveyIdInput)
  .output(z.custom<Awaited<ReturnType<typeof surveySvc.getQuestionGroupsBySurvey>>>())
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.view');
    return surveySvc.getQuestionGroupsBySurvey(input.surveyId);
  });

/** 설문의 질문 목록. */
const questions = authed
  .input(SurveyIdInput)
  .output(z.custom<Awaited<ReturnType<typeof surveySvc.getQuestionsBySurvey>>>())
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.view');
    return surveySvc.getQuestionsBySurvey(input.surveyId);
  });

// ─────────────────────────────────────────────────────────────────────────────
// 응답 조회 (authed)
// ─────────────────────────────────────────────────────────────────────────────

/** 설문별 응답 목록(soft-delete 제외). */
const responsesBySurvey = authed
  .input(SurveyIdInput)
  .output(SurveyResponseArrayOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'responses.view');
    return responseSvc.getResponsesBySurvey(input.surveyId);
  });

/** 완료된 응답 목록. */
const completedResponses = authed
  .input(SurveyIdInput)
  .output(SurveyResponseArrayOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'responses.view');
    return responseSvc.getCompletedResponses(input.surveyId);
  });

/** 응답 단일 조회(soft-delete 제외, 설문 스코프 봉인). */
const responseById = authed
  .input(ResponseIdInput)
  .output(SurveyResponseOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'responses.view');
    return responseSvc.getResponseById(input.responseId, input.surveyId);
  });

/** 설문 버전 목록(projection). */
const surveyVersions = authed
  .input(SurveyIdInput)
  .output(SurveyVersionListOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.view');
    return responseSvc.getSurveyVersions(input.surveyId);
  });

/** 응답 내보내기 (JSON 문자열). */
const exportJson = authed
  .input(SurveyIdInput)
  .output(ExportStringOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'export.download');
    return responseSvc.exportResponsesAsJson(input.surveyId);
  });

/** 응답 내보내기 (CSV 문자열). */
const exportCsv = authed
  .input(SurveyIdInput)
  .output(ExportStringOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'export.download');
    return responseSvc.exportResponsesAsCsv(input.surveyId);
  });

// ─────────────────────────────────────────────────────────────────────────────
// Library 태그 / Variable Catalog (authed)
// ─────────────────────────────────────────────────────────────────────────────

/** 보관함 질문 태그 목록. */
const allTags = authed
  .output(AllTagsOutput)
  .handler(() => surveySvc.getAllTags());

/** 빌더 변수 메뉴(prefill) 카탈로그. */
const variableCatalog = authed
  .input(SurveyIdInput)
  .output(VariableCatalogOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.view');
    return surveySvc.getVariableCatalogForSurvey(input.surveyId);
  });

export const read = {
  listPage,
  listSummaries,
  suggest,
  byId,
  withDetails,
  slugAvailable,
  questionGroups,
  questions,
  responsesBySurvey,
  completedResponses,
  responseById,
  surveyVersions,
  exportJson,
  exportCsv,
  allTags,
  variableCatalog,
};
