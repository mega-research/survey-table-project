import * as z from 'zod';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import { toRpcWorkScopeError } from '@/server/rpc-work-scope';

import {
  AllTagsOutput,
  ExportStringOutput,
  ResponseIdInput,
  ResponsesWithAnswersInput,
  ResponsesWithAnswersOutput,
  SlugAvailableInput,
  SlugAvailableOutput,
  SurveyIdInput,
  SurveyListInput,
  SurveyListOutput,
  SurveyResponseArrayOutput,
  SurveyResponseOutput,
  SurveyRowOutput,
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
 * 설문 목록 — 작업 범위로 좁힌다(티켓 07).
 *
 * 입력의 scope 는 화면이 기억하는 값일 뿐이라 서버가 멤버십으로 다시 판정한다. 일반
 * 사용자의 system 요청은 거부되고, 내 팀이 아닌 teamId 는 첫 활성 팀으로 접힌다.
 */
const list = authed
  .input(SurveyListInput)
  .output(SurveyListOutput)
  .handler(({ context, input }) =>
    surveySvc
      .getSurveyListWithCounts(context.user, input.scope ?? null)
      // 일반 사용자의 system 요청은 코어가 거부한다 — 매핑이 없으면 그 거부가 500 이 된다.
      .catch((error: unknown) => {
        throw toRpcWorkScopeError(error);
      }),
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

/** 버전별 완료 응답 + response_answers 어댑터 변환. */
const responsesWithAnswers = authed
  .input(ResponsesWithAnswersInput)
  .output(ResponsesWithAnswersOutput)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'responses.view');
    return responseSvc.getResponsesWithAnswers(input);
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
  list,
  byId,
  withDetails,
  slugAvailable,
  questionGroups,
  questions,
  responsesBySurvey,
  completedResponses,
  responseById,
  responsesWithAnswers,
  surveyVersions,
  exportJson,
  exportCsv,
  allTags,
  variableCatalog,
};
