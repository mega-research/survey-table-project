import { describe, it, expect } from 'vitest';

import {
  parseTableAlign,
  tableAlignStyle,
  parseCellBorderMode,
  parseVerticalAlign,
  verticalAlignStyle,
} from '@/components/ui/rich-text-editor/table-attrs-helpers';

function mockElement(style: Partial<CSSStyleDeclaration>): HTMLElement {
  const el = document.createElement('div');
  Object.assign(el.style, style);
  return el;
}

describe('parseTableAlign', () => {
  it('marginLeft auto + marginRight auto → center', () => {
    const el = mockElement({ marginLeft: 'auto', marginRight: 'auto' });
    expect(parseTableAlign(el)).toBe('center');
  });

  it('marginLeft auto + marginRight 0 → right', () => {
    const el = mockElement({ marginLeft: 'auto', marginRight: '0px' });
    expect(parseTableAlign(el)).toBe('right');
  });

  it('marginLeft 0 + marginRight auto → left (기본)', () => {
    const el = mockElement({ marginLeft: '0px', marginRight: 'auto' });
    expect(parseTableAlign(el)).toBe('left');
  });

  it('스타일 없음 → left', () => {
    const el = mockElement({});
    expect(parseTableAlign(el)).toBe('left');
  });
});

describe('tableAlignStyle', () => {
  it('left → 우측 auto only', () => {
    expect(tableAlignStyle('left')).toBe('margin: 0 auto 0 0');
  });
  it('center → both auto', () => {
    expect(tableAlignStyle('center')).toBe('margin: 0 auto');
  });
  it('right → 좌측 auto only', () => {
    expect(tableAlignStyle('right')).toBe('margin: 0 0 0 auto');
  });
});

describe('parseVerticalAlign', () => {
  it('verticalAlign 명시 → 그 값', () => {
    expect(parseVerticalAlign(mockElement({ verticalAlign: 'middle' }))).toBe('middle');
    expect(parseVerticalAlign(mockElement({ verticalAlign: 'bottom' }))).toBe('bottom');
  });
  it('verticalAlign top 명시 → top', () => {
    expect(parseVerticalAlign(mockElement({ verticalAlign: 'top' }))).toBe('top');
  });
  it('verticalAlign 없음 → top', () => {
    expect(parseVerticalAlign(mockElement({}))).toBe('top');
  });
});

describe('verticalAlignStyle', () => {
  it.each(['top', 'middle', 'bottom'] as const)('%s → 명시', (v) => {
    expect(verticalAlignStyle(v)).toBe(`vertical-align: ${v}`);
  });
});

describe('parseCellBorderMode', () => {
  it('4변 모두 solid → all', () => {
    const el = mockElement({ borderStyle: 'solid' });
    expect(parseCellBorderMode(el)).toBe('all');
  });

  it('좌변만 none (변별 숨김) → horizontal 아닌 all — 재표시 폴백이 mode 에 가려지면 안 됨', () => {
    const el = mockElement({
      borderTopStyle: 'solid',
      borderRightStyle: 'solid',
      borderBottomStyle: 'solid',
      borderLeftStyle: 'none',
    });
    expect(parseCellBorderMode(el)).toBe('all');
  });

  it('좌+우 모두 none, 상하 solid → horizontal', () => {
    const el = mockElement({
      borderTopStyle: 'solid',
      borderRightStyle: 'none',
      borderBottomStyle: 'solid',
      borderLeftStyle: 'none',
    });
    expect(parseCellBorderMode(el)).toBe('horizontal');
  });

  it('상+좌 none 이지만 우+하 solid → none 아닌 all', () => {
    const el = mockElement({
      borderTopStyle: 'none',
      borderRightStyle: 'solid',
      borderBottomStyle: 'solid',
      borderLeftStyle: 'none',
    });
    expect(parseCellBorderMode(el)).toBe('all');
  });

  it('4변 모두 none → none', () => {
    const el = mockElement({ borderStyle: 'none' });
    expect(parseCellBorderMode(el)).toBe('none');
  });
});
