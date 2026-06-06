import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AuthUser } from '@/server/context';

import type { UpdatePasswordInput, UpdatePasswordOutput } from '../../domain/auth';

/**
 * 현재 supabase 세션 사용자를 조회.
 * 익명(미인증)이면 null 반환. pub procedure 에서 호출되므로 인증 강제 없음.
 *
 * 반환은 supabase User -> 도메인 AuthUser 명시 매핑.
 * email 은 string | undefined -> string | null 로 정규화(세탁 금지).
 */
export async function getUser(supabase: SupabaseClient): Promise<AuthUser | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return {
    id: user.id,
    email: user.email ?? null,
  };
}

/**
 * 비밀번호 변경 — 검증 로직(확인 일치/최소 길이/현재 비번 재인증) 포함.
 * authed procedure 에서 호출되며, context.user(non-null) 를 전달받는다.
 *
 * 검증 실패/재인증 실패는 throw 대신 { error } 로 반환(기존 action UX 유지).
 * supabase.auth.signInWithPassword 로 현재 비밀번호를 재인증한 뒤 updateUser.
 */
export async function updatePassword(
  supabase: SupabaseClient,
  user: AuthUser,
  input: UpdatePasswordInput,
): Promise<UpdatePasswordOutput> {
  const { currentPassword, newPassword, confirmPassword } = input;

  // 새 비밀번호 확인
  if (newPassword !== confirmPassword) {
    return { error: '새 비밀번호가 일치하지 않습니다.' };
  }

  // 비밀번호 최소 요구사항 검증
  if (newPassword.length < 6) {
    return { error: '비밀번호는 최소 6자 이상이어야 합니다.' };
  }

  // 현재 비밀번호 재인증에 email 필요. authed 통과해도 email 은 null 가능.
  if (!user.email) {
    return { error: '로그인이 필요합니다.' };
  }

  // 현재 비밀번호로 재인증
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });

  if (signInError) {
    return { error: '현재 비밀번호가 올바르지 않습니다.' };
  }

  // 비밀번호 업데이트
  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (updateError) {
    return { error: updateError.message };
  }

  return { success: true };
}
