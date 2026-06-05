import * as z from 'zod';

import type { QuestionData } from '@/db/schema/schema-types';
import type { SavedQuestion as DbSavedQuestion } from '@/db/schema/surveys';
import type { Question, SavedQuestion } from '@/types/survey';

export type { DbSavedQuestion };
export type { QuestionData };
export type { SavedQuestion };

/** 복잡 JSONB는 z.custom으로 타입만 보장(런타임 통과). */
export const QuestionDataSchema = z.custom<QuestionData>();
// service 함수는 Question(빌더 타입)을 받으므로 별도 스키마 정의
export const QuestionSchema = z.custom<Question>();
// procedure output 타입은 컴포넌트가 기대하는 types/survey.ts 의 SavedQuestion으로 통일
export const SavedQuestionSchema = z.custom<SavedQuestion>();

// 컴포넌트가 useSaveQuestion().mutateAsync({ question, metadata })로 호출하므로 nested로 정의.
// question 필드는 promoteSurveyImages와 동일하게 Question 타입으로 받음
export const CreateSavedQuestionInput = z.object({
  question: QuestionSchema,
  metadata: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    category: z.string().min(1),
    tags: z.array(z.string()).optional(),
  }),
});
export type CreateSavedQuestionInput = z.infer<typeof CreateSavedQuestionInput>;

export const UpdateSavedQuestionInput = z.object({
  id: z.string(),
  updates: z
    .object({
      name: z.string(),
      description: z.string(),
      category: z.string(),
      tags: z.array(z.string()),
      question: QuestionSchema,
    })
    .partial(),
});
export type UpdateSavedQuestionInput = z.infer<typeof UpdateSavedQuestionInput>;

// 분기 로직 관련 순수 함수 (question-library-store.ts에서 이전)
export function hasBranchLogic(question: Question): boolean {
  if (question.options?.some((opt) => opt.branchRule)) {
    return true;
  }

  if (question.tableValidationRules?.length) {
    return true;
  }

  if (question.tableRowsData) {
    for (const row of question.tableRowsData) {
      for (const cell of row.cells) {
        if (cell.checkboxOptions?.some((opt) => opt.branchRule)) return true;
        if (cell.radioOptions?.some((opt) => opt.branchRule)) return true;
        if (cell.selectOptions?.some((opt) => opt.branchRule)) return true;
      }
    }
  }

  if (question.displayCondition?.conditions?.length) {
    return true;
  }

  return false;
}

export function removeBranchLogic(question: Question): Question {
  const { groupId: _gid, ...questionWithoutGroup } = question;
  const cleanedQuestion: Question = {
    ...questionWithoutGroup, // 라이브러리에서 가져온 질문은 그룹 ID를 제거
  };

  if (cleanedQuestion.options) {
    cleanedQuestion.options = cleanedQuestion.options.map((opt) => {
      const { branchRule: _br, ...rest } = opt;
      return rest;
    });
  }

  delete cleanedQuestion.tableValidationRules;

  if (cleanedQuestion.tableRowsData) {
    cleanedQuestion.tableRowsData = cleanedQuestion.tableRowsData.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => {
        const cleanedCell = { ...cell };
        if (cleanedCell.checkboxOptions) {
          cleanedCell.checkboxOptions = cleanedCell.checkboxOptions.map((opt) => {
            const { branchRule: _br1, ...rest } = opt;
            return rest;
          });
        }
        if (cleanedCell.radioOptions) {
          cleanedCell.radioOptions = cleanedCell.radioOptions.map((opt) => {
            const { branchRule: _br2, ...rest } = opt;
            return rest;
          });
        }
        if (cleanedCell.selectOptions) {
          cleanedCell.selectOptions = cleanedCell.selectOptions.map((opt) => {
            const { branchRule: _br3, ...rest } = opt;
            return rest;
          });
        }
        return cleanedCell;
      }),
    }));
  }

  delete cleanedQuestion.displayCondition;

  return cleanedQuestion;
}
