import * as z from 'zod';

import type { ContactAttempt, NewContactAttempt } from '@/db/schema/contacts';

// drizzle row 타입 재노출 (service/소비처 공용).
export type { ContactAttempt };
export type { NewContactAttempt };

/**
 * 회차 추가 입력.
 * - surveyId 는 service 로직에서 직접 쓰이지 않지만(revalidatePath 제거됨)
 *   소비처 호출부 시그니처 호환과 권한 범위 표기를 위해 input 에 유지한다.
 * - note 는 exactOptionalPropertyTypes 대응을 위해 z.string().optional() 로 두고
 *   service input 은 이 infer 타입을 그대로 받는다(inline 타입 금지).
 */
export const AddContactAttemptInput = z.object({
  contactTargetId: z.string(),
  surveyId: z.string(),
  resultCode: z.string(),
  note: z.string().optional(),
});
export type AddContactAttemptInput = z.infer<typeof AddContactAttemptInput>;

/** 회차 수정 입력. id 로 단일 회차를 지정한다. */
export const UpdateContactAttemptInput = z.object({
  id: z.string(),
  contactTargetId: z.string(),
  surveyId: z.string(),
  resultCode: z.string(),
  note: z.string().optional(),
});
export type UpdateContactAttemptInput = z.infer<typeof UpdateContactAttemptInput>;

/** 회차 삭제 입력. 기존 action 의 위치 인자(surveyId, contactTargetId, id)를 객체로 평탄화. */
export const DeleteContactAttemptInput = z.object({
  surveyId: z.string(),
  contactTargetId: z.string(),
  id: z.string(),
});
export type DeleteContactAttemptInput = z.infer<typeof DeleteContactAttemptInput>;

/** 회차 추가 반환 — 발번된 회차 식별자/번호. */
export const AttemptResultSchema = z.object({
  id: z.string(),
  attemptNo: z.number(),
});
export type AttemptResult = z.infer<typeof AttemptResultSchema>;
