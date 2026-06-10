import type { Question } from '@/types/survey';
import { generateAllOptionCodes } from '@/utils/option-code-generator';
import { generateAllCellCodes } from '@/utils/table-cell-code-generator';

const CHOICE_TYPES = new Set(['radio', 'checkbox', 'select', 'multiselect']);

/**
 * DB에 strip 저장된 파생 필드(cellCode, exportLabel, optionCode)를 복원한다.
 * SPSS 변수명 생성(generateSPSSColumns) 전에 반드시 거쳐야 한다 —
 * export route와 publish 검증 게이트가 공유.
 */
export function hydrateQuestionsForSpss(questions: Question[]): Question[] {
  return questions.map((q) => {
    let next = q;
    if (q.type === 'table' && q.tableRowsData && q.tableColumns) {
      next = {
        ...next,
        tableRowsData: generateAllCellCodes(
          q.questionCode ?? undefined, q.title, q.tableColumns, q.tableRowsData,
        ),
      };
    }
    const opts = next.options;
    if (opts && CHOICE_TYPES.has(next.type)) {
      // 테이블 분기에서 이미 새 객체가 만들어졌으면 spread 불필요
      if (next === q) next = { ...next };
      next = { ...next, options: generateAllOptionCodes(opts) };
    }
    return next;
  });
}
