import { analytics } from '@/features/analytics/server/procedures/analytics';
import { auth } from '@/features/auth/server/procedures/auth';
import { attempts } from '@/features/contacts/server/procedures/attempts';
import { attrs } from '@/features/contacts/server/procedures/attrs';
import { columns } from '@/features/contacts/server/procedures/columns';
import { resultCodes } from '@/features/contacts/server/procedures/result-codes';
import { targets } from '@/features/contacts/server/procedures/targets';
import { uploads } from '@/features/contacts/server/procedures/uploads';
import { questionCategories } from '@/features/library/server/procedures/question-categories';
import { savedCells } from '@/features/library/server/procedures/saved-cells';
import { savedLookups } from '@/features/library/server/procedures/saved-lookups';
import { savedQuestions } from '@/features/library/server/procedures/saved-questions';
import { billing } from '@/features/mail/server/procedures/billing';
import { campaigns } from '@/features/mail/server/procedures/campaigns';
import { preview } from '@/features/mail/server/procedures/preview';
import { templates } from '@/features/mail/server/procedures/templates';
import { unsubscribe } from '@/features/mail/server/procedures/unsubscribe';
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
  contacts: {
    targets,
    columns,
    uploads,
    attempts,
    resultCodes,
    attrs,
  },
  mail: {
    templates,
    preview,
    campaigns,
    billing,
    unsubscribe,
  },
};

export type AppRouter = typeof router;
