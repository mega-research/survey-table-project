import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
  })),
}));

vi.mock('@/data/surveys', () => ({
  getSurveys: vi.fn(),
  getSurveyById: vi.fn(),
  getSurveyBySlug: vi.fn(),
  getSurveyByPrivateToken: vi.fn(),
  isSlugAvailable: vi.fn(),
  searchSurveys: vi.fn(),
  getSurveysByDateRange: vi.fn(),
  getQuestionGroupsBySurvey: vi.fn(),
  getQuestionsBySurvey: vi.fn(),
  getSurveyWithDetails: vi.fn(),
  getSurveyListWithCounts: vi.fn(),
  getSurveyForResponse: vi.fn(),
}));

vi.mock('@/data/responses', () => ({
  getResponsesBySurvey: vi.fn(),
  getCompletedResponses: vi.fn(),
  getResponsesWithAnswers: vi.fn(),
  getSurveyVersions: vi.fn(),
  getResponseById: vi.fn(),
  getResponseCountBySurvey: vi.fn(),
  getCompletedResponseCountBySurvey: vi.fn(),
  calculateResponseSummary: vi.fn(),
  getQuestionStatistics: vi.fn(),
  exportResponsesAsJson: vi.fn(),
  exportResponsesAsCsv: vi.fn(),
}));

vi.mock('@/data/library', () => ({
  getAllSavedQuestions: vi.fn(),
  getQuestionsByCategory: vi.fn(),
  searchSavedQuestions: vi.fn(),
  getRecentlyUsedQuestions: vi.fn(),
  getMostUsedQuestions: vi.fn(),
  getAllTags: vi.fn(),
  getQuestionsByTag: vi.fn(),
  getAllCategories: vi.fn(),
}));

import {
  getSurveys,
  getResponsesBySurvey,
  exportResponsesAsJson,
  exportResponsesAsCsv,
} from '@/actions/query-actions';

describe('query-actions requires authentication', () => {
  it('getSurveys throws without auth', async () => {
    await expect(getSurveys()).rejects.toThrow('인증이 필요합니다');
  });

  it('getResponsesBySurvey throws without auth', async () => {
    await expect(getResponsesBySurvey('any-id')).rejects.toThrow('인증이 필요합니다');
  });

  it('exportResponsesAsJson throws without auth', async () => {
    await expect(exportResponsesAsJson('any-id')).rejects.toThrow('인증이 필요합니다');
  });

  it('exportResponsesAsCsv throws without auth', async () => {
    await expect(exportResponsesAsCsv('any-id')).rejects.toThrow('인증이 필요합니다');
  });
});
