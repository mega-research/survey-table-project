'use server';

/**
 * 클라이언트에서 호출 가능한 조회용 Server Actions
 *
 * 주의: 이 파일의 함수들은 TanStack Query에서 사용하기 위한 것입니다.
 * Server Component에서는 @/data/* 함수들을 직접 사용하세요.
 */
import * as libraryData from '@/data/library';
import * as responseData from '@/data/responses';
import * as surveyData from '@/data/surveys';
import { requireAuth } from '@/lib/auth';
import { getVariableCatalog } from '@/components/operations/mail-template/variable-catalog';
import type { VariableDef } from '@/components/operations/mail-template/variable-catalog';

// ========================
// Survey 조회
// ========================

export async function getSurveys() {
  await requireAuth();
  return surveyData.getSurveys();
}

export async function getSurveyById(surveyId: string) {
  await requireAuth();
  return surveyData.getSurveyById(surveyId);
}

export async function getSurveyBySlug(slug: string) {
  return surveyData.getSurveyBySlug(slug);
}

export async function getSurveyByPrivateToken(token: string) {
  return surveyData.getSurveyByPrivateToken(token);
}

export async function isSlugAvailable(slug: string, excludeSurveyId?: string) {
  await requireAuth();
  return surveyData.isSlugAvailable(slug, excludeSurveyId);
}

export async function searchSurveys(query: string) {
  await requireAuth();
  return surveyData.searchSurveys(query);
}

export async function getSurveysByDateRange(startDate: Date, endDate: Date) {
  await requireAuth();
  return surveyData.getSurveysByDateRange(startDate, endDate);
}

export async function getQuestionGroupsBySurvey(surveyId: string) {
  await requireAuth();
  return surveyData.getQuestionGroupsBySurvey(surveyId);
}

export async function getQuestionsBySurvey(surveyId: string) {
  await requireAuth();
  return surveyData.getQuestionsBySurvey(surveyId);
}

export async function getSurveyWithDetails(surveyId: string) {
  await requireAuth();
  return surveyData.getSurveyWithDetails(surveyId);
}

export async function getSurveyListWithCounts() {
  await requireAuth();
  return surveyData.getSurveyListWithCounts();
}

export async function getSurveyForResponse(surveyId: string) {
  return surveyData.getSurveyForResponse(surveyId);
}

// ========================
// Response 조회
// ========================

export async function getResponsesBySurvey(surveyId: string) {
  await requireAuth();
  return responseData.getResponsesBySurvey(surveyId);
}

export async function getCompletedResponses(surveyId: string) {
  await requireAuth();
  return responseData.getCompletedResponses(surveyId);
}

export async function getResponsesWithAnswers(surveyId: string, versionId?: string | null) {
  await requireAuth();
  return responseData.getResponsesWithAnswers(surveyId, versionId);
}

export async function getSurveyVersions(surveyId: string) {
  await requireAuth();
  return responseData.getSurveyVersions(surveyId);
}

export async function getResponseById(responseId: string) {
  await requireAuth();
  return responseData.getResponseById(responseId);
}

export async function getResponseCountBySurvey(surveyId: string) {
  await requireAuth();
  return responseData.getResponseCountBySurvey(surveyId);
}

export async function getCompletedResponseCountBySurvey(surveyId: string) {
  await requireAuth();
  return responseData.getCompletedResponseCountBySurvey(surveyId);
}

// ========================
// Variable Catalog (prefill)
// ========================

export async function getVariableCatalogAction(surveyId: string): Promise<VariableDef[]> {
  await requireAuth();
  return getVariableCatalog(surveyId, { purpose: 'survey' });
}

export async function exportResponsesAsJson(surveyId: string) {
  await requireAuth();
  return responseData.exportResponsesAsJson(surveyId);
}

export async function exportResponsesAsCsv(surveyId: string) {
  await requireAuth();
  return responseData.exportResponsesAsCsv(surveyId);
}

// ========================
// Library 조회
// ========================

export async function getAllTags() {
  await requireAuth();
  return libraryData.getAllTags();
}

