import * as z from 'zod';

import type { QuestionCategory as DbQuestionCategory } from '@/db/schema/surveys';
import type { QuestionCategory } from '@/types/survey';

export type { DbQuestionCategory };
export type { QuestionCategory };

// procedure output 타입은 컴포넌트가 기대하는 types/survey.ts 의 QuestionCategory로 통일
export const QuestionCategorySchema = z.custom<QuestionCategory>();

// 컴포넌트(save-question-modal)가 createCategoryMutation.mutateAsync({ name, color })로 호출.
// color는 미지정 시 service에서 기본값 적용(action 동작 유지).
export const CreateCategoryInput = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
});
export type CreateCategoryInput = z.infer<typeof CreateCategoryInput>;

// 컴포넌트(use-library useUpdateCategory)가 { id, updates }로 호출.
// updates는 Partial<{ name; color; icon; order }>.
export const UpdateCategoryInput = z.object({
  id: z.string(),
  updates: z
    .object({
      name: z.string(),
      color: z.string(),
      icon: z.string(),
      order: z.number(),
    })
    .partial(),
});
export type UpdateCategoryInput = z.infer<typeof UpdateCategoryInput>;
