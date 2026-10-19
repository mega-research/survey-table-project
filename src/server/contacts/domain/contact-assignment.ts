import * as z from 'zod';

import {
  type ContactAssignmentOption,
  ContactAssignmentOptionSchema,
} from '@/shared/contracts/contacts-io';

// 선택지 모양은 계약(@/shared/contracts/contacts-io) 소관 — 여기서 다시 내보낸다.
export { ContactAssignmentOptionSchema };
export type { ContactAssignmentOption };

/** 컨택원 이름 상한 — 칩·필터 선택지·진척 보고 줄에 한 줄로 들어가는 길이. */
export const CONTACT_ASSIGNMENT_NAME_MAX = 60;

export const ContactAssignmentName = z
  .string()
  .trim()
  .min(1, '컨택원 이름을 입력해 주세요.')
  .max(CONTACT_ASSIGNMENT_NAME_MAX, `컨택원 이름은 ${CONTACT_ASSIGNMENT_NAME_MAX}자까지입니다.`);

export const ListContactAssignmentsInput = z.object({
  surveyId: z.string().uuid(),
});
export type ListContactAssignmentsInput = z.infer<typeof ListContactAssignmentsInput>;

export const CreateContactAssignmentInput = z.object({
  surveyId: z.string().uuid(),
  name: ContactAssignmentName,
});
export type CreateContactAssignmentInput = z.infer<typeof CreateContactAssignmentInput>;

/** 조사 대상 한 명의 컨택원 바꾸기. assignmentId=null 이면 배정을 푼다. */
export const SetTargetAssignmentInput = z.object({
  surveyId: z.string().uuid(),
  contactTargetId: z.string().uuid(),
  assignmentId: z.string().uuid().nullable(),
});
export type SetTargetAssignmentInput = z.infer<typeof SetTargetAssignmentInput>;

export const RenameContactAssignmentInput = z.object({
  surveyId: z.string().uuid(),
  id: z.string().uuid(),
  name: ContactAssignmentName,
});
export type RenameContactAssignmentInput = z.infer<typeof RenameContactAssignmentInput>;

/** 컨택원 순서 — 이 파티션의 컨택원 id 전부를 새 순서대로. */
export const ReorderContactAssignmentsInput = z.object({
  surveyId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1).max(500),
});
export type ReorderContactAssignmentsInput = z.infer<typeof ReorderContactAssignmentsInput>;

export const RemoveContactAssignmentInput = z.object({
  surveyId: z.string().uuid(),
  id: z.string().uuid(),
});
export type RemoveContactAssignmentInput = z.infer<typeof RemoveContactAssignmentInput>;
