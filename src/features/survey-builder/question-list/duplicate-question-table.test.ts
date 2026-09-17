import { describe, expect, it } from 'vitest';

import { expandRepeatRows } from '@/lib/question/row-repeat';
import type { CalcExpr, Question, RowRepeatConfig, TableCell } from '@/types/survey';

import { duplicateQuestionTable } from './duplicate-question-table';

/**
 * 질문 복제의 표 부분 — 열·행·셀 id 를 전부 새로 발번하고, 그 id 를 가리키던 참조를
 * 함께 옮긴다.
 *
 * 옮기지 않으면 복제본의 게이팅 셀이 원본 질문의 컨트롤러를 보게 되어 영구 비활성이
 * 되고(컨트롤러 미응답 = 미충족 = 비활성), 검증 수식은 남의 칸 값으로 판정한다.
 * 행 복제(use-table-editor duplicateRow)가 이미 지키는 규약을 표 전체로 넓힌 것이다.
 */
function cell(id: string, extra: Partial<TableCell> = {}): TableCell {
  return { id, content: '', type: 'input', ...extra };
}

function tableQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'table',
    title: '표',
    order: 0,
    required: false,
    tableColumns: [
      { id: 'col1', label: '컨트롤러' },
      { id: 'col2', label: '입력' },
    ],
    tableRowsData: [
      {
        id: 'row1',
        label: '가',
        cells: [
          cell('c-ctrl'),
          cell('c-gated', { enabledWhen: { kind: 'filled', controllerCellId: 'c-ctrl' } }),
        ],
      },
    ],
    ...overrides,
  } as Question;
}

describe('duplicateQuestionTable', () => {
  it('열·행·셀 id 를 전부 새로 발번한다', () => {
    const out = duplicateQuestionTable(tableQuestion());
    expect(out.tableColumns!.map((c) => c.id)).not.toContain('col1');
    expect(out.tableRowsData!.map((r) => r.id)).not.toContain('row1');
    expect(out.tableRowsData![0]!.cells.map((c) => c.id)).not.toContain('c-ctrl');
  });

  it('게이팅 컨트롤러가 복제본의 셀을 가리킨다', () => {
    const out = duplicateQuestionTable(tableQuestion());
    const [ctrl, gated] = out.tableRowsData![0]!.cells;
    expect(gated!.enabledWhen).toEqual({ kind: 'filled', controllerCellId: ctrl!.id });
  });

  it('검증 수식의 셀 참조도 복제본을 가리킨다 — 중첩 항까지', () => {
    const formula: CalcExpr = {
      kind: 'group',
      op: '+',
      terms: [
        { kind: 'cell', cellId: 'c-ctrl' },
        { kind: 'agg', fn: 'sum', items: [{ kind: 'cell', cellId: 'c-gated' }] },
      ],
    };
    const q = tableQuestion();
    q.tableRowsData![0]!.cells[1] = { ...q.tableRowsData![0]!.cells[1]!, formula };

    const out = duplicateQuestionTable(q);
    const cells = out.tableRowsData![0]!.cells;
    const cloned = cells[1]!.formula as Extract<CalcExpr, { kind: 'group' }>;

    expect(cloned.terms[0]).toEqual({ kind: 'cell', cellId: cells[0]!.id });
    expect(cloned.terms[1]).toEqual({
      kind: 'agg',
      fn: 'sum',
      items: [{ kind: 'cell', cellId: cells[1]!.id }],
    });
  });

  it('다른 질문을 가리키는 수식은 그대로 둔다', () => {
    const q = tableQuestion();
    q.tableRowsData![0]!.cells[1] = {
      ...q.tableRowsData![0]!.cells[1]!,
      formula: { kind: 'cell', questionId: 'other-q', cellId: 'c-ctrl' },
    };
    const out = duplicateQuestionTable(q);
    expect(out.tableRowsData![0]!.cells[1]!.formula).toEqual({
      kind: 'cell',
      questionId: 'other-q',
      cellId: 'c-ctrl',
    });
  });

  it('셀 안 옵션 id 도 새로 발번한다 — 원본과 공유하면 상세 기재 사이드카가 충돌한다', () => {
    const q = tableQuestion();
    q.tableRowsData![0]!.cells[0] = cell('c-ctrl', {
      type: 'radio',
      radioOptions: [{ id: 'opt1', value: '1', label: '가' }],
    });
    const out = duplicateQuestionTable(q);
    expect(out.tableRowsData![0]!.cells[0]!.radioOptions![0]!.id).not.toBe('opt1');
  });

  it('동적 행 그룹의 삽입 위치를 새 행 id 로 옮긴다', () => {
    const q = tableQuestion({
      dynamicRowConfigs: [{ groupId: 'g1', enabled: true, insertAfterRowId: 'row1' }],
    });
    const out = duplicateQuestionTable(q);
    expect(out.dynamicRowConfigs![0]!.insertAfterRowId).toBe(out.tableRowsData![0]!.id);
  });

  it('행 반복 설정과 벌 표식도 새 행 id 를 가리킨다', () => {
    let n = 0;
    const config: RowRepeatConfig = { enabled: true, templateRowIds: ['row1'], maxRepeats: 2 };
    const q = tableQuestion({
      rowRepeatConfig: config,
      tableRowsData: expandRepeatRows(tableQuestion().tableRowsData!, config, () => `gen${++n}`),
    });

    const out = duplicateQuestionTable(q);
    const first = out.tableRowsData!.find((r) => r.repeatIndex === 1)!;

    expect(out.rowRepeatConfig!.templateRowIds).toEqual([first.id]);
    expect(out.tableRowsData!.filter((r) => r.repeatIndex).map((r) => r.repeatSourceRowId)).toEqual([
      first.id,
      first.id,
    ]);
  });

  it('반복 벌의 게이팅도 자기 벌을 가리킨다 — 원본 벌로 새지 않는다', () => {
    let n = 0;
    const config: RowRepeatConfig = { enabled: true, templateRowIds: ['row1'], maxRepeats: 2 };
    const q = tableQuestion({
      rowRepeatConfig: config,
      tableRowsData: expandRepeatRows(tableQuestion().tableRowsData!, config, () => `gen${++n}`),
    });

    const out = duplicateQuestionTable(q);
    const second = out.tableRowsData!.find((r) => r.repeatIndex === 2)!;
    expect(second.cells[1]!.enabledWhen).toEqual({
      kind: 'filled',
      controllerCellId: second.cells[0]!.id,
    });
  });

  it('표가 없는 질문은 표 관련 키를 만들지 않는다', () => {
    const out = duplicateQuestionTable({ id: 'q', type: 'text', title: '', order: 0, required: false } as Question);
    expect(out).toEqual({});
  });
});
