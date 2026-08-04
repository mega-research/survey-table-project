import { describe, expect, it } from 'vitest';

import type { HeaderCell, TableColumn } from '@/types/survey';
import {
  applyHeaderBulkStyle,
  getCommonHeaderStyle,
  withHeaderStyle,
} from '@/utils/header-style';

const columns: TableColumn[] = [
  { id: 'c1', label: '성별' },
  { id: 'c2', label: '연령' },
];
const grid: HeaderCell[][] = [
  [{ id: 'h1', label: '응답자 특성', colspan: 2, rowspan: 1 }],
  [
    { id: 'h2', label: '성별', colspan: 1, rowspan: 1 },
    { id: 'h3', label: '연령', colspan: 1, rowspan: 1 },
  ],
];

describe('applyHeaderBulkStyle', () => {
  it('모든 기본 헤더와 병합된 다단계 헤더에 정규화된 스타일을 불변 적용한다', () => {
    const result = applyHeaderBulkStyle(columns, grid, {
      textBold: true,
      backgroundColor: 'abc',
    });

    expect(result.columns).not.toBe(columns);
    expect(result.headerGrid).not.toBe(grid);
    expect(result.columns.every((column) => (
      column.textBold === true && column.backgroundColor === '#AABBCC'
    ))).toBe(true);
    expect(result.headerGrid?.flat().every((cell) => (
      cell.textBold === true && cell.backgroundColor === '#AABBCC'
    ))).toBe(true);
    expect(columns[0]).toEqual({ id: 'c1', label: '성별' });
  });

  it('해제 시 모든 헤더에서 선택 스타일 속성을 제거한다', () => {
    const styledColumns = columns.map((column) => ({
      ...column,
      textBold: true,
      backgroundColor: '#112233',
    }));
    const styledGrid = grid.map((row) => row.map((cell) => ({
      ...cell,
      textBold: true,
      backgroundColor: '#112233',
    })));

    const result = applyHeaderBulkStyle(styledColumns, styledGrid, {
      textBold: false,
      backgroundColor: '',
    });

    expect(result.columns.every((column) => (
      !('textBold' in column) && !('backgroundColor' in column)
    ))).toBe(true);
    expect(result.headerGrid?.flat().every((cell) => (
      !('textBold' in cell) && !('backgroundColor' in cell)
    ))).toBe(true);
  });

  it('다단계 헤더가 없으면 기본 열만 갱신한다', () => {
    const result = applyHeaderBulkStyle(columns, undefined, {
      textBold: true,
      backgroundColor: '#123456',
    });

    expect(result.headerGrid).toBeUndefined();
    expect(result.columns).toHaveLength(2);
  });

  it('모든 헤더가 같은 경우 공통 스타일을 반환하고 혼합 상태는 기본값으로 반환한다', () => {
    const uniform = applyHeaderBulkStyle(columns, grid, {
      textBold: true,
      backgroundColor: '#ABCDEF',
    });
    expect(getCommonHeaderStyle(uniform.columns, uniform.headerGrid)).toEqual({
      textBold: true,
      backgroundColor: '#ABCDEF',
      isMixed: false,
      styledCount: 5,
    });

    expect(getCommonHeaderStyle(
      [{ ...columns[0]!, textBold: true }, columns[1]!],
      undefined,
    )).toEqual({
      textBold: false,
      backgroundColor: '',
      isMixed: true,
      styledCount: 1,
    });
  });
});

function col(overrides: Partial<TableColumn> = {}): TableColumn {
  return { id: 'c', label: '열', ...overrides };
}

function hcell(overrides: Partial<HeaderCell> = {}): HeaderCell {
  return { id: 'h', label: '헤더', colspan: 1, rowspan: 1, ...overrides };
}

describe('withHeaderStyle', () => {
  it('빈 스타일이면 두 필드를 객체에서 제거한다', () => {
    const styled = col({ id: 'c1', backgroundColor: '#AABBCC', textBold: true });

    expect(withHeaderStyle(styled, false, undefined)).toEqual({ id: 'c1', label: '열' });
  });

  it('원본을 변형하지 않는다', () => {
    const source = col({ id: 'c1' });

    withHeaderStyle(source, true, '#112233');

    expect(source).toEqual({ id: 'c1', label: '열' });
  });
});

describe('getCommonHeaderStyle 혼합 판정', () => {
  it('스타일이 하나도 없으면 styledCount 0, isMixed false', () => {
    expect(getCommonHeaderStyle([col(), col()], [[hcell(), hcell()]])).toEqual({
      textBold: false,
      backgroundColor: '',
      isMixed: false,
      styledCount: 0,
    });
  });

  it('일부만 배경색이 있으면 isMixed true', () => {
    expect(getCommonHeaderStyle([col({ backgroundColor: '#AABBCC' }), col()], undefined)).toEqual({
      textBold: false,
      backgroundColor: '',
      isMixed: true,
      styledCount: 1,
    });
  });

  it('textBold만 지정된 헤더도 styledCount 에 포함한다', () => {
    expect(getCommonHeaderStyle([col({ textBold: true })], undefined)).toEqual({
      textBold: true,
      backgroundColor: '',
      isMixed: false,
      styledCount: 1,
    });
  });

  it('headerGrid 가 undefined 면 열 헤더만 집계한다', () => {
    expect(getCommonHeaderStyle([col({ backgroundColor: '#AABBCC' })], undefined)).toEqual({
      textBold: false,
      backgroundColor: '#AABBCC',
      isMixed: false,
      styledCount: 1,
    });
  });

  it('헤더가 하나도 없으면 styledCount 0, isMixed false', () => {
    expect(getCommonHeaderStyle([], undefined)).toEqual({
      textBold: false,
      backgroundColor: '',
      isMixed: false,
      styledCount: 0,
    });
  });
});
