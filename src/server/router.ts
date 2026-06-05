import { analytics } from '@/features/analytics/server/procedures/analytics';
import { auth } from '@/features/auth/server/procedures/auth';
import { questionCategories } from '@/features/library/server/procedures/question-categories';
import { savedCells } from '@/features/library/server/procedures/saved-cells';
import { savedLookups } from '@/features/library/server/procedures/saved-lookups';
import { savedQuestions } from '@/features/library/server/procedures/saved-questions';
import { media } from '@/features/media/server/procedures/media';

import { health } from './procedures/health';

export const router = {
  health,
  library: {
    savedQuestions,
    savedLookups,
    savedCells,
    questionCategories,
  },
  auth,
  media,
  analytics,
};

export type AppRouter = typeof router;
