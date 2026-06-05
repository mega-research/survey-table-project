import { questionCategories } from '@/features/library/server/procedures/question-categories';
import { savedCells } from '@/features/library/server/procedures/saved-cells';
import { savedLookups } from '@/features/library/server/procedures/saved-lookups';
import { savedQuestions } from '@/features/library/server/procedures/saved-questions';

import { health } from './procedures/health';

export const router = {
  health,
  library: {
    savedQuestions,
    savedLookups,
    savedCells,
    questionCategories,
  },
};

export type AppRouter = typeof router;
