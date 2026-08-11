import { describe, expect, it } from 'vitest';

import { applyStructuralSurvival } from '@/lib/survey-response/structural-survival';
import type { Question, TableCell, TableRow } from '@/types/survey';

// ========================
// 구조 생존 판정 (structural survival) — CONTEXT.md 용어, ADR-0014
// ========================
// 응답 버전 이관에서 기존 답변의 유지/폐기를 가르는 순수 규칙:
// - 질문·셀 타입(응답값 모양)이 같고 참조 옵션·셀이 신버전에 실존하면 유지
// - 타입 변경은 그 질문 답만 폐기
// - 고아 값은 답 전체가 아니라 값 단위로만 제거
// - 의미 변화(문구·라벨)는 판정하지 않는다
// 원칙: 구조가 사라졌다는 "긍정적 증거"가 있을 때만 폐기 — 판별 불능이면 유지(보수적).

function q(partial: Partial<Question> & Pick<Question, 'id' | 'type'>): Question {
  return {
    title: '질문',
    required: false,
    order: 0,
    ...partial,
  } as Question;
}

function cell(partial: Partial<TableCell> & Pick<TableCell, 'id' | 'type'>): TableCell {
  return { content: '', ...partial } as TableCell;
}

function row(id: string, cells: TableCell[]): TableRow {
  return { id, label: '', cells };
}

describe('applyStructuralSurvival — 질문 수준', () => {
  it('변화 없는 답은 값 참조 동일성을 유지한 채 통과한다', () => {
    const answer = ['1', '2'];
    const result = applyStructuralSurvival(
      { q1: answer },
      [
        q({
          id: 'q1',
          type: 'checkbox',
          options: [
            { id: 'o1', label: 'A', value: '1' },
            { id: 'o2', label: 'B', value: '2' },
          ],
        }),
      ],
    );
    expect(result.survivingResponses['q1']).toBe(answer);
    expect(result.affectedQuestionIds).toEqual([]);
  });

  it('신버전에 없는 질문의 답은 폐기하고 affected 에 잡는다', () => {
    const result = applyStructuralSurvival({ ghost: '답' }, [q({ id: 'q1', type: 'text' })]);
    expect('ghost' in result.survivingResponses).toBe(false);
    expect(result.affectedQuestionIds).toEqual(['ghost']);
  });

  it('타입 변경(radio→checkbox: 문자열 답 vs 배열 기대)은 그 답만 폐기한다', () => {
    const result = applyStructuralSurvival(
      { q1: '1', q2: '유지되는 답' },
      [
        q({ id: 'q1', type: 'checkbox', options: [{ id: 'o1', label: 'A', value: '1' }] }),
        q({ id: 'q2', type: 'text' }),
      ],
    );
    expect('q1' in result.survivingResponses).toBe(false);
    expect(result.survivingResponses['q2']).toBe('유지되는 답');
    expect(result.affectedQuestionIds).toEqual(['q1']);
  });

  it('타입 변경(text→table: 문자열 답 vs 객체 기대)도 폐기한다', () => {
    const result = applyStructuralSurvival({ q1: '자유 입력' }, [
      q({ id: 'q1', type: 'table', tableRowsData: [row('r1', [cell({ id: 'c1', type: 'input' })])] }),
    ]);
    expect('q1' in result.survivingResponses).toBe(false);
    expect(result.affectedQuestionIds).toEqual(['q1']);
  });

  it('단답형 inputType 텍스트→숫자 변경은 답을 유지한다 (모양이 살아있음)', () => {
    const result = applyStructuralSurvival({ q1: 'abc' }, [
      q({ id: 'q1', type: 'text', inputType: 'number' }),
    ]);
    expect(result.survivingResponses['q1']).toBe('abc');
    expect(result.affectedQuestionIds).toEqual([]);
  });
});

describe('applyStructuralSurvival — 고아 값 (값 단위 제거)', () => {
  it('radio 고아 값은 그 질문만 미응답으로 되돌린다', () => {
    const result = applyStructuralSurvival({ q1: '삭제된값' }, [
      q({ id: 'q1', type: 'radio', options: [{ id: 'o1', label: 'A', value: '1' }] }),
    ]);
    expect('q1' in result.survivingResponses).toBe(false);
    expect(result.affectedQuestionIds).toEqual(['q1']);
  });

  it('radio 값은 option.value 또는 option.id 어느 쪽으로든 실존 판정한다', () => {
    const result = applyStructuralSurvival({ q1: 'o1' }, [
      q({ id: 'q1', type: 'radio', options: [{ id: 'o1', label: 'A', value: '1' }] }),
    ]);
    expect(result.survivingResponses['q1']).toBe('o1');
    expect(result.affectedQuestionIds).toEqual([]);
  });

  it('checkbox 고아 값은 값 단위로만 제거하고 나머지 선택을 유지한다', () => {
    const result = applyStructuralSurvival({ q1: ['1', 'ghost', '2'] }, [
      q({
        id: 'q1',
        type: 'checkbox',
        options: [
          { id: 'o1', label: 'A', value: '1' },
          { id: 'o2', label: 'B', value: '2' },
        ],
      }),
    ]);
    expect(result.survivingResponses['q1']).toEqual(['1', '2']);
    expect(result.affectedQuestionIds).toEqual(['q1']);
  });

  it('select 의 legacy 기타 객체 답({selectedValue,...})은 보수적으로 유지한다', () => {
    const legacyOther = { selectedValue: '9', otherValue: '직접 입력', hasOther: true };
    const result = applyStructuralSurvival({ q1: legacyOther }, [
      q({ id: 'q1', type: 'select', options: [{ id: 'o9', label: '기타', value: '9' }] }),
    ]);
    expect(result.survivingResponses['q1']).toBe(legacyOther);
    expect(result.affectedQuestionIds).toEqual([]);
  });

  it('multiselect 값은 전체 레벨 옵션 유니온으로 실존 판정해 고아만 제거한다', () => {
    const result = applyStructuralSurvival({ q1: ['서울', 'ghost'] }, [
      q({
        id: 'q1',
        type: 'multiselect',
        selectLevels: [
          {
            id: 'lv1',
            label: '시도',
            order: 0,
            options: [{ id: 'o1', label: '서울', value: '서울' }],
          },
        ],
      }),
    ]);
    expect(result.survivingResponses['q1']).toEqual(['서울']);
    expect(result.affectedQuestionIds).toEqual(['q1']);
  });

  it('ranking 은 고아 항목만 제거하고 __other__ 항목은 유지한다', () => {
    const result = applyStructuralSurvival(
      {
        q1: [
          { rank: 1, optionValue: '1' },
          { rank: 2, optionValue: 'ghost' },
          { rank: 3, optionValue: '__other__', optionText: '기타 답' },
        ],
      },
      [
        q({
          id: 'q1',
          type: 'ranking',
          options: [{ id: 'o1', label: 'A', value: '1' }],
          rankingConfig: { positions: 3 },
        }),
      ],
    );
    expect(result.survivingResponses['q1']).toEqual([
      { rank: 1, optionValue: '1' },
      { rank: 3, optionValue: '__other__', optionText: '기타 답' },
    ]);
    expect(result.affectedQuestionIds).toEqual(['q1']);
  });
});

describe('applyStructuralSurvival — 테이블-소스 choice 와 테이블 셀', () => {
  it('테이블-소스 radio(choice_opt) 답은 cell.id 로 실존 판정한다', () => {
    const survives = applyStructuralSurvival({ q1: 'cell-a' }, [
      q({
        id: 'q1',
        type: 'radio',
        tableRowsData: [row('r1', [cell({ id: 'cell-a', type: 'choice_opt', choiceLabel: 'A' })])],
      }),
    ]);
    expect(survives.survivingResponses['q1']).toBe('cell-a');
    expect(survives.affectedQuestionIds).toEqual([]);

    const dropped = applyStructuralSurvival({ q1: 'cell-deleted' }, [
      q({
        id: 'q1',
        type: 'radio',
        tableRowsData: [row('r1', [cell({ id: 'cell-a', type: 'choice_opt', choiceLabel: 'A' })])],
      }),
    ]);
    expect('q1' in dropped.survivingResponses).toBe(false);
    expect(dropped.affectedQuestionIds).toEqual(['q1']);
  });

  it('테이블 답에서 삭제된 셀의 키만 제거하고 실존 셀 값은 유지한다', () => {
    const result = applyStructuralSurvival(
      { t1: { 'c-input': '42', 'c-ghost': '사라진 셀 값' } },
      [
        q({
          id: 't1',
          type: 'table',
          tableRowsData: [row('r1', [cell({ id: 'c-input', type: 'input' })])],
        }),
      ],
    );
    expect(result.survivingResponses['t1']).toEqual({ 'c-input': '42' });
    expect(result.affectedQuestionIds).toEqual(['t1']);
  });

  it('테이블 radio 셀의 고아 옵션 값은 그 셀 키만 제거한다', () => {
    const result = applyStructuralSurvival(
      { t1: { 'c-radio': 'ghost-opt', 'c-input': '유지' } },
      [
        q({
          id: 't1',
          type: 'table',
          tableRowsData: [
            row('r1', [
              cell({
                id: 'c-radio',
                type: 'radio',
                radioOptions: [{ id: 'ro1', label: 'A', value: '1' }],
              }),
              cell({ id: 'c-input', type: 'input' }),
            ]),
          ],
        }),
      ],
    );
    expect(result.survivingResponses['t1']).toEqual({ 'c-input': '유지' });
    expect(result.affectedQuestionIds).toEqual(['t1']);
  });

  it('테이블 checkbox 셀은 고아 optionId 만 배열에서 제거한다 ({optionId} 언랩 포함)', () => {
    const result = applyStructuralSurvival(
      { t1: { 'c-cb': ['co1', { optionId: 'ghost' }] } },
      [
        q({
          id: 't1',
          type: 'table',
          tableRowsData: [
            row('r1', [
              cell({
                id: 'c-cb',
                type: 'checkbox',
                checkboxOptions: [{ id: 'co1', label: 'A', value: 'v1' }],
              }),
            ]),
          ],
        }),
      ],
    );
    expect(result.survivingResponses['t1']).toEqual({ 'c-cb': ['co1'] });
    expect(result.affectedQuestionIds).toEqual(['t1']);
  });

  it('셀 타입 변경(radio 셀 → input 셀: 문자열은 양립)과 배열 답의 input 셀(비양립)을 구분한다', () => {
    // radio 셀이 input 셀로 바뀐 경우 저장값이 문자열이면 모양이 양립하므로 유지된다
    // (의미 판정은 하지 않는다 — 옵션 value 문자열이 input 값으로 남는 것은 관리자 소관)
    const compatible = applyStructuralSurvival(
      { t1: { c1: '1' } },
      [q({ id: 't1', type: 'table', tableRowsData: [row('r1', [cell({ id: 'c1', type: 'input' })])] })],
    );
    expect(compatible.survivingResponses['t1']).toEqual({ c1: '1' });

    // checkbox 셀 답(배열)이 input 셀이 되면 모양 비양립 — 그 셀 키만 폐기
    const incompatible = applyStructuralSurvival(
      { t1: { c1: ['a', 'b'] } },
      [q({ id: 't1', type: 'table', tableRowsData: [row('r1', [cell({ id: 'c1', type: 'input' })])] })],
    );
    expect(incompatible.survivingResponses['t1']).toEqual({});
    expect(incompatible.affectedQuestionIds).toEqual(['t1']);
  });
});

describe('applyStructuralSurvival — 예약 키·기타 보존', () => {
  it('테이블 답 안의 __selectedRowIds(동적 행 사이드카)는 셀 키가 아니어도 보존한다', () => {
    const selectedRowIds = ['r1', 'r2'];
    const result = applyStructuralSurvival(
      { t1: { __selectedRowIds: selectedRowIds, 'c-input': '42' } },
      [
        q({
          id: 't1',
          type: 'table',
          tableRowsData: [row('r1', [cell({ id: 'c-input', type: 'input' })])],
        }),
      ],
    );
    expect(result.survivingResponses['t1']).toEqual({
      __selectedRowIds: selectedRowIds,
      'c-input': '42',
    });
    expect(result.affectedQuestionIds).toEqual([]);
  });

  it('최상위의 __ 접두 사이드카 키는 종류를 몰라도 전부 통과한다', () => {
    const result = applyStructuralSurvival({ __futureSidecar__: { any: 1 }, q1: '1' }, [
      q({ id: 'q1', type: 'radio', options: [{ id: 'o1', label: 'A', value: '1' }] }),
    ]);
    expect(result.survivingResponses['__futureSidecar__']).toEqual({ any: 1 });
    expect(result.affectedQuestionIds).toEqual([]);
  });

  it('__optTexts__ 사이드카는 그대로 통과한다', () => {
    const optTexts = { q1: { o1: '직접 입력' } };
    const result = applyStructuralSurvival({ __optTexts__: optTexts, q1: '1' }, [
      q({ id: 'q1', type: 'radio', options: [{ id: 'o1', label: 'A', value: '1' }] }),
    ]);
    expect(result.survivingResponses['__optTexts__']).toBe(optTexts);
    expect(result.affectedQuestionIds).toEqual([]);
  });

  it('notice 답변(동의 객체)은 무조건 유지한다', () => {
    const ack = { agreed: true, agreedAt: '2026-08-11T00:00:00.000Z' };
    const result = applyStructuralSurvival({ n1: ack }, [q({ id: 'n1', type: 'notice' })]);
    expect(result.survivingResponses['n1']).toBe(ack);
    expect(result.affectedQuestionIds).toEqual([]);
  });
});
