import * as z from 'zod';

import type { AuthUser } from '@/server/context';

// 프로필·비밀번호 변경의 경계 계약은 shared/contracts/auth-io 소관 — 되내보내기만 한다.
export {
  MyProfile,
  UpdatePasswordInput,
  UpdatePasswordOutput,
  UpdateProfileInput,
  UpdateProfileOutput,
} from '@/shared/contracts/auth-io';

// 타입 통일: context.ts 의 AuthUser(인증 사용자) 를 도메인 타입으로 재노출.
export type { AuthUser };

// ========================
// getUser
// ========================

/** getUser 출력: 인증 사용자 또는 null(익명). 복잡 객체이므로 z.custom 으로 타입만 보장. */
export const AuthUserSchema = z.custom<AuthUser>();
export const GetUserOutput = AuthUserSchema.nullable();


// ========================
// 프로필
// ========================

/**
 * 아바타로 받을 수 없는 URL 이다.
 *
 * 우리 R2 공개 URL 이 아닌 값을 넣으면 남의 서버가 우리 화면에 그림을 그리고, 렌더될 때마다
 * 그쪽 로그에 우리 사용자의 IP·UA 가 남는다. procedure 가 BAD_REQUEST 로 바꾼다.
 */
export class InvalidAvatarUrlError extends Error {
  constructor() {
    super('아바타 이미지 주소가 올바르지 않습니다.');
    this.name = 'InvalidAvatarUrlError';
  }
}
