import { serve } from 'inngest/next';

import { inngest } from '@/lib/inngest/client';
import { campaignDispatcher, campaignReconciler, r2DeletionExecutor } from '@/lib/inngest/functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [campaignDispatcher, campaignReconciler, r2DeletionExecutor],
});
