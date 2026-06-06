import * as z from 'zod';

import type { ProgressColumnScheme } from '@/db/schema/schema-types';

export type { ProgressColumnScheme };

/**
 * 진척률 표 컬럼 픽커 갱신(updateProgressColumns) 도메인 스키마.
 *
 * scheme 은 중첩 JSONB(ProgressColumnScheme) 라 z.custom 으로 타입만 보장한다.
 * 출력은 기존 server action 의 { ok, error } 계약을 그대로 보존한다 — 검증 실패도
 * throw 가 아니라 { ok:false, error } 로 돌려주므로 ok 는 boolean 이다(literal true 아님).
 * 소비처가 result.ok / result.error 로 분기하므로 형태를 바꾸지 않는다.
 */
export const UpdateProgressColumnsInput = z.object({
  surveyId: z.string(),
  scheme: z.custom<ProgressColumnScheme>(),
});
export type UpdateProgressColumnsInput = z.infer<typeof UpdateProgressColumnsInput>;

export const UpdateProgressColumnsResult = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type UpdateProgressColumnsResult = z.infer<typeof UpdateProgressColumnsResult>;
