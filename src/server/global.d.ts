import type { RouterClient } from '@orpc/server';

import type { router } from './router';

declare global {
  // eslint-disable-next-line no-var
  var $client: RouterClient<typeof router> | undefined;
}
