import { describe, expect, it } from 'vitest';

import { formatFormulaPreview } from '@/components/survey-builder/formula/format-formula';
import type { CalcExpr, Question } from '@/types/survey';

// 최소 표 질문 헬퍼 — 숫자 input 셀 2개(exportLabel 로 라벨 확정).
// tests/unit 관례를 따라 다른 테스트 파일과 fixture 를 공유하지 않는다.
function tableQuestion(): Question {
  return {
    id: 'q1',
    type: 'table',
    title: '금액 표',
    required: false,
    order: 1,
    tableRowsData: [
      {
        id: 'r1',
        label: 'r1',
        cells: [
          { id: 'c1', content: '', type: 'input', inputType: 'number', exportLabel: '1행 금액' },
          { id: 'c2', content: '', type: 'input', inputType: 'number', exportLabel: '2행 금액' },
        ],
      },
    ],
  } as Question;
}

describe('formatFormulaPreview', () => {
  it('중첩 그룹은 하위 그룹을 괄호로 감싼다', () => {
    const expr: CalcExpr = {
      kind: 'group',
      op: '+',
      terms: [
        { kind: 'group', op: '*', terms: [{ kind: 'literal', value: 2 }, { kind: 'literal', value: 3 }] },
        { kind: 'group', op: '*', terms: [{ kind: 'literal', value: 4 }, { kind: 'literal', value: 5 }] },
      ],
    };

    expect(formatFormulaPreview(expr, [])).toBe('(2 × 3) + (4 × 5)');
  });

  it('SUM 은 항 목록을 쉼표로 나열한다', () => {
    const expr: CalcExpr = {
      kind: 'group',
      op: '+',
      terms: [
        {
          kind: 'agg',
          fn: 'sum',
          items: [
            { kind: 'cell', cellId: 'c1' },
            { kind: 'cell', cellId: 'c2' },
          ],
        },
      ],
    };

    expect(formatFormulaPreview(expr, [tableQuestion()], { ownQuestionId: 'q1' })).toBe(
      'SUM(1행 금액, 2행 금액)',
    );
  });

  it('존재하지 않는 셀 참조는 [삭제된 셀] 로 표시한다', () => {
    const expr: CalcExpr = {
      kind: 'group',
      op: '-',
      terms: [
        { kind: 'cell', cellId: 'c1' },
        { kind: 'cell', cellId: 'gone' },
      ],
    };

    expect(formatFormulaPreview(expr, [tableQuestion()], { ownQuestionId: 'q1' })).toBe(
      '1행 금액 − [삭제된 셀]',
    );
  });

  // 빌더에서 "다른 질문 셀 추가" 를 누르면 questionId=''(미선택) 항이 만들어진다. 빈 문자열을
  // "전체 질문에서 검색" 으로 오해하면 우연히 같은 cellId 를 가진 셀을 찾아 미선택 상태가 정상
  // 참조처럼 보인다 — undefined(같은 질문 생략) 와 명확히 구분해야 한다.
  it('questionId 가 빈 문자열이면 셀이 존재해도 [삭제된 셀] 로 표시한다', () => {
    const expr: CalcExpr = { kind: 'cell', questionId: '', cellId: 'c1' };

    expect(formatFormulaPreview(expr, [tableQuestion()], { ownQuestionId: 'q1' })).toBe(
      '[삭제된 셀]',
    );
  });

  it('cellId 가 비어 있으면 [삭제된 셀] 로 표시한다', () => {
    const expr: CalcExpr = { kind: 'cell', cellId: '' };

    expect(formatFormulaPreview(expr, [tableQuestion()], { ownQuestionId: 'q1' })).toBe(
      '[삭제된 셀]',
    );
  });

  it('questionId 를 생략하면 ownQuestionId 미지정 시에도 전체 질문에서 찾는다', () => {
    const expr: CalcExpr = { kind: 'cell', cellId: 'c2' };

    expect(formatFormulaPreview(expr, [tableQuestion()])).toBe('2행 금액');
  });
});
