import { createContext } from '@/server/context';
import { rpcHandler } from '@/server/handler';
import { scheduleSlowRpcWarning } from '@/server/rpc-timeout';

async function handle(request: Request) {
  const clearSlowWarning = scheduleSlowRpcWarning(request);

  try {
    const { response } = await rpcHandler.handle(request, {
      prefix: '/api/rpc',
      context: await createContext(request.headers),
    });
    return response ?? new Response('Not found', { status: 404 });
  } finally {
    clearSlowWarning();
  }
}

export const GET = handle;
export const POST = handle;
