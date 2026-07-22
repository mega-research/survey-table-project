import { describe, expect, it } from 'vitest';

import type { TableCell, TableRow } from '@/types/survey';
import {
  excludeMobileDrilldownRepeatedRows,
  formatMobileDrilldownRepeatHeaderRange,
  getMobileDrilldownRepeatedBodyRowIds,
  includesMobileDrilldownColumnHeader,
  parseMobileDrilldownRepeatHeaderText,
  resolveMobileDrilldownRepeatHeaderRange,
} from '@/utils/mobile-drilldown-repeat-header';

const text = (id: string, content = id, rowspan?: number): TableCell => ({
  id,
  type: 'text',
  content,
  ...(rowspan === undefined ? {} : { rowspan }),
});

const row = (id: string, cells: TableCell[] = [text(`${id}-cell`)]): TableRow => ({
  id,
  label: id,
  cells,
});

describe('parseMobileDrilldownRepeatHeaderText', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['0', { startRow: 0, endRow: 0 }],
    ['3', { startRow: 3, endRow: 3 }],
    ['2-3', { startRow: 2, endRow: 3 }],
    [' 0 - 2 ', { startRow: 0, endRow: 2 }],
    ['1 2', { startRow: 12, endRow: 12 }],
  ])('%j를 정상 범위로 해석한다', (input, expected) => {
    expect(parseMobileDrilldownRepeatHeaderText(input)).toEqual({ ok: true, value: expected });
  });

  it.each(['-1', '3-2', '1-', '-2', '1-2-3', '1.5', '문자'])('%j는 저장하지 않는다', (input) => {
    expect(parseMobileDrilldownRepeatHeaderText(input)).toEqual({ ok: false });
  });
});

describe('resolveMobileDrilldownRepeatHeaderRange', () => {
  it('필드가 모두 없고 열 제목을 표시하던 과거 질문은 0/0으로 해석한다', () => {
    expect(resolveMobileDrilldownRepeatHeaderRange({})).toEqual({ startRow: 0, endRow: 0 });
  });

  it('필드가 모두 없고 열 제목을 숨기던 과거 질문은 반복 없음으로 해석한다', () => {
    expect(resolveMobileDrilldownRepeatHeaderRange({ hideColumnLabels: true })).toBeNull();
  });

  it('명시적 null/null은 반복 없음으로 보존한다', () => {
    expect(resolveMobileDrilldownRepeatHeaderRange({
      mobileDrilldownRepeatHeaderStartRow: null,
      mobileDrilldownRepeatHeaderEndRow: null,
    })).toBeNull();
  });

  it.each([
    { mobileDrilldownRepeatHeaderStartRow: 2, mobileDrilldownRepeatHeaderEndRow: null },
    { mobileDrilldownRepeatHeaderStartRow: undefined, mobileDrilldownRepeatHeaderEndRow: 2 },
    { mobileDrilldownRepeatHeaderStartRow: -1, mobileDrilldownRepeatHeaderEndRow: 2 },
    { mobileDrilldownRepeatHeaderStartRow: -1, mobileDrilldownRepeatHeaderEndRow: 2, hideColumnLabels: true },
    { mobileDrilldownRepeatHeaderStartRow: 3, mobileDrilldownRepeatHeaderEndRow: 2 },
    { mobileDrilldownRepeatHeaderStartRow: 1.5, mobileDrilldownRepeatHeaderEndRow: 2 },
  ])('비정상 저장값 $mobileDrilldownRepeatHeaderStartRow/$mobileDrilldownRepeatHeaderEndRow은 0/0으로 폴백한다', (input) => {
    expect(resolveMobileDrilldownRepeatHeaderRange(input)).toEqual({ startRow: 0, endRow: 0 });
  });
});

describe('반복 본문 행 선택', () => {
  const authoredRows = [row('r1'), row('r2'), row('r3')];

  it('작성 위치를 1부터 세고 out-of-range를 clamp하지 않는다', () => {
    expect([...getMobileDrilldownRepeatedBodyRowIds(authoredRows, { startRow: 2, endRow: 5 })])
      .toEqual(['r2', 'r3']);
    expect([...getMobileDrilldownRepeatedBodyRowIds(authoredRows, { startRow: 8, endRow: 10 })])
      .toEqual([]);
  });

  it('0은 정식 헤더로만 취급하고 본문 ID에 넣지 않는다', () => {
    const range = { startRow: 0, endRow: 2 };
    expect(includesMobileDrilldownColumnHeader(range)).toBe(true);
    expect([...getMobileDrilldownRepeatedBodyRowIds(authoredRows, range)]).toEqual(['r1', 'r2']);
    expect(formatMobileDrilldownRepeatHeaderRange(range)).toBe('0-2');
    expect(formatMobileDrilldownRepeatHeaderRange(null)).toBe('');
  });

  it('조건으로 이미 숨은 반복 행은 상세 후보에 없고 남은 목차 rowspan anchor를 승격한다', () => {
    const displayRows = [
      row('r1', [text('anchor', '공통', 3)]),
      row('r3', [{ id: 'continuation-3', type: 'text', content: '', isHidden: true, _isContinuation: true }]),
    ];
    const navigationRows = excludeMobileDrilldownRepeatedRows(displayRows, new Set(['r1', 'r2']));
    expect(navigationRows.map((item) => item.id)).toEqual(['r3']);
    expect(navigationRows[0]?.cells[0]).toMatchObject({ id: 'anchor', content: '공통' });
    expect(navigationRows[0]?.cells[0]).not.toHaveProperty('isHidden', true);
    expect(navigationRows[0]?.cells[0]?.rowspan ?? 1).toBe(1);
  });
});
