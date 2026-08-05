import { describe, it, expect } from 'vitest';

import {
  extractRegionFromRows,
  findRegionSourceCellPos,
  pruneDeadGatingAfterPaste,
  resolvePastedGating,
} from '@/components/survey-builder/utils/drag-copy-utils';
import type { CellEnableCondition, TableCell, TableRow } from '@/types/survey';

const condition: CellEnableCondition = {
  kind: 'option',
  controllerCellId: 'src-ctrl',
  values: ['1'],
};

describe('resolvePastedGating — 붙여넣기/복제 시 게이팅 참조 재해석', () => {
  it('영역 내 컨트롤러는 리매핑된 id 로 치환된다', () => {
    const out = resolvePastedGating(condition, 'target-ctrl', [{ id: 'x' }]);
    expect(out).toEqual({ kind: 'option', controllerCellId: 'target-ctrl', values: ['1'] });
  });

  it('영역 밖이지만 대상 행에 보이는 셀로 있으면(같은 행 이동) 유지된다', () => {
    const out = resolvePastedGating(condition, undefined, [{ id: 'src-ctrl' }, { id: 'x' }]);
    expect(out).toBe(condition);
  });

  it('다른 행의 컨트롤러는 제거된다 (undefined)', () => {
    const out = resolvePastedGating(condition, undefined, [{ id: 'x' }, { id: 'y' }]);
    expect(out).toBeUndefined();
  });

  it('대상 행의 컨트롤러가 병합으로 숨겨져 있으면 제거된다 — 숨김 셀은 응답 불가라 영구 비활성', () => {
    const out = resolvePastedGating(condition, undefined, [
      { id: 'src-ctrl', isHidden: true },
      { id: 'x' },
    ]);
    expect(out).toBeUndefined();
  });

  it('numeric 조건도 op/value 를 보존한 채 리매핑된다', () => {
    const numeric: CellEnableCondition = {
      kind: 'numeric',
      controllerCellId: 'src-ctrl',
      op: '>=',
      value: 3,
    };
    const out = resolvePastedGating(numeric, 'new-ctrl', []);
    expect(out).toEqual({ kind: 'numeric', controllerCellId: 'new-ctrl', op: '>=', value: 3 });
  });
});

describe('영역 스냅샷의 게이팅 컨트롤러 되짚기 (sourceCellIds)', () => {
  const rows: TableRow[] = [
    {
      id: 'r1',
      label: '행1',
      cells: [
        { id: 'lbl', type: 'text', content: '라벨' },
        {
          id: 'ctrl',
          type: 'radio',
          content: '',
          radioOptions: [{ id: 'o1', label: '수행', value: '1' }],
        },
        {
          id: 'gated',
          type: 'input',
          content: '',
          enabledWhen: { kind: 'option', controllerCellId: 'ctrl', values: ['1'] },
        },
      ],
    },
  ] as TableRow[];

  it('스냅샷 셀에는 id 가 없지만 sourceCellIds 격자에는 원본 id 가 남는다', () => {
    const region = extractRegionFromRows(0, 0, 1, 2, rows);
    expect(region.cells[0]?.[0]?.id).toBeUndefined();
    expect(region.sourceCellIds).toEqual([['ctrl', 'gated']]);
  });

  it('findRegionSourceCellPos 가 컨트롤러의 상대 위치를 찾는다', () => {
    const region = extractRegionFromRows(0, 0, 1, 2, rows);
    expect(findRegionSourceCellPos(region, 'ctrl')).toEqual({ row: 0, col: 0 });
    expect(findRegionSourceCellPos(region, 'gated')).toEqual({ row: 0, col: 1 });
    expect(findRegionSourceCellPos(region, 'ghost')).toBeUndefined();
  });

  it('영역 내 컨트롤러 → 상대 위치 → 대상 셀 id 리매핑이 끝까지 이어진다', () => {
    // 컨트롤러+게이팅 셀을 함께 복사해 다른 행(r2)에 붙여넣는 시나리오
    const region = extractRegionFromRows(0, 0, 1, 2, rows);
    const targetRowCells = [
      { id: 't-ctrl' },
      { id: 't-gated' },
    ];
    const pastedCondition = region.cells[0]?.[1]?.enabledWhen;
    expect(pastedCondition).toBeDefined();
    const pos = findRegionSourceCellPos(region, pastedCondition!.controllerCellId);
    expect(pos).toEqual({ row: 0, col: 0 });
    const remappedId = targetRowCells[pos!.col]?.id;
    const resolved = resolvePastedGating(pastedCondition!, remappedId, targetRowCells);
    expect(resolved).toEqual({ kind: 'option', controllerCellId: 't-ctrl', values: ['1'] });
  });
});

describe('pruneDeadGatingAfterPaste — 붙여넣기가 새로 숨기는 컨트롤러 정리', () => {
  const gatedTo = (controllerCellId: string): Partial<TableCell> => ({
    enabledWhen: { kind: 'option', controllerCellId, values: ['1'] },
    requiredWhenEnabled: true,
  });

  function makeRow(cells: TableCell[]): TableRow {
    return { id: 'r0', label: '행', cells } as TableRow;
  }

  it('붙여넣은 병합 스팬이 컨트롤러를 새로 덮으면 영역 밖 게이팅 셀의 참조를 제거한다', () => {
    const original: TableRow[] = [
      makeRow([
        { id: 'A', type: 'text', content: '' },
        { id: 'B', type: 'radio', content: '', radioOptions: [{ id: 'o1', label: '수행', value: '1' }] },
        { id: 'C', type: 'input', content: '', ...gatedTo('B') } as TableCell,
      ]),
    ];
    // 붙여넣기 후: col0 에 colspan 2 앵커가 들어와 B(col1)를 덮는다. C(col2)는 영역 밖.
    const draft: TableRow[] = [
      makeRow([
        { id: 'A', type: 'text', content: '병합', colspan: 2 },
        { id: 'B', type: 'text', content: '' },
        { id: 'C', type: 'input', content: '', ...gatedTo('B') } as TableCell,
      ]),
    ];
    pruneDeadGatingAfterPaste(draft, original, { fromRow: 0, toRow: 0, fromCol: 0, toCol: 1 });
    const c = draft[0]!.cells[2]!;
    expect('enabledWhen' in c).toBe(false);
    expect('requiredWhenEnabled' in c).toBe(false);
  });

  it('이전부터 덮여 있던 컨트롤러의 영역 밖 참조는 보존한다 — 사용자 저작 데이터, 진단이 담당', () => {
    const legacyRow = makeRow([
      { id: 'A', type: 'text', content: '병합', colspan: 2 },
      { id: 'B', type: 'radio', content: '', isHidden: true },
      { id: 'C', type: 'input', content: '', ...gatedTo('B') } as TableCell,
      { id: 'D', type: 'text', content: '' },
    ]);
    const original: TableRow[] = [legacyRow];
    const draft: TableRow[] = [structuredClone(legacyRow)];
    // 무관한 위치(col3)에 붙여넣기
    pruneDeadGatingAfterPaste(draft, original, { fromRow: 0, toRow: 0, fromCol: 3, toCol: 3 });
    expect(draft[0]!.cells[2]!.enabledWhen).toBeDefined();
  });

  it('영역 안 셀의 죽은 참조(컨트롤러 부재)는 제거한다', () => {
    const original: TableRow[] = [
      makeRow([
        { id: 'A', type: 'text', content: '' },
        { id: 'B', type: 'input', content: '' },
      ]),
    ];
    const draft: TableRow[] = [
      makeRow([
        { id: 'A', type: 'text', content: '' },
        { id: 'B', type: 'input', content: '', ...gatedTo('ghost') } as TableCell,
      ]),
    ];
    pruneDeadGatingAfterPaste(draft, original, { fromRow: 0, toRow: 0, fromCol: 1, toCol: 1 });
    expect('enabledWhen' in draft[0]!.cells[1]!).toBe(false);
  });

  it('살아있는 참조는 영역 안팎 모두 유지한다', () => {
    const row = makeRow([
      { id: 'B', type: 'radio', content: '', radioOptions: [{ id: 'o1', label: '수행', value: '1' }] },
      { id: 'C', type: 'input', content: '', ...gatedTo('B') } as TableCell,
    ]);
    const original: TableRow[] = [structuredClone(row)];
    const draft: TableRow[] = [structuredClone(row)];
    pruneDeadGatingAfterPaste(draft, original, { fromRow: 0, toRow: 0, fromCol: 1, toCol: 1 });
    expect(draft[0]!.cells[1]!.enabledWhen).toBeDefined();
    expect(draft[0]!.cells[1]!.requiredWhenEnabled).toBe(true);
  });
});
