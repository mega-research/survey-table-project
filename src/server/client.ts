import 'server-only';

import { createRouterClient } from '@orpc/server';

import { createContext } from './context';
import { router } from './router';

/**
 * RSC에서 procedure를 HTTP 없이 메모리 직접 호출하기 위한 server-side 클라이언트.
 * globalThis에 심어, shared/lib/rpc.ts의 isomorphic client가 서버에서 이걸 집어쓴다.
 * 매 요청 createContext()로 per-request 컨텍스트를 만든다.
 */
globalThis.$client = createRouterClient(router, {
  context: () => createContext(),
});
