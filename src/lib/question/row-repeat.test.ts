import { describe, expect, it } from 'vitest';

import type { Question, RowRepeatConfig, TableCell, TableRow } from '@/types/survey';
import { buildTableCellVarName } from '@/utils/table-cell-code-generator';

import { ROW_REPEAT_MAX, collapseRepeatRows, expandRepeatRows } from './row-repeat';

// 결정론적 id 발번 — 멱등성 단언이 "무엇이 새로 생겼는지"를 눈으로 볼 수 있게 한다.
function makeIdFactory(prefix: string) {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function inputCell(id: string, extra: Partial<TableCell> = {}): TableCell {
  return { id, content: '', type: 'input', ...extra };
}

function row(id: string, label: string, cells: TableCell[], extra: Partial<TableRow> = {}): TableRow {
  return { id, label, cells, ...extra };
}

/** 라벨 행 1개 + 입력 2칸짜리 템플릿 한 벌을 가진 표. */
function baseRows(): TableRow[] {
  return [
    row('head', '머리', [inputCell('head_c1'), inputCell('head_c2')]),
    row('tpl', '성과명', [inputCell('tpl_c1'), inputCell('tpl_c2')]),
    row('tail', '합계', [inputCell('tail_c1'), inputCell('tail_c2')]),
  ];
}

function config(overrides: Partial<RowRepeatConfig> = {}): RowRepeatConfig {
  return { enabled: true, templateRowIds: ['tpl'], maxRepeats: 3, ...overrides };
}

describe('expandRepeatRows — 펼치기', () => {
  it('설정이 없거나 꺼져 있으면 원본 배열을 그대로 돌려준다', () => {
    const rows = baseRows();
    expect(expandRepeatRows(rows, undefined)).toBe(rows);
    expect(expandRepeatRows(rows, config({ enabled: false }))).toBe(rows);
    expect(expandRepeatRows(rows, config({ templateRowIds: [] }))).toBe(rows);
  });

  it('템플릿 묶음을 maxRepeats 벌까지 펼치고 원래 자리에 이어 붙인다', () => {
    const out = expandRepeatRows(baseRows(), config(), makeIdFactory('n'));

    expect(out.map((r) => r.id)).toEqual(['head', 'tpl', 'n1', 'n4', 'tail']);
    expect(out.map((r) => r.repeatIndex)).toEqual([undefined, 1, 2, 3, undefined]);
    expect(out.map((r) => r.repeatSourceRowId)).toEqual([
      undefined,
      'tpl',
      'tpl',
      'tpl',
      undefined,
    ]);
  });

  it('2벌 이후 셀에 새 id 를 발번하고 커스텀 코드 플래그는 떨군다', () => {
    const rows = baseRows();
    rows[1]!.cells[0] = inputCell('tpl_c1', {
      cellCode: 'Q1_MY_CODE',
      isCustomCellCode: true,
      exportLabel: '내 라벨',
      isCustomExportLabel: true,
    });

    const out = expandRepeatRows(rows, config({ maxRepeats: 2 }), makeIdFactory('n'));
    const second = out.find((r) => r.repeatIndex === 2)!;

    expect(second.cells.map((c) => c.id)).toEqual(['n2', 'n3']);
    expect(second.cells[0]!.cellCode).toBeUndefined();
    expect(second.cells[0]!.isCustomCellCode).toBeUndefined();
    expect(second.cells[0]!.exportLabel).toBeUndefined();
    // 1벌(템플릿)의 커스텀 코드는 손대지 않는다
    expect(out.find((r) => r.repeatIndex === 1)!.cells[0]!.cellCode).toBe('Q1_MY_CODE');
  });

  it('멱등하다 — 같은 설정으로 다시 펼쳐도 모든 행·셀 id 가 그대로다', () => {
    const once = expandRepeatRows(baseRows(), config(), makeIdFactory('n'));
    const twice = expandRepeatRows(once, config(), makeIdFactory('LATE'));

    expect(twice.map((r) => r.id)).toEqual(once.map((r) => r.id));
    expect(twice.flatMap((r) => r.cells.map((c) => c.id))).toEqual(
      once.flatMap((r) => r.cells.map((c) => c.id)),
    );
  });

  it('maxRepeats 를 늘리면 뒤에만 붙고 앞 벌의 id 는 변하지 않는다', () => {
    const three = expandRepeatRows(baseRows(), config({ maxRepeats: 3 }), makeIdFactory('n'));
    const five = expandRepeatRows(three, config({ maxRepeats: 5 }), makeIdFactory('m'));

    const keptIds = five.filter((r) => (r.repeatIndex ?? 1) <= 3).map((r) => r.id);
    expect(keptIds).toEqual(three.filter((r) => (r.repeatIndex ?? 1) <= 3).map((r) => r.id));
    expect(five.filter((r) => r.repeatIndex === 4 || r.repeatIndex === 5).map((r) => r.id)).toEqual([
      'm1',
      'm4',
    ]);
  });

  it('maxRepeats 를 줄이면 뒤쪽 벌이 잘린다', () => {
    const five = expandRepeatRows(baseRows(), config({ maxRepeats: 5 }), makeIdFactory('n'));
    const two = expandRepeatRows(five, config({ maxRepeats: 2 }), makeIdFactory('m'));

    expect(two.filter((r) => r.repeatIndex).map((r) => r.repeatIndex)).toEqual([1, 2]);
    expect(two.find((r) => r.repeatIndex === 2)!.id).toBe(
      five.find((r) => r.repeatIndex === 2)!.id,
    );
  });

  it('maxRepeats 는 1~20 으로 죈다', () => {
    const over = expandRepeatRows(baseRows(), config({ maxRepeats: 99 }), makeIdFactory('n'));
    expect(over.filter((r) => r.repeatIndex).length).toBe(ROW_REPEAT_MAX);

    const under = expandRepeatRows(baseRows(), config({ maxRepeats: 0 }), makeIdFactory('n'));
    expect(under.filter((r) => r.repeatIndex).length).toBe(1);
  });

  it('여러 행짜리 템플릿 묶음은 벌 단위로 통째 복제된다', () => {
    const rows = [
      row('a', '가', [inputCell('a1')]),
      row('b', '나', [inputCell('b1')]),
      row('c', '다', [inputCell('c1')]),
    ];
    const out = expandRepeatRows(
      rows,
      { enabled: true, templateRowIds: ['a', 'b'], maxRepeats: 2 },
      makeIdFactory('n'),
    );

    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'n1', 'n3', 'c']);
    expect(out.map((r) => r.repeatSourceRowId)).toEqual(['a', 'b', 'a', 'b', undefined]);
  });

  it('템플릿 구조 변경은 2벌부터에 전파하되 셀 id 는 유지한다', () => {
    const first = expandRepeatRows(baseRows(), config({ maxRepeats: 2 }), makeIdFactory('n'));
    const secondCellIds = first.find((r) => r.repeatIndex === 2)!.cells.map((c) => c.id);

    // 템플릿 셀의 placeholder 를 바꾸고 열을 하나 늘린다
    const edited = first.map((r) =>
      r.repeatIndex === 1
        ? {
            ...r,
            cells: [
              { ...r.cells[0]!, placeholder: '논문명' },
              r.cells[1]!,
              inputCell('tpl_c3'),
            ],
          }
        : r,
    );
    const out = expandRepeatRows(edited, config({ maxRepeats: 2 }), makeIdFactory('m'));
    const second = out.find((r) => r.repeatIndex === 2)!;

    expect(second.cells[0]!.placeholder).toBe('논문명');
    expect(second.cells.slice(0, 2).map((c) => c.id)).toEqual(secondCellIds);
    expect(second.cells[2]!.id).toBe('m1');
  });

  it('2벌부터의 라벨에 벌 번호를 붙이고 템플릿 라벨은 건드리지 않는다', () => {
    const out = expandRepeatRows(baseRows(), config(), makeIdFactory('n'));
    expect(out.map((r) => r.label)).toEqual(['머리', '성과명', '성과명 ②', '성과명 ③', '합계']);
  });

  it('라벨 번호는 누적되지 않는다 — 템플릿 라벨을 고치면 새 라벨로 다시 파생된다', () => {
    const once = expandRepeatRows(baseRows(), config(), makeIdFactory('n'));
    const renamed = once.map((r) => (r.repeatIndex === 1 ? { ...r, label: '논문명' } : r));
    const out = expandRepeatRows(renamed, config(), makeIdFactory('m'));
    expect(out.map((r) => r.label)).toEqual(['머리', '논문명', '논문명 ②', '논문명 ③', '합계']);
  });
});

describe('expandRepeatRows — rowCode 명시 발번 (결정 3)', () => {
  it('반복 행은 <원본 rowCode>_NN, 비반복 행은 펼치기 이전 기준 코드를 받는다', () => {
    const out = expandRepeatRows(baseRows(), config(), makeIdFactory('n'));
    expect(out.map((r) => r.rowCode)).toEqual(['r1', 'r2_01', 'r2_02', 'r2_03', 'r3']);
  });

  it('원본에 rowCode 가 있으면 그것을 밑동으로 쓴다', () => {
    const rows = baseRows();
    rows[1]!.rowCode = 'PAPER';
    const out = expandRepeatRows(rows, config({ maxRepeats: 2 }), makeIdFactory('n'));
    expect(out.map((r) => r.rowCode)).toEqual(['r1', 'PAPER_01', 'PAPER_02', 'r3']);
  });

  it('20벌로 펼쳐도 같은 표 비반복 행의 SPSS 변수명이 변하지 않는다', () => {
    const question = { id: 'q1', questionCode: 'QA1', type: 'table', title: '', order: 1, required: false } as Question;
    const columns = [{ id: 'c1', label: '열1' }, { id: 'c2', label: '열2' }];
    const before = baseRows();
    const beforeName = buildTableCellVarName(question, before[2]!, 0, columns, before);

    const after = expandRepeatRows(before, config({ maxRepeats: 20 }), makeIdFactory('n'));
    const tail = after.find((r) => r.id === 'tail')!;
    const afterName = buildTableCellVarName(question, tail, 0, columns, after);

    // 펼치기 전 이름은 rows.length=3 기준 r3, 펼친 뒤에도 명시 rowCode 덕에 같다
    expect(beforeName).toBe('QA1_r3_c1');
    expect(afterName).toBe(beforeName);
  });

  it('행이 10개를 넘는 표도 펼치기 이전 행 수 기준으로 패딩한다', () => {
    const rows: TableRow[] = [];
    for (let i = 1; i <= 12; i++) rows.push(row(`r${i}`, `행${i}`, [inputCell(`r${i}_c1`)]));
    const out = expandRepeatRows(
      rows,
      { enabled: true, templateRowIds: ['r5'], maxRepeats: 3 },
      makeIdFactory('n'),
    );
    expect(out.find((r) => r.id === 'r1')!.rowCode).toBe('r01');
    expect(out.find((r) => r.repeatIndex === 1)!.rowCode).toBe('r05_01');
    expect(out.find((r) => r.repeatIndex === 3)!.rowCode).toBe('r05_03');
  });
});

describe('collapseRepeatRows', () => {
  it('2벌 이후 행만 걷어낸다', () => {
    const out = expandRepeatRows(baseRows(), config(), makeIdFactory('n'));
    expect(collapseRepeatRows(out).map((r) => r.id)).toEqual(['head', 'tpl', 'tail']);
  });
});
