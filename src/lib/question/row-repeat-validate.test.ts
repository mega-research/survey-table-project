import { describe, expect, it } from 'vitest';

import type { Question, TableCell, TableRow } from '@/types/survey';

import { validateRowRepeatTemplate } from './row-repeat';

function cell(id: string, type: TableCell['type'] = 'input'): TableCell {
  return { id, content: '', type };
}

function tableQuestion(rows: TableRow[], extra: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'table',
    title: '표',
    order: 1,
    required: false,
    tableColumns: [{ id: 'c1', label: '열1' }],
    tableRowsData: rows,
    ...extra,
  } as Question;
}

const plainRows = (): TableRow[] => [
  { id: 'a', label: '가', cells: [cell('a1')] },
  { id: 'b', label: '나', cells: [cell('b1')] },
  { id: 'c', label: '다', cells: [cell('c1')] },
];

describe('validateRowRepeatTemplate', () => {
  it('입력 셀만 있는 연속 묶음은 위반이 없다', () => {
    expect(validateRowRepeatTemplate(tableQuestion(plainRows()), ['a', 'b'])).toEqual([]);
  });

  it('표시용 text 셀은 함께 반복해도 된다', () => {
    const rows = plainRows();
    rows[0]!.cells = [cell('a1', 'text')];
    expect(validateRowRepeatTemplate(tableQuestion(rows), ['a', 'b'])).toEqual([]);
  });

  it('빈 지정은 위반이다', () => {
    expect(validateRowRepeatTemplate(tableQuestion(plainRows()), []).map((v) => v.kind)).toEqual([
      'empty',
    ]);
  });

  it('표에 없는 행 id 는 위반이다', () => {
    expect(
      validateRowRepeatTemplate(tableQuestion(plainRows()), ['a', 'zzz']).map((v) => v.kind),
    ).toContain('unknown-row');
  });

  it('떨어진 행은 위반이다', () => {
    expect(
      validateRowRepeatTemplate(tableQuestion(plainRows()), ['a', 'c']).map((v) => v.kind),
    ).toEqual(['not-contiguous']);
  });

  it('선택 칸(드롭다운)은 반복할 수 있다 — 값이 입력 칸처럼 셀 id 아래 문자열 하나다', () => {
    const rows = plainRows();
    rows[1]!.cells = [cell('b1', 'select')];
    expect(validateRowRepeatTemplate(tableQuestion(rows), ['a', 'b'])).toEqual([]);
  });

  it('라디오·체크박스 칸도 반복할 수 있다 — 값이 셀 id 아래에 있고 보기 id·묶음 이름은 벌마다 갈라 복제한다', () => {
    for (const type of ['radio', 'checkbox'] as const) {
      const rows = plainRows();
      rows[1]!.cells = [cell('b1', type)];
      expect(validateRowRepeatTemplate(tableQuestion(rows), ['a', 'b']), type).toEqual([]);
    }
  });

  it('계산·랭킹·보기소스 셀이 들어 있으면 위반이다', () => {
    for (const type of ['calc', 'ranking', 'ranking_opt', 'choice_opt'] as const) {
      const rows = plainRows();
      rows[1]!.cells = [cell('b1', type)];
      const kinds = validateRowRepeatTemplate(tableQuestion(rows), ['a', 'b']).map((v) => v.kind);
      expect(kinds, type).toContain('cell-type');
    }
  });

  it('합계 제약이 참조하는 행은 위반이다', () => {
    const q = tableQuestion(plainRows(), {
      sumConstraints: [{ id: 's1', cellIds: ['b1'], operator: 'eq', target: 100 }],
    });
    expect(validateRowRepeatTemplate(q, ['a', 'b']).map((v) => v.kind)).toContain('sum-constraint');
  });

  it('분기 규칙이 참조하는 행은 위반이다', () => {
    const q = tableQuestion(plainRows(), {
      tableValidationRules: [
        {
          id: 'r1',
          type: 'exclusive-check',
          conditions: { checkType: 'input', rowIds: ['b'] },
          action: 'goto',
        },
      ],
    });
    expect(validateRowRepeatTemplate(q, ['a', 'b']).map((v) => v.kind)).toContain(
      'validation-rule',
    );
  });

  it('행 표시 조건이 걸린 행은 위반이다', () => {
    const rows = plainRows();
    rows[1]!.displayCondition = { logicType: 'AND', conditions: [] };
    expect(validateRowRepeatTemplate(tableQuestion(rows), ['a', 'b']).map((v) => v.kind)).toContain(
      'display-condition',
    );
  });

  it('동적 행 그룹에 속한 행은 위반이다', () => {
    const rows = plainRows();
    rows[1]!.dynamicGroupId = 'g1';
    expect(validateRowRepeatTemplate(tableQuestion(rows), ['a', 'b']).map((v) => v.kind)).toContain(
      'dynamic-row',
    );
  });

  it('이미 펼쳐진 2벌 이후 행을 다시 템플릿으로 지정할 수 없다', () => {
    const rows = plainRows();
    rows[1]!.repeatIndex = 2;
    rows[1]!.repeatSourceRowId = 'a';
    expect(validateRowRepeatTemplate(tableQuestion(rows), ['a', 'b']).map((v) => v.kind)).toContain(
      'already-expanded',
    );
  });

  it('위반마다 사람이 읽을 문구가 붙는다', () => {
    const violations = validateRowRepeatTemplate(tableQuestion(plainRows()), ['a', 'c']);
    expect(violations[0]!.message.length).toBeGreaterThan(0);
  });
});

describe('validateRowRepeatTemplate — 라디오 묶음', () => {
  const radio = (id: string, group: string) =>
    ({ id, type: 'radio', content: '', radioGroupName: group, radioOptions: [{ id: `${id}o`, label: 'a', value: '1' }] }) as TableCell;

  it('여러 행에 걸친(세로) 라디오 묶음은 막는다 — 변수명이 열 코드라 벌마다 겹친다', () => {
    const rows = [
      { id: 'a', label: 'a', cells: [radio('a1', 'v')] },
      { id: 'b', label: 'b', cells: [radio('b1', 'v')] },
    ] as TableRow[];
    expect(validateRowRepeatTemplate(tableQuestion(rows), ['a', 'b']).map((v) => v.kind)).toContain('radio-group');
  });

  it('블록 안팎에 걸친 라디오 묶음은 막는다', () => {
    const rows = [
      { id: 'a', label: 'a', cells: [radio('a1', 'v')] },
      { id: 'b', label: 'b', cells: [radio('b1', 'v')] },
    ] as TableRow[];
    expect(validateRowRepeatTemplate(tableQuestion(rows), ['a']).map((v) => v.kind)).toContain('radio-group');
  });

  it('한 행 안의(가로) 라디오 묶음은 반복할 수 있다', () => {
    const rows = [{ id: 'a', label: 'a', cells: [radio('a1', 'h'), radio('a2', 'h')] }] as TableRow[];
    expect(validateRowRepeatTemplate(tableQuestion(rows), ['a'])).toEqual([]);
  });
});
