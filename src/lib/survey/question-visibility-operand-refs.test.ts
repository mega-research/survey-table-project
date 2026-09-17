import { describe, expect, it } from 'vitest';

import { stripHiddenQuestionValues } from '@/lib/survey/question-visibility';
import type { Question } from '@/types/survey';

/**
 * 삭제 연쇄는 `sourceQuestionId` 역인덱스로 전파한다. 그런데 그 필드는 조건이 **스캔할 표**를
 * 가리킬 뿐이고, 비교의 좌·우변은 전혀 다른 문항을 가리킬 수 있다 (`kind: 'cell'` ·
 * `kind: 'question'`, 그리고 그 둘을 감싼 `binop`).
 *
 * operand 안의 참조를 안 세면 그 문항이 숨어도 의존자가 재평가 큐에 오르지 않아 연쇄가 한
 * 단계에서 멈춘다 — 중첩 그룹 누락과 같은 계열의 구멍이다. 문항 순서가 우연히 맞으면 가려지고
 * 어긋나면 드러나므로, 의존자를 **상류보다 앞 순서**에 두어 순서에 기대지 않게 한다.
 */
const UPSTREAM = 'q-upstream';
const DOWNSTREAM = 'q-downstream';

function fixture(): Question[] {
  return [
    { id: 'q-switch', type: 'radio', title: '스위치', required: false, order: 0 },
    {
      // 상류(q-upstream)보다 **앞** 순서다 — 큐가 이 문항을 먼저 처리한다.
      id: DOWNSTREAM,
      type: 'text',
      title: '하류',
      required: false,
      order: 1,
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'c-down',
            enabled: true,
            logicType: 'AND',
            conditionType: 'expression',
            // 스캔 대상은 스위치인데, 실제로 읽는 값은 q-upstream 이다.
            sourceQuestionId: 'q-switch',
            expressionConfig: {
              clauses: [
                {
                  kind: 'comparison',
                  comparison: {
                    left: { kind: 'question', questionId: UPSTREAM },
                    op: '==',
                    right: { kind: 'literal', value: 'x' },
                  },
                },
              ],
              joinOps: [],
            },
          },
        ],
      },
    },
    {
      id: UPSTREAM,
      type: 'text',
      title: '상류',
      required: false,
      order: 2,
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'c-up',
            enabled: true,
            logicType: 'AND',
            conditionType: 'value-match',
            sourceQuestionId: 'q-switch',
            requiredValues: ['yes'],
          },
        ],
      },
    },
  ] as unknown as Question[];
}

describe('operand 안의 문항 참조도 삭제 연쇄를 탄다', () => {
  it('상류가 숨으면 그 값을 operand 로 읽던 하류도 지워진다 — 순서가 뒤여도', () => {
    const responses = {
      'q-switch': 'no',
      [DOWNSTREAM]: '지워져야 한다',
      [UPSTREAM]: 'x',
    };

    const next = stripHiddenQuestionValues(fixture(), responses, []);

    expect(next[UPSTREAM]).toBeUndefined();
    // sourceQuestionId 만 보던 역인덱스는 이 값을 남겼다 — 하류가 재평가 큐에 안 올랐다.
    expect(next[DOWNSTREAM]).toBeUndefined();
  });

  it('스위치가 켜져 있으면 둘 다 남는다', () => {
    const responses = {
      'q-switch': 'yes',
      [DOWNSTREAM]: '남아야 한다',
      [UPSTREAM]: 'x',
    };

    const next = stripHiddenQuestionValues(fixture(), responses, []);

    expect(next[UPSTREAM]).toBe('x');
    expect(next[DOWNSTREAM]).toBe('남아야 한다');
  });
});
