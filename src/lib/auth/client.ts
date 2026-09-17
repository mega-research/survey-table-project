import { inferAdditionalFields } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import type { auth } from '@/lib/auth/server';

/**
 * 브라우저용 인증 클라이언트. additionalFields(status·isSuperadmin 등) 타입이 추론된다.
 *
 * `typeof auth` 는 타입 전용 import 라 서버 인스턴스가 클라이언트 번들에 실리지 않는다.
 */
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>()],
});
