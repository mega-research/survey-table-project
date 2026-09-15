import { describe, expect, it } from 'vitest';

import type { CalcExpr, RowRepeatConfig, TableCell, TableRow } from '@/types/survey';

import { expandRepeatRows } from './row-repeat';

/**
 * 복제 벌의 내부 참조 — 게이팅(enabledWhen)과 검증 수식(formula)은 셀 id 로 다른 셀을
 * 가리킨다. 얕게 복사하면 2벌 셀이 1벌 셀을 보고 열리고 닫히고 검증된다.
 *
 * 블록 **밖**을 가리키는 참조는 그대로 둔다 — 모든 벌이 같은 바깥 셀에 매이는 것이 옳다.
 */
const config: RowRepeatConfig = { enabled: true, templateRowIds: ['tpl'], maxRepeats: 2 };

function rowsWithGating(): TableRow[] {
  return [
    { id: 'outside', label: '바깥', cells: [{ id: 'out1', type: 'input', content: '' }] },
    {
      id: 'tpl',
      label: '성과',
      cells: [
        { id: 't-ctrl', type: 'input', content: '' },
        {
          id: 't-gated',
          type: 'input',
          content: '',
          enabledWhen: { kind: 'filled', controllerCellId: 't-ctrl' },
        },
      ],
    },
  ] as TableRow[];
}

function expand(rows: TableRow[]) {
  let n = 0;
  return expandRepeatRows(rows, config, () => `gen${++n}`);
}

describe('복제 벌의 블록 안 참조는 자기 벌을 가리킨다', () => {
  it('게이팅 컨트롤러가 같은 벌의 셀로 옮겨간다', () => {
    const out = expand(rowsWithGating());
    const second = out.find((r) => r.repeatIndex === 2)!;
    const [ctrl, gated] = second.cells;

    expect(gated!.enabledWhen).toEqual({ kind: 'filled', controllerCellId: ctrl!.id });
    expect(gated!.enabledWhen!.controllerCellId).not.toBe('t-ctrl');
  });

  it('option 게이팅도 같은 규칙을 탄다', () => {
    const rows = rowsWithGating();
    rows[1]!.cells[1]!.enabledWhen = {
      kind: 'option',
      controllerCellId: 't-ctrl',
      values: ['1'],
    };
    const second = expand(rows).find((r) => r.repeatIndex === 2)!;
    expect(second.cells[1]!.enabledWhen).toEqual({
      kind: 'option',
      controllerCellId: second.cells[0]!.id,
      values: ['1'],
    });
  });

  it('검증 수식의 셀 참조도 같은 벌로 옮겨간다 — 중첩 항까지', () => {
    const rows = rowsWithGating();
    const formula: CalcExpr = {
      kind: 'group',
      op: '+',
      terms: [
        { kind: 'cell', cellId: 't-ctrl' },
        { kind: 'agg', fn: 'sum', items: [{ kind: 'cell', cellId: 't-gated' }] },
        { kind: 'literal', value: 1 },
      ],
    };
    rows[1]!.cells[1] = { ...rows[1]!.cells[1]!, formula } as TableCell;

    const second = expand(rows).find((r) => r.repeatIndex === 2)!;
    const cloned = second.cells[1]!.formula as Extract<CalcExpr, { kind: 'group' }>;

    expect(cloned.terms[0]).toEqual({ kind: 'cell', cellId: second.cells[0]!.id });
    expect(cloned.terms[1]).toEqual({
      kind: 'agg',
      fn: 'sum',
      items: [{ kind: 'cell', cellId: second.cells[1]!.id }],
    });
    expect(cloned.terms[2]).toEqual({ kind: 'literal', value: 1 });
  });

  it('블록 밖을 가리키는 참조는 그대로 둔다 — 모든 벌이 같은 바깥 셀에 매인다', () => {
    const rows = rowsWithGating();
    rows[1]!.cells[1]!.enabledWhen = { kind: 'filled', controllerCellId: 'out1' };
    const second = expand(rows).find((r) => r.repeatIndex === 2)!;
    expect(second.cells[1]!.enabledWhen).toEqual({ kind: 'filled', controllerCellId: 'out1' });
  });

  it('다른 질문의 셀을 가리키는 수식은 건드리지 않는다', () => {
    const rows = rowsWithGating();
    rows[1]!.cells[1] = {
      ...rows[1]!.cells[1]!,
      formula: { kind: 'cell', questionId: 'other-q', cellId: 't-ctrl' },
    } as TableCell;
    const second = expand(rows).find((r) => r.repeatIndex === 2)!;
    expect(second.cells[1]!.formula).toEqual({
      kind: 'cell',
      questionId: 'other-q',
      cellId: 't-ctrl',
    });
  });

  it('1벌(템플릿)의 참조는 손대지 않는다', () => {
    const first = expand(rowsWithGating()).find((r) => r.repeatIndex === 1)!;
    expect(first.cells[1]!.enabledWhen).toEqual({ kind: 'filled', controllerCellId: 't-ctrl' });
  });

  it('재펼치기에서도 참조가 자기 벌을 계속 가리킨다', () => {
    const once = expand(rowsWithGating());
    let n = 0;
    const twice = expandRepeatRows(once, config, () => `late${++n}`);
    const second = twice.find((r) => r.repeatIndex === 2)!;
    expect(second.cells[1]!.enabledWhen).toEqual({
      kind: 'filled',
      controllerCellId: second.cells[0]!.id,
    });
  });
});
