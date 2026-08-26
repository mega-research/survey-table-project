import 'server-only';

import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { users } from '@/db/schema';
import { auth } from '@/lib/auth/server';
import { MIN_PASSWORD_LENGTH } from '@/shared/contracts/auth-io';

import { InvalidAvatarUrlError } from '../domain/auth';
import type {
  ProfileView,
  UpdatePasswordInput,
  UpdatePasswordOutput,
  UpdateProfileInput,
  UpdateProfileOutput,
} from '../domain/auth';
import { UserNotFoundError } from '../domain/users';

/**
 * 비밀번호 변경 — 확인 일치·최소 길이 검증 후 Better Auth 에 위임한다.
 * 현재 비밀번호 재인증과 해시 교체는 changePassword 가 한 번에 처리한다.
 *
 * 검증 실패/재인증 실패는 throw 대신 { error } 로 반환(기존 action UX 유지).
 * 다른 기기 세션은 함께 폐기한다(revokeOtherSessions) — 비밀번호를 바꾸는 이유가
 * 대개 유출 의심이라 남겨두면 목적을 잃는다.
 */
export async function updatePassword(
  headers: Headers | undefined,
  input: UpdatePasswordInput,
): Promise<UpdatePasswordOutput> {
  const { currentPassword, newPassword, confirmPassword } = input;

  if (newPassword !== confirmPassword) {
    return { error: '새 비밀번호가 일치하지 않습니다.' };
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { error: `비밀번호는 최소 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` };
  }
  // authed 를 통과했으면 세션이 있으므로 headers 도 있다. RSC 직접 호출 등 headers 를
  // 채우지 않은 경로는 세션을 증명할 수 없으니 거부한다.
  if (!headers) {
    return { error: '로그인이 필요합니다.' };
  }

  try {
    await auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers,
    });
  } catch (err) {
    // changePassword 가 APIError 를 던지는 경우는 현재 비밀번호 불일치가 사실상 전부다
    // (세션·입력 검증은 위에서 이미 통과). 그 외 예외는 그대로 올려 500 으로 남긴다.
    if (err instanceof APIError) {
      return { error: '현재 비밀번호가 올바르지 않습니다.' };
    }
    throw err;
  }

  return { success: true };
}

/**
 * 내 프로필 조회 — 세션이 아니라 DB 를 읽는다.
 *
 * 아바타 URL 은 세션 페이로드에 없고, 직책·소속은 사용자 관리에서 다른 사람이 바꿀 수 있어
 * 세션 발급 시점 값이 낡아 있을 수 있다.
 */
export async function getProfile(userId: string): Promise<ProfileView> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      name: true,
      email: true,
      image: true,
      userType: true,
      jobTitle: true,
      organization: true,
    },
  });
  // 세션이 가리키는 행이 없다 — 삭제된 계정의 세션이 살아 있는 경우뿐이다.
  if (!row) throw new UserNotFoundError();
  return row;
}

/**
 * 아바타 URL 이 우리 R2 공개 URL 인지 확인한다.
 *
 * 경계(zod)는 길이와 문자열 여부까지만 본다 — "우리 것인가" 는 env 를 봐야 알 수 있어
 * 서버에서만 판정할 수 있다. R2 env 가 없는 환경(로컬 일부·테스트)에서는 외부 URL 을
 * 통과시키는 대신 아바타 설정 자체를 거부한다 — 열어두는 쪽이 조용히 위험하다.
 */
function assertOwnAvatarUrl(url: string): void {
  const publicUrl = process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  if (!publicUrl) throw new InvalidAvatarUrlError();
  if (!url.startsWith(`${publicUrl}/`)) throw new InvalidAvatarUrlError();
}

/**
 * 내 프로필 수정 — 이름과 아바타만.
 *
 * 이메일·직책·소속·유형·상태는 입력에 없다(UpdateProfileInput 주석 참조). 대상은 항상
 * 호출자 자신이라 userId 를 입력에서 받지 않는다.
 */
export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<UpdateProfileOutput> {
  if (input.image !== null) assertOwnAvatarUrl(input.image);

  const [updated] = await db
    .update(users)
    .set({ name: input.name, image: input.image, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      userType: users.userType,
      jobTitle: users.jobTitle,
      organization: users.organization,
    });
  if (!updated) throw new UserNotFoundError();
  return updated;
}
