// Survey Mutations (Server Actions)
export {
  createSurvey,
  updateSurvey,
  deleteSurvey,
  duplicateSurvey,
} from './survey-crud-actions';

export {
  saveSurveyDiff,
  saveSurveyWithDetails,
} from './survey-save-actions';
export type { SurveyDiffPayload } from './survey-save-actions';

export { publishSurvey } from './survey-publish-actions';

export {
  createQuestionGroup,
  updateQuestionGroup,
  deleteQuestionGroup,
  reorderGroups,
} from './question-group-actions';

export {
  createQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
} from './question-actions';

// Response Mutations (Server Actions)
export {
  startResponse,
  updateQuestionResponse,
  completeResponse,
} from './response-actions';

// Library Mutations (Server Actions)
export {
  saveQuestion,
  updateSavedQuestion,
  deleteSavedQuestion,
  applyQuestion,
  applyMultipleQuestions,
  exportLibrary,
  importLibrary,
  createCategory,
  updateCategory,
  deleteCategory,
  initializeDefaultCategories,
  initializePresetQuestions,
} from './library-actions';

// Auth Actions
export { login, logout, updatePassword, getUser } from './auth-actions';

// Query Actions (for client-side TanStack Query)
export {
  getSurveys,
  getSurveyById,
  getSurveyBySlug,
  getSurveyByPrivateToken,
  isSlugAvailable,
  searchSurveys,
  getSurveysByDateRange,
  getQuestionGroupsBySurvey,
  getQuestionsBySurvey,
  getSurveyWithDetails,
  getSurveyListWithCounts,
  getResponsesBySurvey,
  getCompletedResponses,
  getResponseById,
  getResponseCountBySurvey,
  getCompletedResponseCountBySurvey,
  calculateResponseSummary,
  getQuestionStatistics,
  exportResponsesAsJson,
  exportResponsesAsCsv,
  getAllSavedQuestions,
  getQuestionsByCategory,
  searchSavedQuestions,
  getRecentlyUsedQuestions,
  getMostUsedQuestions,
  getAllTags,
  getQuestionsByTag,
  getAllCategories,
} from './query-actions';
