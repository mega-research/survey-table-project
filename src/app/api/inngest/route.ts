import { serve } from 'inngest/next';

import { inngest } from '@/lib/inngest/client';
import {
  campaignDispatcher,
  campaignReconciler,
  mailFallbackSweeper,
  r2DeletionExecutor,
  r2KeyRefAudit,
} from '@/server/workflows/jobs';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    campaignDispatcher,
    campaignReconciler,
    mailFallbackSweeper,
    r2DeletionExecutor,
    r2KeyRefAudit,
  ],
});
