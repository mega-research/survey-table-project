import { describe, expect, it } from 'vitest';

import { stripHiddenQuestionValues } from '@/lib/survey/question-visibility';
import type { Question } from '@/types/survey';

/**
 * 저장 경계 순서 계약 — 숨은 문항 strip 이 게이팅 strip 보다 **먼저** 와야 한다.
 * 문항이 통째로 사라지면 그 표의 셀 값도 함께 사라져 게이팅 판정의 입력이 달라진다.
 */
describe('저장 경계의 숨은 문항 strip', () => {
  const questions = [
    { id: 'a', type: 'radio', title: 'A', required: false, order: 0 },
    {
      id: 'b',
      type: 'table',
      title: 'B',
      required: false,
      order: 1,
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'c1',
            enabled: true,
            logicType: 'AND',
            conditionType: 'value-match',
            sourceQuestionId: 'a',
            requiredValues: ['yes'],
          },
        ],
      },
    },
  ] as unknown as Question[];

  it('숨은 표 문항은 셀 값까지 통째로 사라진다', () => {
    const stripped = stripHiddenQuestionValues(questions, {
      a: 'no',
      b: { cell1: '10', cell2: '20' },
    });
    expect(stripped).toEqual({ a: 'no' });
  });
});
