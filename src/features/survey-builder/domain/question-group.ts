import * as z from 'zod';

import type { NewQuestionGroup, QuestionGroup } from '@/db/schema';
import type { QuestionConditionGroup } from '@/types/survey';

/**
 * 질문 그룹 CRUD 도메인 스키마.
 *
 * displayCondition 은 복잡 JSONB 라 z.custom 으로 타입만 보장한다.
 * parentGroupId 는 update 경로에서 명시적 null 로 최상위 이동 가능해야 하므로 nullable.
 * surveyId/groupId 는 기존 server action 과 동일하게 형식 검증 없이 받는다.
 */

// 타입 re-export (런타임 import 0)
export type { NewQuestionGroup, QuestionGroup };

/** 질문 그룹 생성 입력 — 원본 createQuestionGroup(data) 시그니처와 동일. */
export const CreateQuestionGroupInput = z.object({
  surveyId: z.string(),
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  parentGroupId: z.string().optional(),
  order: z.number().optional(),
  color: z.string().optional(),
});
export type CreateQuestionGroupInput = z.infer<typeof CreateQuestionGroupInput>;

/**
 * 질문 그룹 업데이트 입력 — 원본 updateQuestionGroup(groupId, data) Partial 화이트리스트와 동일.
 * displayCondition 은 원본에서 QuestionConditionGroup | undefined 이므로 optional 로 표현한다.
 */
export const UpdateQuestionGroupData = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  order: z.number().optional(),
  parentGroupId: z.string().nullable().optional(),
  color: z.string().optional(),
  collapsed: z.boolean().optional(),
  hideName: z.boolean().optional(),
  displayCondition: z.custom<QuestionConditionGroup>().optional(),
});
export type UpdateQuestionGroupData = z.infer<typeof UpdateQuestionGroupData>;

// surveyId 는 WS-2 IDOR 봉인용 — service WHERE 스코프로 전달된다.
export const UpdateQuestionGroupInput = z.object({
  groupId: z.string(),
  surveyId: z.string(),
  data: UpdateQuestionGroupData,
});
export type UpdateQuestionGroupInput = z.infer<typeof UpdateQuestionGroupInput>;

export const DeleteQuestionGroupInput = z.object({
  groupId: z.string(),
  surveyId: z.string(),
});
export type DeleteQuestionGroupInput = z.infer<typeof DeleteQuestionGroupInput>;

export const ReorderGroupsInput = z.object({
  surveyId: z.string(),
  groupIds: z.array(z.string()),
});
export type ReorderGroupsInput = z.infer<typeof ReorderGroupsInput>;

/** create/update 반환행 — db select 행을 그대로 노출. */
export const GroupRow = z.custom<QuestionGroup>();
export type GroupRow = z.infer<typeof GroupRow>;

/** delete/reorder 공통 출력 */
export const GroupMutationOutput = z.object({ ok: z.literal(true) });
export type GroupMutationOutput = z.infer<typeof GroupMutationOutput>;
