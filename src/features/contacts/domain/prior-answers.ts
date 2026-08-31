import * as z from 'zod';

/**
 * inviteToken 으로 이월 응답을 조회하는 입력.
 *
 * inviteToken 에 uuid 를 강제하지 않는 이유는 attrs lookup 과 같다 —
 * 무효/malformed 토큰은 service 가 null 로 흡수해 익명 응답 폴백을 보존한다.
 */
export const LookupPriorAnswersInput = z.object({
  surveyId: z.string(),
  inviteToken: z.string(),
});
export type LookupPriorAnswersInput = z.infer<typeof LookupPriorAnswersInput>;

/**
 * 이월 응답 조회 결과. 이월 응답이 없거나 토큰이 무효면 null.
 * 값은 응답 저장 형태(questionResponses)와 동형이라 임의 JSON 이 들어온다.
 */
export const PriorAnswersOutput = z.custom<Record<string, unknown> | null>();
export type PriorAnswersOutput = z.infer<typeof PriorAnswersOutput>;
