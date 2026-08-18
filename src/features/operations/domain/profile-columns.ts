import * as z from 'zod';

import type { ProfileColumnScheme } from '@/db/schema/schema-types';

export type { ProfileColumnScheme };

/**
 * 응답 내역 컬럼 픽커 갱신(updateProfileColumns) 도메인 스키마.
 *
 * scheme 은 중첩 JSONB(ProfileColumnScheme) 라 z.custom 으로 타입만 보장한다.
 * 출력은 progress 와 동일한 { ok, error } 계약 — 검증 실패도 throw 가 아니라
 * { ok:false, error } 로 반환하므로 ok 는 boolean 이다(literal true 아님).
 */
export const UpdateProfileColumnsInput = z.object({
  surveyId: z.string(),
  scheme: z.custom<ProfileColumnScheme>(),
});
export type UpdateProfileColumnsInput = z.infer<typeof UpdateProfileColumnsInput>;

export const UpdateProfileColumnsResult = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type UpdateProfileColumnsResult = z.infer<typeof UpdateProfileColumnsResult>;
