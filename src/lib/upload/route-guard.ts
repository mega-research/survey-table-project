import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { isAdminUserAllowed } from '@/lib/auth/admin-allowlist';
import { isAdminOrGuestGrantHolder, isGuestUser } from '@/lib/auth/guest-grants';
import type { RouteLogContext } from '@/lib/logger';

/**
 * R2 업로드 라우트 3종(image·mail-attachment·notice-attachment)의 공통 진입 가드.
 *
 * 셋 다 401 -> 행위자 바인딩 -> 403 순서가 같은데 조각이 어긋나 있었다.
 * - 401 관용구가 둘이었다. image 는 getCurrentUser null 검사, 나머지는 requireAuth try/catch.
 *   getCurrentUser 는 supabase 의 error 를 무시하므로 error 와 user 가 함께 오는
 *   드문 경우에 통과시킨다. 엄격한 requireAuth 쪽으로 통일한다.
 * - role 바인딩이 notice 만 2분기(admin/user)였다. 같은 주석이 밝힌 목적이
 *   "403 거부 로그에도 행위자가 남아야 남용 추적이 된다" 인데 게스트가 user 로
 *   뭉개지면 그 목적에 불리하다. 3분기로 통일한다 — 로그 필드 한정 변경이고
 *   인증·인가 판정은 그대로다.
 *
 * 허용 술어는 라우트마다 의도적으로 다르므로 주입받는다.
 */
export type UploadRouteGuardResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

/** 메일 첨부·본문 이미지 — 게스트도 올린다. tmp 네임스페이스 한정이라 설문 스코프 없이 허용. */
export const allowAdminOrGuestGrant = isAdminOrGuestGrantHolder;

/** 공지 첨부 — admin allowlist 전용. oRPC authed 와 동일 정책. */
export const allowAdminOnly = isAdminUserAllowed;

export async function guardUploadRoute(
  ctx: RouteLogContext,
  allow: (userId: string) => boolean,
): Promise<UploadRouteGuardResult> {
  let userId: string;
  try {
    const user = await requireAuth();
    userId = user.id;
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }),
    };
  }

  // 권한 검사보다 먼저 바인딩 — 403 거부 로그에도 행위자(userId·role)가 남아야
  // 업로드 남용·권한 설정 오류 추적이 가능하다. 거부되는 일반 인증 계정은 'user'.
  ctx.bind({
    userId,
    role: isGuestUser(userId) ? 'guest' : isAdminUserAllowed(userId) ? 'admin' : 'user',
  });

  // ADMIN_USER_IDS 로 어드민을 잠갔을 때 임의 인증사용자의 R2 업로드 남용을 차단한다.
  if (!allow(userId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 }),
    };
  }

  return { ok: true, userId };
}
