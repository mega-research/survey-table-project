import * as z from 'zod';

/**
 * 토큰으로 컨택 정보를 조회하는 입력(read-only, mutation 없음).
 *
 * token 은 z.string 으로 유지하고 uuid 강제하지 않는다.
 * 무효/malformed 토큰은 service 의 UUID_RE 가드로 흡수해
 * 기존 silent fallback UX(유효하지 않은 링크 화면)를 보존한다.
 * uuid 강제 시 BAD_REQUEST 가 RSC 페이지 렌더를 통째로 깨뜨린다.
 */
export const LookupContactByTokenInput = z.object({
  token: z.string(),
});
export type LookupContactByTokenInput = z.infer<typeof LookupContactByTokenInput>;

/**
 * 토큰 조회 결과. 무효 토큰/매칭 실패/DB 장애면 ok=false 로 응답해
 * 호출부가 친절한 fallback 메시지를 표시한다.
 * email 은 마스킹/표시용으로만 사용(복호화 실패 시 null).
 */
export const LookupContactByTokenOutput = z.object({
  ok: z.boolean(),
  email: z.string().nullable(),
  alreadyUnsubscribed: z.boolean(),
});
export type LookupContactByTokenOutput = z.infer<typeof LookupContactByTokenOutput>;

/**
 * 운영자(admin)가 단체 메일 페이지에서 직접 수신거부를 해제하는 입력.
 *
 * 인증은 authed 미들웨어가 담당. surveyId scope 일치 검증은 service 가 수행해
 * 다른 설문의 컨택을 임의로 건드리지 못하게 차단한다.
 * contactId/surveyId 는 z.string 으로 유지하고 uuid 강제하지 않는다 —
 * 무효 입력은 service 가드가 잘못된 요청 메시지로 흡수(원본 의미론 보존).
 */
export const RevertUnsubscribeByContactIdInput = z.object({
  contactId: z.string(),
  surveyId: z.string(),
});
export type RevertUnsubscribeByContactIdInput = z.infer<
  typeof RevertUnsubscribeByContactIdInput
>;

/**
 * 운영자 수신거부 해제 결과.
 * 멱등성: 이미 해제된 행이어도 ok 반환(UI 가 stale 상태에서 두 번 눌러도 무해).
 * 매칭 실패/무효 입력/DB 장애면 ok=false + error 메시지.
 */
export const RevertUnsubscribeByContactIdOutput = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export type RevertUnsubscribeByContactIdOutput = z.infer<
  typeof RevertUnsubscribeByContactIdOutput
>;
