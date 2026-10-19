import { describe, expect, it } from 'vitest';

import {
  CELL_FORM_OWNED_KEYS,
  CELL_FORM_STRIPPED_KEYS,
  CELL_LIBRARY_DROPPED_KEYS,
  TABLE_CELL_FIELD_POLICY,
  omitCellKeys,
} from './table-cell-field-policy';

describe('셀 필드 정책', () => {
  it('폼이 모르는 키(kept)는 id·병합 숨김·렌더 표식뿐이다', () => {
    const kept = Object.keys(TABLE_CELL_FIELD_POLICY).filter(
      (k) => !(CELL_FORM_STRIPPED_KEYS as readonly string[]).includes(k),
    );
    expect(kept.sort()).toEqual(['_gridRowSpanExtra', '_isContinuation', 'id', 'isHidden']);
  });

  it('저장하면 늘 빠지는 키(dropped)는 셀의 textInputPlaceholder 하나다', () => {
    const dropped = CELL_FORM_STRIPPED_KEYS.filter(
      (k) => !(CELL_FORM_OWNED_KEYS as readonly string[]).includes(k),
    );
    expect(dropped).toEqual(['textInputPlaceholder']);
  });

  it('보관함 제거 목록 — 위치·병합·이미지·표 안 관계·설문 전역 이름·렌더 표식', () => {
    expect([...CELL_LIBRARY_DROPPED_KEYS].sort()).toEqual(
      [
        'id',
        'cellCode',
        'isCustomCellCode',
        'exportLabel',
        'isCustomExportLabel',
        'rowspan',
        'colspan',
        'isHidden',
        'imageUrl',
        'radioGroupName',
        'distinctGroup',
        'rankVarNames',
        'answerQuoteEnabled',
        'answerQuoteName',
        '_isContinuation',
        '_gridRowSpanExtra',
      ].sort(),
    );
  });

  it('omitCellKeys 는 원본을 건드리지 않는다', () => {
    const cell = { id: 'c1', type: 'text' as const, content: 'x', cellCode: 'Q1' };
    expect(omitCellKeys(cell, ['cellCode'])).toEqual({ id: 'c1', type: 'text', content: 'x' });
    expect(cell.cellCode).toBe('Q1');
  });
});
