import * as z from 'zod';

/**
 * inviteToken 으로 contact attrs 를 조회하는 입력.
 *
 * inviteToken 은 z.string 으로 유지하고 uuid 강제하지 않는다.
 * 무효/malformed 토큰은 service 의 isValidUUID 가드로 null 흡수해
 * 기존 silent fallback UX(amber alert + 익명 폴백)를 보존한다.
 * uuid 강제 시 BAD_REQUEST 가 설문 로딩 catch 를 통째로 실패시킨다.
 */
export const LookupContactAttrsInput = z.object({
  surveyId: z.string(),
  inviteToken: z.string(),
});
export type LookupContactAttrsInput = z.infer<typeof LookupContactAttrsInput>;

/**
 * attrs 조회 결과. 매칭 실패/무효 토큰이면 null.
 * attrs 는 엑셀 한 행을 통째로 담은 Record<string, string>.
 */
export const ContactAttrsOutput = z.record(z.string(), z.string()).nullable();
export type ContactAttrsOutput = z.infer<typeof ContactAttrsOutput>;
