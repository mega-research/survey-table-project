import 'server-only';

import { APIError } from 'better-auth/api';

import { auth } from '@/lib/auth/server';

import type { UpdatePasswordInput, UpdatePasswordOutput } from '../domain/auth';

/** Better Auth 최소 비밀번호 길이(lib/auth/server.ts emailAndPassword.minPasswordLength)와 동일. */
const MIN_PASSWORD_LENGTH = 8;

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
