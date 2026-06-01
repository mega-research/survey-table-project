import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';
// dispatcher: branch-logic.ts 에서 callers 가 쓰는 공개 함수
import { getBranchRuleForResponse } from '@/utils/branch-logic';

function choiceTableQ(): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: 'Q',
    required: false,
    order: 0,
    tableColumns: [{ id: 'c1', label: '선택' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          {
            id: 'cellA',
            type: 'choice_opt',
            content: '',
            choiceLabel: 'A',
            branchRule: { id: 'b1', value: 'cellA', action: 'end' },
          },
        ],
      },
    ],
  } as Question;
}

describe('choice table-source 분기', () => {
  it('선택된 choice_opt 셀의 branchRule 을 평가한다', () => {
    const q = choiceTableQ();
    const rule = getBranchRuleForResponse(q, 'cellA'); // 응답값 = 선택된 셀 id
    expect(rule?.action).toBe('end');
  });
});
