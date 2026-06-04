import { type NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * /admin 및 /analytics 경로 보호
     * 정적 파일과 이미지는 제외
     */
    '/admin/:path*',
    '/analytics/:path*',
  ],
};
