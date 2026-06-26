import { describe, expect, it } from 'vitest';

import type { TableCell } from '@/types/survey';
import {
  findMobileHeaderCell,
  hasExplicitHiddenMobileHeaderCell,
  hasMobileDisplayCells,
  splitMobileDisplayCells,
} from '@/utils/mobile-display-cells';

function cell(partial: Partial<TableCell>): TableCell {
  return {
    id: Math.random().toString(36).slice(2),
    content: '',
    type: 'text',
    ...partial,
  } as TableCell;
}

describe('splitMobileDisplayCells', () => {
  it('inline / collapsed 로 분류하고 hidden·미지정은 제외', () => {
    const cells = [
      cell({ id: 'a', type: 'text', mobileDisplay: 'inline', content: '정의' }),
      cell({ id: 'b', type: 'text', mobileDisplay: 'collapsed', content: '예시' }),
      cell({ id: 'c', type: 'text', mobileDisplay: 'hidden', content: '숨김' }),
      cell({ id: 'd', type: 'text', content: '미지정' }),
    ];
    const { inline, collapsed } = splitMobileDisplayCells(cells);
    expect(inline.map((c) => c.id)).toEqual(['a']);
    expect(collapsed.map((c) => c.id)).toEqual(['b']);
  });

  it('입력 셀 타입은 mobileDisplay 와 무관하게 제외', () => {
    const cells = [
      cell({ id: 'r', type: 'radio', mobileDisplay: 'inline' }),
      cell({ id: 'i', type: 'input', mobileDisplay: 'collapsed' }),
      cell({ id: 'co', type: 'choice_opt', mobileDisplay: 'inline' }),
      cell({ id: 'rk', type: 'ranking', mobileDisplay: 'inline' }),
      cell({ id: 'ro', type: 'ranking_opt', mobileDisplay: 'collapsed' }),
    ];
    const { inline, collapsed } = splitMobileDisplayCells(cells);
    expect(inline).toEqual([]);
    expect(collapsed).toEqual([]);
  });

  it('isHidden·continuation 셀 제외', () => {
    const cells = [
      cell({ id: 'h', type: 'text', mobileDisplay: 'inline', isHidden: true }),
      cell({ id: 'k', type: 'text', mobileDisplay: 'inline', _isContinuation: true }),
    ];
    const { inline, collapsed } = splitMobileDisplayCells(cells);
    expect(inline).toEqual([]);
    expect(collapsed).toEqual([]);
  });

  it('image/video 도 표시 셀로 분류', () => {
    const cells = [
      cell({ id: 'img', type: 'image', mobileDisplay: 'inline', imageUrl: 'x' }),
      cell({ id: 'vid', type: 'video', mobileDisplay: 'collapsed', videoUrl: 'y' }),
    ];
    const { inline, collapsed } = splitMobileDisplayCells(cells);
    expect(inline.map((c) => c.id)).toEqual(['img']);
    expect(collapsed.map((c) => c.id)).toEqual(['vid']);
  });

  it('표시 가능한 셀이 있는지 확인', () => {
    expect(hasMobileDisplayCells([cell({ id: 'a', type: 'text' })])).toBe(false);
    expect(
      hasMobileDisplayCells([cell({ id: 'b', type: 'text', mobileDisplay: 'inline' })]),
    ).toBe(true);
  });

  it("'header' 셀은 inline/collapsed 어디에도 포함되지 않는다", () => {
    const { inline, collapsed } = splitMobileDisplayCells([
      cell({ id: 'h', type: 'text', mobileDisplay: 'header', content: '제목' }),
    ]);
    expect(inline).toEqual([]);
    expect(collapsed).toEqual([]);
    expect(hasMobileDisplayCells([cell({ type: 'text', mobileDisplay: 'header' })])).toBe(false);
  });
});

describe('findMobileHeaderCell', () => {
  it("mobileDisplay 'header' 인 첫 text 셀을 반환", () => {
    const found = findMobileHeaderCell([
      cell({ id: 'a', type: 'text', mobileDisplay: 'inline', content: '본문' }),
      cell({ id: 'h', type: 'text', mobileDisplay: 'header', content: '제목' }),
    ]);
    expect(found?.id).toBe('h');
  });

  it("'header' 지정 셀이 없으면 undefined", () => {
    expect(findMobileHeaderCell([cell({ type: 'text', mobileDisplay: 'inline' })])).toBeUndefined();
  });

  it('isHidden/continuation header 셀은 무시', () => {
    expect(
      findMobileHeaderCell([
        cell({ type: 'text', mobileDisplay: 'header', isHidden: true }),
        cell({ type: 'text', mobileDisplay: 'header', _isContinuation: true }),
      ]),
    ).toBeUndefined();
  });

  it('text 가 아닌 셀의 header 지정은 무시', () => {
    expect(
      findMobileHeaderCell([cell({ type: 'image', mobileDisplay: 'header', imageUrl: 'x' })]),
    ).toBeUndefined();
  });
});

describe('hasExplicitHiddenMobileHeaderCell', () => {
  it('명시 hidden text 셀이 있으면 true', () => {
    expect(
      hasExplicitHiddenMobileHeaderCell([
        cell({ type: 'text', mobileDisplay: 'hidden', content: '숨김 제목' }),
      ]),
    ).toBe(true);
  });

  it('미지정 text 셀과 hidden image 셀은 헤더 숨김 신호로 보지 않는다', () => {
    expect(
      hasExplicitHiddenMobileHeaderCell([
        cell({ type: 'text' }),
        cell({ type: 'image', mobileDisplay: 'hidden', imageUrl: 'x' }),
      ]),
    ).toBe(false);
  });
});
