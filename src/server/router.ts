import { savedQuestions } from '@/features/library/server/procedures/saved-questions';

import { health } from './procedures/health';

export const router = {
  health,
  library: {
    savedQuestions,
  },
};

export type AppRouter = typeof router;
