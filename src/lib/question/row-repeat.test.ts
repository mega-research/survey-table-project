import { describe, expect, it } from 'vitest';

import type { Question, RowRepeatConfig, TableCell, TableRow } from '@/types/survey';
import { buildTableCellVarName } from '@/utils/table-cell-code-generator';

import { ROW_REPEAT_MAX, canUseFlatRowCodes, collapseRepeatRows, expandRepeatRows } from './row-repeat';

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

  it('2벌 이후 셀에 새 id 를 발번하고 커스텀 코드 플래그는 떨군다 — 직접 지정한 라벨은 벌 번호를 붙여 잇는다', () => {
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
    // 직접 지정한 엑셀 라벨은 버리지 않고 벌 번호를 붙여 잇는다 — 1벌과 같은 모양의 라벨
    expect(second.cells[0]!.exportLabel).toBe('내 라벨 ②');
    expect(second.cells[0]!.isCustomExportLabel).toBe(true);
    // 1벌(템플릿)의 커스텀 코드는 손대지 않는다
    expect(out.find((r) => r.repeatIndex === 1)!.cells[0]!.cellCode).toBe('Q1_MY_CODE');
  });

  it('자동 라벨(직접 지정 아님)인 칸은 복제 벌에서도 라벨을 비워 자동으로 짓게 둔다', () => {
    const rows = baseRows();
    rows[1]!.cells[0] = inputCell('tpl_c1', { exportLabel: '자동으로 채운 라벨' });
    const second = expandRepeatRows(rows, config({ maxRepeats: 2 }), makeIdFactory('n')).find((r) => r.repeatIndex === 2)!;
    expect(second.cells[0]!.exportLabel).toBeUndefined();
  });

  it('다시 펼쳐도 라벨 번호가 겹쳐 붙지 않는다', () => {
    const rows = baseRows();
    rows[1]!.cells[0] = inputCell('tpl_c1', { exportLabel: '연도', isCustomExportLabel: true });
    const once = expandRepeatRows(rows, config({ maxRepeats: 3 }), makeIdFactory('n'));
    const twice = expandRepeatRows(once, config({ maxRepeats: 3 }), makeIdFactory('m'));
    expect(twice.filter((r) => r.repeatSourceRowId === 'tpl').map((r) => r.cells[0]!.exportLabel)).toEqual(['연도', '연도 ②', '연도 ③']);
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

  it('maxRepeats 는 1~30 으로 죈다', () => {
    expect(ROW_REPEAT_MAX).toBe(30);
    const over = expandRepeatRows(baseRows(), config({ maxRepeats: 99 }), makeIdFactory('n'));
    expect(over.filter((r) => r.repeatIndex).length).toBe(ROW_REPEAT_MAX);

    const thirty = expandRepeatRows(baseRows(), config({ maxRepeats: 30 }), makeIdFactory('n'));
    expect(thirty.filter((r) => r.repeatIndex).length).toBe(30);

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

describe('expandRepeatRows — 선택 칸 보기 id', () => {
  // 상세 기재는 __optTexts__[문항][보기 id] 에 산다. 벌끼리 보기 id 가 같으면 한 벌의 「기타」 입력이
  // 다른 벌의 입력을 덮는다 — 벌마다 보기 id 가 갈려야 한다.
  function selectRows(options = [
    { id: 'o1', label: '우유', value: '01' },
    { id: 'o99', label: '기타', value: '99', allowTextInput: true },
  ]): TableRow[] {
    return [row('tpl', '품목', [{ id: 'sel', content: '', type: 'select', selectOptions: options }])];
  }
  const optionIds = (rows: TableRow[]) =>
    rows.map((r) => r.cells[0]!.selectOptions!.map((o) => o.id));

  it('1벌은 템플릿 보기 id 그대로, 2벌부터는 벌마다 다른 보기 id', () => {
    const out = expandRepeatRows(selectRows(), config(), makeIdFactory('n'));
    const ids = optionIds(out);
    expect(ids[0]).toEqual(['o1', 'o99']);
    expect(new Set(ids.flat()).size).toBe(6);
  });

  it('보기 값·라벨·상세 기재 설정은 그대로 복제한다', () => {
    const out = expandRepeatRows(selectRows(), config(), makeIdFactory('n'));
    for (const r of out) {
      expect(r.cells[0]!.selectOptions!.map((o) => [o.label, o.value, o.allowTextInput])).toEqual([
        ['우유', '01', undefined],
        ['기타', '99', true],
      ]);
    }
  });

  it('다시 펼쳐도 기존 벌의 보기 id 가 그대로다 — 이미 저장된 상세 기재가 고아가 되지 않는다', () => {
    const once = expandRepeatRows(selectRows(), config(), makeIdFactory('n'));
    const twice = expandRepeatRows(once, config(), makeIdFactory('m'));
    expect(optionIds(twice)).toEqual(optionIds(once));
  });

  it('템플릿에 보기를 끼워 넣어도 기존 보기의 벌별 id 는 따라간다', () => {
    const once = expandRepeatRows(selectRows(), config(), makeIdFactory('n'));
    const edited = once.map((r) =>
      r.repeatIndex === 1
        ? {
            ...r,
            cells: [
              {
                ...r.cells[0]!,
                selectOptions: [{ id: 'o0', label: '발효유', value: '00' }, ...r.cells[0]!.selectOptions!],
              },
            ],
          }
        : r,
    );
    const twice = expandRepeatRows(edited, config(), makeIdFactory('m'));
    const bundle2 = (rows: TableRow[]) => rows.find((r) => r.repeatIndex === 2)!.cells[0]!.selectOptions!;
    const otherBefore = bundle2(once).find((o) => o.value === '99')!.id;
    expect(bundle2(twice).find((o) => o.value === '99')!.id).toBe(otherBefore);
  });

  it('값이 없는 보기는 템플릿 보기 id 를 값으로 삼아 벌끼리 저장값이 같다', () => {
    const out = expandRepeatRows(
      selectRows([{ id: 'o1', label: '우유' } as never]),
      config(),
      makeIdFactory('n'),
    );
    expect(out.map((r) => r.cells[0]!.selectOptions![0]!.value ?? r.cells[0]!.selectOptions![0]!.id)).toEqual([
      'o1',
      'o1',
      'o1',
    ]);
  });
});

describe('expandRepeatRows — 라디오·체크박스 칸', () => {
  // 라디오·체크박스의 「기타」 상세 기재도 __optTexts__[문항][보기 id] 에 산다 — 보기 id 를 벌마다 가른다.
  // 라디오 묶음 이름(radioGroupName)은 내보내기가 표 전체에서 같은 이름을 변수 하나로 합치므로 벌마다 가른다.
  function choiceRows(): TableRow[] {
    return [
      row('tpl', '품목', [
        {
          id: 'rad',
          content: '',
          type: 'radio',
          radioGroupName: 'will',
          radioOptions: [
            { id: 'r1', label: '있음', value: '1' },
            { id: 'r9', label: '기타', value: '9', allowTextInput: true },
          ],
        },
        {
          id: 'chk',
          content: '',
          type: 'checkbox',
          checkboxOptions: [
            { id: 'k1', label: '가', value: '1' },
            { id: 'k9', label: '기타', value: '9', allowTextInput: true },
          ],
        },
      ] as TableCell[]),
    ];
  }

  it('2벌부터 라디오·체크박스 보기 id 가 벌마다 다르고 값은 같다', () => {
    const out = expandRepeatRows(choiceRows(), config(), makeIdFactory('n'));
    const radioIds = out.map((r) => r.cells[0]!.radioOptions!.map((o) => o.id));
    const checkIds = out.map((r) => r.cells[1]!.checkboxOptions!.map((o) => o.id));
    expect(radioIds[0]).toEqual(['r1', 'r9']);
    expect(new Set(radioIds.flat()).size).toBe(6);
    expect(new Set(checkIds.flat()).size).toBe(6);
    for (const r of out) {
      expect(r.cells[0]!.radioOptions!.map((o) => o.value)).toEqual(['1', '9']);
      expect(r.cells[1]!.checkboxOptions!.map((o) => o.value)).toEqual(['1', '9']);
    }
  });

  it('라디오 묶음 이름은 1벌 그대로, 2벌부터 벌마다 다르다', () => {
    const out = expandRepeatRows(choiceRows(), config(), makeIdFactory('n'));
    expect(out.map((r) => r.cells[0]!.radioGroupName)).toEqual(['will', 'will-r2', 'will-r3']);
  });

  it('다시 펼쳐도 보기 id·묶음 이름이 그대로다', () => {
    const once = expandRepeatRows(choiceRows(), config(), makeIdFactory('n'));
    const twice = expandRepeatRows(once, config(), makeIdFactory('m'));
    expect(twice.map((r) => r.cells.map((c) => [c.radioGroupName, (c.radioOptions ?? c.checkboxOptions)!.map((o) => o.id)]))).toEqual(
      once.map((r) => r.cells.map((c) => [c.radioGroupName, (c.radioOptions ?? c.checkboxOptions)!.map((o) => o.id)])),
    );
  });
});

describe('expandRepeatRows — 줄 번호 변수명(flatRowCodes)', () => {
  // 틀이 1줄인 반복은 `r01_01`·`r01_02` 의 앞 r01 이 늘 같아 읽기만 어렵다. 켜면 벌마다 r01·r02 …로 짓는다 —
  // 미리 만든 행을 쓰던 표(행 차례로 열기)에서 바꿔도 변수명이 그대로다. 기본은 꺼짐(기존 설문 변수명 보존).
  const single = (): TableRow[] => [row('tpl', '원료', [inputCell('c1'), inputCell('c2')], { rowCode: 'r01' })];
  const q = (rows: TableRow[]) =>
    ({ id: 'q', type: 'table', questionCode: 'Q2', tableColumns: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }], tableRowsData: rows }) as unknown as Question;

  it('켜면 틀 1줄의 벌이 r01·r02·r03 이 된다', () => {
    const out = expandRepeatRows(single(), config({ flatRowCodes: true }), makeIdFactory('n'));
    expect(out.map((r) => r.rowCode)).toEqual(['r01', 'r02', 'r03']);
    const cols = q(out).tableColumns!;
    expect(buildTableCellVarName(q(out), out[1]!, 1, cols, out)).toBe('Q2_r02_c2');
  });

  it('끄면(기본) 종전대로 r01_01 …', () => {
    expect(expandRepeatRows(single(), config(), makeIdFactory('n')).map((r) => r.rowCode)).toEqual(['r01_01', 'r01_02', 'r01_03']);
  });

  it('켰다 껐다 해도 밑동이 누적되지 않는다', () => {
    const flat = expandRepeatRows(single(), config({ flatRowCodes: true }), makeIdFactory('n'));
    const off = expandRepeatRows(flat, config(), makeIdFactory('m'));
    expect(off.map((r) => r.rowCode)).toEqual(['r01_01', 'r01_02', 'r01_03']);
    const again = expandRepeatRows(off, config({ flatRowCodes: true }), makeIdFactory('k'));
    expect(again.map((r) => r.rowCode)).toEqual(['r01', 'r02', 'r03']);
    expect(again.map((r) => r.id)).toEqual(flat.map((r) => r.id));
  });

  it('틀이 2줄 이상이면 무시한다 — 줄 번호만으로는 어느 틀 줄인지 가를 수 없다', () => {
    const rows = [
      row('a', '국내산', [inputCell('a1')], { rowCode: 'r01' }),
      row('b', '수입산', [inputCell('b1')], { rowCode: 'r02' }),
    ];
    const out = expandRepeatRows(rows, config({ templateRowIds: ['a', 'b'], maxRepeats: 2, flatRowCodes: true }), makeIdFactory('n'));
    expect(out.map((r) => r.rowCode)).toEqual(['r01_01', 'r02_01', 'r01_02', 'r02_02']);
  });

  it('표의 다른 행 코드와 겹치면 무시한다 — 변수명이 겹치면 안 된다', () => {
    const rows = [...single(), row('tail', '합계', [inputCell('t1'), inputCell('t2')], { rowCode: 'r02' })];
    const out = expandRepeatRows(rows, config({ flatRowCodes: true }), makeIdFactory('n'));
    expect(out.map((r) => r.rowCode)).toEqual(['r01_01', 'r01_02', 'r01_03', 'r02']);
    expect(canUseFlatRowCodes(rows, ['tpl'], 3)).toBe(false);
    expect(canUseFlatRowCodes(single(), ['tpl'], 3)).toBe(true);
  });
});
