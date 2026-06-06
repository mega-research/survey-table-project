import * as z from 'zod';

import { authed } from '@/server/orpc';

import {
  AllTagsOutput,
  ExportStringOutput,
  ResponseIdInput,
  ResponsesWithAnswersInput,
  ResponsesWithAnswersOutput,
  SlugAvailableInput,
  SlugAvailableOutput,
  SurveyIdInput,
  SurveyListOutput,
  SurveyResponseArrayOutput,
  SurveyResponseOutput,
  SurveyRowArrayOutput,
  SurveyRowOutput,
  SurveyVersionListOutput,
  SurveyWithDetailsOutput,
  VariableCatalogOutput,
} from '../../domain/survey-read';
import * as responseSvc from '../services/response-read.service';
import * as surveySvc from '../services/survey-read.service';

// ─────────────────────────────────────────────────────────────────────────────
// 설문 조회 (authed)
// ─────────────────────────────────────────────────────────────────────────────

/** 설문 목록 + 질문 수 요약. */
const list = authed
  .output(SurveyListOutput)
  .handler(() => surveySvc.getSurveyListWithCounts());

/** 설문 단일 조회(cache). */
const byId = authed
  .input(SurveyIdInput)
  .output(SurveyRowOutput)
  .handler(({ input }) => surveySvc.getSurveyById(input.surveyId));

/** 설문+그룹+질문 복합 조회. */
const withDetails = authed
  .input(SurveyIdInput)
  .output(SurveyWithDetailsOutput)
  .handler(({ input }) => surveySvc.getSurveyWithDetails(input.surveyId));

/** 제목 검색. */
const search = authed
  .input(z.object({ query: z.string() }))
  .output(SurveyRowArrayOutput)
  .handler(({ input }) => surveySvc.searchSurveys(input.query));

/** 슬러그 사용 가능 여부. */
const slugAvailable = authed
  .input(SlugAvailableInput)
  .output(SlugAvailableOutput)
  .handler(({ input }) => surveySvc.isSlugAvailable(input));

/** 설문의 질문 그룹 목록. */
const questionGroups = authed
  .input(SurveyIdInput)
  .output(z.custom<Awaited<ReturnType<typeof surveySvc.getQuestionGroupsBySurvey>>>())
  .handler(({ input }) => surveySvc.getQuestionGroupsBySurvey(input.surveyId));

/** 설문의 질문 목록. */
const questions = authed
  .input(SurveyIdInput)
  .output(z.custom<Awaited<ReturnType<typeof surveySvc.getQuestionsBySurvey>>>())
  .handler(({ input }) => surveySvc.getQuestionsBySurvey(input.surveyId));

// ─────────────────────────────────────────────────────────────────────────────
// 응답 조회 (authed)
// ─────────────────────────────────────────────────────────────────────────────

/** 설문별 응답 목록(soft-delete 제외). */
const responsesBySurvey = authed
  .input(SurveyIdInput)
  .output(SurveyResponseArrayOutput)
  .handler(({ input }) => responseSvc.getResponsesBySurvey(input.surveyId));

/** 완료된 응답 목록. */
const completedResponses = authed
  .input(SurveyIdInput)
  .output(SurveyResponseArrayOutput)
  .handler(({ input }) => responseSvc.getCompletedResponses(input.surveyId));

/** 응답 단일 조회(soft-delete 제외, 1-arg). */
const responseById = authed
  .input(ResponseIdInput)
  .output(SurveyResponseOutput)
  .handler(({ input }) => responseSvc.getResponseById(input.responseId));

/** 버전별 완료 응답 + response_answers 어댑터 변환. */
const responsesWithAnswers = authed
  .input(ResponsesWithAnswersInput)
  .output(ResponsesWithAnswersOutput)
  .handler(({ input }) => responseSvc.getResponsesWithAnswers(input));

/** 설문 버전 목록(projection). */
const surveyVersions = authed
  .input(SurveyIdInput)
  .output(SurveyVersionListOutput)
  .handler(({ input }) => responseSvc.getSurveyVersions(input.surveyId));

/** 응답 내보내기 (JSON 문자열). */
const exportJson = authed
  .input(SurveyIdInput)
  .output(ExportStringOutput)
  .handler(({ input }) => responseSvc.exportResponsesAsJson(input.surveyId));

/** 응답 내보내기 (CSV 문자열). */
const exportCsv = authed
  .input(SurveyIdInput)
  .output(ExportStringOutput)
  .handler(({ input }) => responseSvc.exportResponsesAsCsv(input.surveyId));

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
  .handler(({ input }) => surveySvc.getVariableCatalogForSurvey(input.surveyId));

export const read = {
  list,
  byId,
  withDetails,
  search,
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
