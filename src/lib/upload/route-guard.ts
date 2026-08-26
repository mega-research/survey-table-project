import { NextResponse } from 'next/server';

import { requireActiveAccount, requireAuth } from '@/lib/auth';
import { isGuestUser } from '@/lib/auth/guest-grants';
import type { RouteLogContext } from '@/lib/logger';

/**
 * R2 업로드 라우트 3종(image·mail-attachment·notice-attachment)의 공통 진입 가드.
 *
 * 셋 다 401 -> 행위자 바인딩 -> 403 순서가 같은데 조각이 어긋나 있었다.
 * - 401 관용구가 둘이었다. image 는 getCurrentUser null 검사, 나머지는 requireAuth try/catch.
 *   getCurrentUser 는 계정 상태를 보지 않으므로 비활성 계정을 통과시킨다.
 *   엄격한 requireAuth(세션 + status='active') 쪽으로 통일한다.
 * - role 바인딩이 라우트마다 달랐다. 같은 주석이 밝힌 목적이 "403 거부 로그에도
 *   행위자가 남아야 남용 추적이 된다" 인데 게스트가 뭉개지면 그 목적에 불리하다.
 *   guest/admin 두 갈래로 통일한다 — 로그 필드 한정 변경이고 인증·인가 판정은 그대로다.
 *
 * 허용 술어는 라우트마다 의도적으로 다르므로 주입받는다.
 */
export type UploadRouteGuardResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

/**
 * 메일 첨부·본문 이미지 — 게스트도 올린다. tmp 네임스페이스 한정이라 설문 스코프 없이 허용.
 * requireAuth 가 이미 세션 + active 를 보장하므로 추가 제한이 없다(oRPC scoped 와 동일 축).
 */
export const allowActiveUser = (): boolean => true;

/** 공지 첨부 — 게스트 차단. oRPC authed 와 동일 정책. */
export const allowAdminOnly = (userId: string): boolean => !isGuestUser(userId);

/**
 * 아바타 업로드 — 세 계정 유형 공통 진입 가드 (oRPC account 베이스의 REST 짝).
 *
 * guardUploadRoute 와 갈라져 있는 것은 인증 함수 하나 때문이다. 저쪽은 requireAuth(내부 전용)를
 * 써서 게스트·실사에게 export·업로드 표면이 열리지 않게 하고, 프로필은 세 유형 모두 자기
 * 아바타를 올려야 하므로 requireActiveAccount 를 쓴다. 이름이 다른 두 함수로 둔 이유가 이것이다 —
 * 플래그 하나로 합치면 호출부에서 어느 청중을 향한 문인지 읽히지 않는다.
 */
export async function guardAvatarUploadRoute(
  ctx: RouteLogContext,
): Promise<UploadRouteGuardResult> {
  try {
    const user = await requireActiveAccount();
    // 403 이 없는 문이라 바인딩만 남긴다 — 남용 추적에 행위자와 유형이 필요하다.
    ctx.bind({ userId: user.id, role: user.userType });
    return { ok: true, userId: user.id };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }),
    };
  }
}

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
  // 업로드 남용·권한 설정 오류 추적이 가능하다.
  ctx.bind({ userId, role: isGuestUser(userId) ? 'guest' : 'admin' });

  // 게스트가 admin 전용 업로드 표면(공지 첨부)을 두드리는 것을 차단한다.
  if (!allow(userId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 }),
    };
  }

  return { ok: true, userId };
}
