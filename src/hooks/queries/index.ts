// Survey Queries
export {
  surveyKeys,
  useSurveys,
  useSurvey,
  useSaveSurvey,
  useDeleteSurvey,
  useDuplicateSurvey,
} from './use-surveys';

// Library Queries
export {
  libraryKeys,
  useSavedQuestions,
  useSearchQuestions,
  useRecentlyUsedQuestions,
  useMostUsedQuestions,
  useAllTags,
  useCategories,
  useSaveQuestion,
  useDeleteSavedQuestion,
  useApplyQuestion,
  useApplyMultipleQuestions,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useExportLibrary,
  useImportLibrary,
  useInitializeCategories,
  useInitializePresets,
} from './use-library';

// Campaign Mutations
export {
  useFetchCandidateIds,
  usePreviewPreflight,
  useCreateCampaign,
} from './use-campaigns';

// Contact Upload Mutations
export {
  useParseExcelPreview,
  useIngestContacts,
  useMatchContacts,
} from './use-contacts';

// File Cleanup Queries
export {
  fileCleanupKeys,
  useDeletionPending,
  useDeletionHistory,
  useCancelDeletion,
} from './use-file-cleanup';
export type { FileCleanupHistoryStatus } from './use-file-cleanup';
