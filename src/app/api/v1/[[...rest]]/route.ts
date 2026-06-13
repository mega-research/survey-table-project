import { createContext } from '@/server/context';
import { isPublicApiEnabled, openapiHandler } from '@/server/openapi';

async function handle(request: Request) {
  if (!isPublicApiEnabled()) {
    return new Response('Not found', { status: 404 });
  }
  const { response } = await openapiHandler.handle(request, {
    prefix: '/api/v1',
    context: await createContext(request.headers),
  });
  return response ?? new Response('Not found', { status: 404 });
}

export const GET = handle;
export const POST = handle;
