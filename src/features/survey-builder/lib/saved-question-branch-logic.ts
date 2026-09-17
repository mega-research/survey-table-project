// 보관함에서 꺼낸 질문의 분기 로직 판정·제거. 계약이 아니라 빌더 업무 규칙이고
// 서버는 쓰지 않으므로(procedure·service 사용 0) 빌더 feature 가 소유한다.
// 표시조건 식 평가는 @/utils/branch-logic 소관 — 이름은 비슷하지만 다른 관심사다.
import type { Question } from '@/types/survey';

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
