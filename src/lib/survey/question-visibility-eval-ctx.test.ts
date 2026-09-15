import { describe, expect, it } from 'vitest';

import { stripHiddenQuestionValues } from '@/lib/survey/question-visibility';
import type { Question } from '@/types/survey';
import { responsesToLookupShape } from '@/utils/branch-eval';

/**
 * `table-cell-check` 조건의 숫자 비교는 응답 본문이 아니라 `evalCtx.responses` 에서 셀을
 * 읽는다 (`branch-eval` 의 `kind: 'cell'` operand — `evalCtx.responses` 를 쓰는 유일한 경로).
 *
 * 호출부는 그 뷰를 strip **전에** 한 번 만들어 넘긴다. 삭제 연쇄가 도는 동안 갱신하지 않으면
 * 이미 지워진 문항의 셀 값으로 비교가 성립해, 응답자 화면에서는 살아 있던 하류 문항이
 * 서버에서만 지워진다 — 클라이언트는 effect 재실행으로 마스킹된 뷰에 수렴하는데 서버는
 * 1패스라 갈린다. **해결 불가 operand 의 fail 방향은 SHOW** 이므로 재마스킹은 삭제를 줄이는
 * 쪽으로만 움직인다.
 *
 * 역인덱스도 함께 넓혔다. `sourceQuestionId` 는 조건이 스캔할 표를 가리킬 뿐이고 비교의
 * 좌·우변은 다른 문항을 가리킬 수 있어, 그 참조를 안 세면 상류가 숨어도 의존자가 재평가
 * 큐에 오르지 않는다.
 */
const SOURCE_TABLE = 'q-source';
const GATE_TABLE = 'q-gate-table';
const DOWNSTREAM = 'q-downstream';

/** 숨을 표(SOURCE_TABLE), 조건이 스캔할 표(GATE_TABLE), 그 둘에 기대는 하류 문항. */
function fixture(): Question[] {
  return [
    { id: 'q-switch', type: 'radio', title: '스위치', required: false, order: 0 },
    {
      id: SOURCE_TABLE,
      type: 'table',
      title: '값을 대는 표',
      required: false,
      order: 1,
      tableColumns: [{ id: 'col1', label: '값' }],
      tableRowsData: [
        { id: 'r1', label: '', cells: [{ id: 'src-cell', type: 'input', content: '' }] },
      ],
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'c-source',
            enabled: true,
            logicType: 'AND',
            conditionType: 'value-match',
            sourceQuestionId: 'q-switch',
            requiredValues: ['yes'],
          },
        ],
      },
    },
    {
      id: GATE_TABLE,
      type: 'table',
      title: '조건이 스캔할 표',
      required: false,
      order: 2,
      tableColumns: [{ id: 'col1', label: '값' }],
      tableRowsData: [
        { id: 'gr1', label: '', cells: [{ id: 'gate-cell', type: 'input', content: '' }] },
      ],
    },
    {
      id: DOWNSTREAM,
      type: 'text',
      title: '하류',
      required: false,
      order: 3,
      // GATE_TABLE 의 행을 스캔하되 비교 좌변은 **숨을 표**의 셀을 가리킨다.
      // 좌변 3 은 5 보다 작으므로, 그 값이 살아 있으면 조건이 거짓이 되어 하류가 지워진다.
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'c-down',
            enabled: true,
            logicType: 'AND',
            conditionType: 'table-cell-check',
            sourceQuestionId: GATE_TABLE,
            tableConditions: {
              rowIds: ['gr1'],
              cellColumnIndex: 0,
              checkType: 'any',
              numericComparison: {
                left: { kind: 'cell', questionId: SOURCE_TABLE, cellId: 'src-cell' },
                operator: '>',
                right: { kind: 'literal', value: 5 },
              },
            },
          },
        ],
      },
    },
  ] as unknown as Question[];
}

function ctxOf(responses: Record<string, unknown>) {
  return { responses: responsesToLookupShape(responses), contactAttrs: {}, lookups: [] };
}

describe('숨은 문항 삭제의 평가 컨텍스트 재마스킹', () => {
  it('상류 표가 지워지면 그 셀을 참조하던 조건은 해결 불가가 되어 하류를 살린다', () => {
    const responses = {
      'q-switch': 'no',
      [SOURCE_TABLE]: { 'src-cell': '3' },
      [GATE_TABLE]: { 'gate-cell': '1' },
      [DOWNSTREAM]: '남아야 한다',
    };

    const next = stripHiddenQuestionValues(fixture(), responses, [], ctxOf(responses));

    expect(next[SOURCE_TABLE]).toBeUndefined();
    // 재마스킹 전에는 스테일한 컨텍스트가 3 > 5 를 거짓으로 풀어 이 값을 지웠다.
    expect(next[DOWNSTREAM]).toBe('남아야 한다');
  });

  it('스위치가 켜져 있으면 조건이 그대로 평가돼 하류가 지워진다', () => {
    const responses = {
      'q-switch': 'yes',
      [SOURCE_TABLE]: { 'src-cell': '3' },
      [GATE_TABLE]: { 'gate-cell': '1' },
      [DOWNSTREAM]: '지워져야 한다',
    };

    const next = stripHiddenQuestionValues(fixture(), responses, [], ctxOf(responses));

    expect(next[SOURCE_TABLE]).toEqual({ 'src-cell': '3' });
    expect(next[DOWNSTREAM]).toBeUndefined();
  });

  it('비교를 만족하면 상류가 살아 있는 채로 하류도 남는다', () => {
    const responses = {
      'q-switch': 'yes',
      [SOURCE_TABLE]: { 'src-cell': '10' },
      [GATE_TABLE]: { 'gate-cell': '1' },
      [DOWNSTREAM]: '남아야 한다',
    };

    const next = stripHiddenQuestionValues(fixture(), responses, [], ctxOf(responses));

    expect(next[DOWNSTREAM]).toBe('남아야 한다');
  });

  it('평가 컨텍스트를 안 넘겨도 종전대로 동작한다', () => {
    const responses = { 'q-switch': 'no', [SOURCE_TABLE]: { 'src-cell': '3' } };

    const next = stripHiddenQuestionValues(fixture(), responses, []);

    expect(next[SOURCE_TABLE]).toBeUndefined();
  });
});
