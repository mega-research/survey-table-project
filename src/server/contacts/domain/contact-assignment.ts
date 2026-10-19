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

/** 조건 줄 하나 — 조사 대상 필터 URL 의 col/q/op 와 같은 모양 (contacts 계약 ContactAssignmentClause). */
export const ContactAssignmentClauseSchema = z.object({
  source: z.string().min(1).max(300),
  value: z.string().trim().min(1).max(200_000),
  op: z.enum(['', 'AND', 'OR']),
});

/** 교체 적용·미리보기의 조건 — 줄 0개는 거부한다(전원이 빠지는 사고 방지 — 비우려면 지우기). */
export const AssignmentClausesSchema = z
  .array(ContactAssignmentClauseSchema)
  .min(1, '조건을 하나 이상 넣어 주세요.')
  .max(50);

export const PreviewAssignmentInput = z.object({
  surveyId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  clauses: AssignmentClausesSchema,
});
export type PreviewAssignmentInput = z.infer<typeof PreviewAssignmentInput>;

export const ApplyAssignmentInput = z.object({
  surveyId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  clauses: AssignmentClausesSchema,
});
export type ApplyAssignmentInput = z.infer<typeof ApplyAssignmentInput>;

/** 교체 적용 결과 집계 — 미리보기와 적용 결과가 같은 모양이다. */
export const AssignmentChangeSummarySchema = z.object({
  /** 조건에 맞는 대상 = 적용 뒤 이 컨택원의 배정 */
  matched: z.number().int(),
  /** 적용 전 이 컨택원의 배정 */
  current: z.number().int(),
  /** 배정 없음에서 새로 들어오는 대상 */
  incoming: z.number().int(),
  /** 다른 컨택원에서 옮겨 오는 대상 — 컨택원별 */
  fromOthers: z.array(z.object({ id: z.string(), name: z.string(), count: z.number().int() })),
  /** 조건 밖이라 배정 없음이 되는 대상 */
  leaving: z.number().int(),
});
export type AssignmentChangeSummary = z.infer<typeof AssignmentChangeSummarySchema>;

/** 컨택원 수정 화면 오른쪽 — 체크박스형 열의 값 목록(명단 전체 기준 인원). */
export const AssignmentFacetsInput = z.object({
  surveyId: z.string().uuid(),
  source: z.string().min(1).max(300),
});
export type AssignmentFacetsInput = z.infer<typeof AssignmentFacetsInput>;

export const AssignmentFacetsOutput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('values'),
    /** 값 · 표시 이름 · 인원. 빈 값은 FILTER_NONE_VALUE 로 맨 끝에 온다(있을 때만). */
    values: z.array(z.object({ value: z.string(), label: z.string(), count: z.number().int() })),
    total: z.number().int(),
  }),
  /** 값 종류가 많아 체크박스로 그리지 않는 열 — 대상 목록으로 보인다. */
  z.object({ kind: z.literal('many') }),
]);
export type AssignmentFacetsOutput = z.infer<typeof AssignmentFacetsOutput>;

/** 컨택원 수정 화면 오른쪽 — 조건에 맞는 대상 목록 (10명씩). */
export const AssignmentMatchesInput = z.object({
  surveyId: z.string().uuid(),
  clauses: AssignmentClausesSchema,
  page: z.number().int().min(1).max(100_000),
});
export type AssignmentMatchesInput = z.infer<typeof AssignmentMatchesInput>;
