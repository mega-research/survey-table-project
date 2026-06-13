import { createContext } from '@/server/context';
import { rpcHandler } from '@/server/handler';

async function handle(request: Request) {
  const { response } = await rpcHandler.handle(request, {
    prefix: '/api/rpc',
    context: await createContext(request.headers),
  });
  return response ?? new Response('Not found', { status: 404 });
}

export const GET = handle;
export const POST = handle;
