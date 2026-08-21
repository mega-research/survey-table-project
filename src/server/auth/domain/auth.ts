import * as z from 'zod';

import type { AuthUser } from '@/server/context';

// 타입 통일: context.ts 의 AuthUser(인증 사용자) 를 도메인 타입으로 재노출.
export type { AuthUser };

// ========================
// getUser
// ========================

/** getUser 출력: 인증 사용자 또는 null(익명). 복잡 객체이므로 z.custom 으로 타입만 보장. */
export const AuthUserSchema = z.custom<AuthUser>();
export const GetUserOutput = AuthUserSchema.nullable();

// ========================
// updatePassword
// ========================

/**
 * updatePassword 입력. FormData 가 아닌 JSON 으로 전달(클라 hook 에서 객체로 호출).
 * 단순 문자열 필드이므로 z.string() 사용(z.custom 불필요).
 */
export const UpdatePasswordInput = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
  confirmPassword: z.string(),
});
export type UpdatePasswordInput = z.infer<typeof UpdatePasswordInput>;

/**
 * updatePassword 출력. 기존 server action 계약과 동일한 판별 유니온
 * ({ success: true } 또는 { error: string }). 검증 실패/재인증 실패를
 * throw 대신 에러 메시지로 반환하던 UX 를 유지한다.
 */
export const UpdatePasswordOutput = z.union([
  z.object({ success: z.literal(true) }),
  z.object({ error: z.string() }),
]);
export type UpdatePasswordOutput = z.infer<typeof UpdatePasswordOutput>;
