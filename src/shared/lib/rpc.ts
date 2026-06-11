import type { RouterClient } from '@orpc/server';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';

import type { router } from '@/server/router';

const link = new RPCLink({
  url: () => {
    if (typeof window === 'undefined') {
      throw new Error(
        'RPCLink는 클라이언트 전용입니다. RSC는 feature service를 직접 호출하세요.',
      );
    }
    return `${window.location.origin}/api/rpc`;
  },
});

/**
 * 브라우저 전용 RPC 클라이언트. RPCLink로 /api/rpc를 호출한다.
 * RSC(서버 컴포넌트)는 이 클라이언트를 쓰지 말고 feature service를 직접 호출한다.
 */
export const client: RouterClient<typeof router> = createORPCClient(link);

/** TanStack Query 통합: orpc.health.check.queryOptions() 등 */
export const orpc = createTanstackQueryUtils(client);
