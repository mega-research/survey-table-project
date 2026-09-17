import { NextResponse } from 'next/server';

import { requireActiveAccount, requireAuth } from '@/lib/auth';
import type { RouteLogContext } from '@/lib/logger';
import { type AuthUser, isInternalUser, logRoleForUserType } from '@/shared/contracts/auth';

/**
 * R2 업로드 라우트 4종(image·mail-attachment·notice-attachment·avatar)의 진입 가드.
 * 아래 guardUploadRoute 는 앞 3종(내부 전용), guardAvatarUploadRoute 는 avatar(세 유형 공통).
 *
 * 셋 다 401 -> 행위자 바인딩 -> 403 순서가 같은데 조각이 어긋나 있었다.
 * - 401 관용구가 둘이었다. image 는 getCurrentUser null 검사, 나머지는 requireAuth try/catch.
 *   getCurrentUser 는 계정 상태를 보지 않으므로 비활성 계정을 통과시킨다.
 *   엄격한 requireAuth(세션 + status='active') 쪽으로 통일한다.
 * - role 바인딩이 라우트마다 달랐다. 같은 주석이 밝힌 목적이 "403 거부 로그에도
 *   행위자가 남아야 남용 추적이 된다" 인데 유형이 뭉개지면 그 목적에 불리하다.
 *   어휘는 `logRoleForUserType`(shared/contracts/auth) 하나가 소유하고 rpc 로그와 공유한다.
 *
 * 허용 술어는 라우트마다 의도적으로 다르므로 주입받는다.
 *
 * 설문 capability 관문(티켓 09~11)은 여기 없다 — 의도된 면제다. 업로드 요청에는
 * surveyId 자체가 없고 쓰기는 tmp/ 네임스페이스(설문 미귀속 R2 키)에 갇힌다. 설문에
 * 닿는 것은 영구 승격 시점이고 그 경로(설문 저장 survey.edit · 메일 템플릿 저장
 * mail.send · media.* RPC)가 capability 관문을 진다. 여기에 관문을 달려면 업로드
 * 계약에 surveyId 를 신설해야 하는데 지키는 것이 없다 (티켓 11 전수 검토).
 */
export type UploadRouteGuardResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

/**
 * 메일 첨부·본문 이미지 — tmp 네임스페이스 한정이라 설문 스코프 없이 허용한다.
 * requireAuth 가 이미 세션 + active + 내부 계정을 보장하므로 추가 제한이 없다.
 */
export const allowActiveUser = (): boolean => true;

/**
 * 공지 첨부 — 내부 계정 전용. oRPC authed 와 동일 정책.
 *
 * 티켓 21 이후 requireAuth 가 이미 같은 것을 보장하므로 이 술어는 두 번째 겹이다. 굳이
 * 남기는 이유는 이 자리가 **정책을 적는 자리**이기 때문이다 — 위 allowActiveUser 와 나란히
 * 서 있어야 두 업로드 표면의 청중이 다르다는 사실이 코드에 남는다.
 */
export const allowAdminOnly = (user: AuthUser): boolean => isInternalUser(user.userType);

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
    // 403 이 없는 문이라 바인딩만 남긴다 — 남용 추적에 행위자가 필요하다.
    // role 어휘는 rpc 로그와 한 함수를 공유한다(logRoleForUserType). 계정 유형은 별도
    // 필드로 싣는다 — 같은 필드에 두 어휘가 섞이면 로그 분석이 갈린다.
    ctx.bind({
      userId: user.id,
      role: logRoleForUserType(user.userType),
      userType: user.userType,
    });
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
  allow: (user: AuthUser) => boolean,
): Promise<UploadRouteGuardResult> {
  let user: AuthUser;
  try {
    user = await requireAuth();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 }),
    };
  }

  // 권한 검사보다 먼저 바인딩 — 403 거부 로그에도 행위자(userId·role)가 남아야
  // 업로드 남용·권한 설정 오류 추적이 가능하다.
  ctx.bind({ userId: user.id, role: logRoleForUserType(user.userType) });

  if (!allow(user)) {
    return {
      ok: false,
      response: NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 }),
    };
  }

  return { ok: true, userId: user.id };
}

