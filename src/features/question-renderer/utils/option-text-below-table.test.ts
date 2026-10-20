import { describe, expect, it } from 'vitest';

import type { TableCell, TableColumn, TableRow } from '@/types/survey';

import {
  belowTableOptionTextsFromKey,
  belowTableSelectionKey,
  collectBelowTableCandidates,
  movesOptionTextBelowTable,
  selectBelowTableOptionTexts,
} from './option-text-below-table';

const columns: TableColumn[] = [
  { id: 'c0', label: '구분', width: 200 },
  { id: 'c1', label: '2022년', width: 120 },
  { id: 'c2', label: '2023년', width: 120 },
];

const label = (id: string, content: string): TableCell => ({ id, content, type: 'text' });
const check = (id: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  content: '',
  type: 'checkbox',
  checkboxOptions: [{ id: `${id}-o`, label: '', value: '7', allowTextInput: true }],
  optionTextBelowTable: true,
  ...extra,
});

const rows: TableRow[] = [
  { id: 'r1', label: '개인', cells: [label('l1', '⑥ 개인'), check('a1', { checkboxOptions: [{ id: 'a1-o', label: '', value: '6' }] }), check('a2', { checkboxOptions: [{ id: 'a2-o', label: '', value: '6' }] })] },
  { id: 'r2', label: '기타', cells: [label('l2', '⑦ 기타'), check('b1'), check('b2')] },
];

describe('상세 기재 입력칸을 표 아래에', () => {
  it('옵션을 켠 칸 중 상세 기재 보기가 있는 칸만 내보낸다', () => {
    expect(movesOptionTextBelowTable(check('x'))).toBe(true);
    expect(movesOptionTextBelowTable(check('x', { optionTextBelowTable: false }))).toBe(false);
    // 상세 기재 보기가 없으면 옮길 것이 없다
    expect(movesOptionTextBelowTable(rows[0]!.cells[1]!)).toBe(false);
    // 병합에 가려진 칸은 그려지지 않는다
    expect(movesOptionTextBelowTable(check('x', { isHidden: true }))).toBe(false);
    // 입력 칸에는 뜻이 없다
    expect(movesOptionTextBelowTable({ id: 'i', content: '', type: 'input', optionTextBelowTable: true })).toBe(false);
  });

  it('선택된 기타 보기만, 읽는 순서로, 행 제목 · 열 제목 라벨과 함께 낸다', () => {
    const candidates = collectBelowTableCandidates({ columns, displayRows: rows });
    expect(candidates.map((c) => c.cell.id)).toEqual(['b1', 'b2']);

    expect(selectBelowTableOptionTexts(candidates, {})).toEqual([]);
    const entries = selectBelowTableOptionTexts(candidates, { b2: ['7'], b1: ['7'], a1: ['6'] });
    expect(entries.map((e) => [e.cell.id, e.option.id, e.labelParts])).toEqual([
      ['b1', 'b1-o', ['⑦ 기타', '2022년']],
      ['b2', 'b2-o', ['⑦ 기타', '2023년']],
    ]);
  });

  it('보기 라벨이 있으면 뒤에 붙이고, 행 제목과 같으면 되풀이하지 않는다', () => {
    const radioRows: TableRow[] = [
      {
        id: 'r1',
        label: '유형',
        cells: [
          label('l1', '기타'),
          {
            id: 'rad',
            content: '',
            type: 'radio',
            optionTextBelowTable: true,
            radioOptions: [
              { id: 'o1', label: '해당', value: '1' },
              { id: 'o2', label: '기타', value: '2', allowTextInput: true },
              { id: 'o3', label: '그 밖의\n사유', value: '3', allowTextInput: true },
            ],
          },
          label('l3', ''),
        ],
      },
    ];
    const candidates = collectBelowTableCandidates({ columns, displayRows: radioRows });
    expect(selectBelowTableOptionTexts(candidates, { rad: '1' })).toEqual([]);
    expect(selectBelowTableOptionTexts(candidates, { rad: '2' })[0]!.labelParts).toEqual(['기타', '2022년']);
    expect(selectBelowTableOptionTexts(candidates, { rad: '3' })[0]!.labelParts).toEqual([
      '기타',
      '2022년',
      '그 밖의 사유',
    ]);
  });

  it('구독 키는 선택 쌍이 그대로면 같고, 키에서 같은 목록을 되살린다', () => {
    const candidates = collectBelowTableCandidates({ columns, displayRows: rows });
    const key = belowTableSelectionKey(candidates, { b1: ['7'] });
    // 다른 칸의 값이 바뀌어도 키는 그대로다
    expect(belowTableSelectionKey(candidates, { b1: ['7'], a1: ['6'], l1: 'x' })).toBe(key);
    expect(belowTableSelectionKey(candidates, { b1: ['7'], b2: ['7'] })).not.toBe(key);
    expect(belowTableSelectionKey(candidates, undefined)).toBe('');
    expect(belowTableOptionTextsFromKey(candidates, key)).toEqual(
      selectBelowTableOptionTexts(candidates, { b1: ['7'] }),
    );
    expect(belowTableOptionTextsFromKey(candidates, '')).toEqual([]);
  });

  it('옵션을 켠 칸이 없는 표는 아무것도 만들지 않는다', () => {
    const plain = rows.map((row) => ({
      ...row,
      cells: row.cells.map(({ optionTextBelowTable: _drop, ...cell }) => cell),
    }));
    expect(collectBelowTableCandidates({ columns, displayRows: plain })).toEqual([]);
  });
});
