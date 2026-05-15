import { describe, it, expect } from 'vitest';

import {
  parseTableAlign,
  tableAlignStyle,
  parseVerticalAlign,
  verticalAlignStyle,
  parseCaptionAlign,
  captionAlignStyle,
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

describe('parseCaptionAlign', () => {
  it('textAlign 명시 → 그 값', () => {
    expect(parseCaptionAlign(mockElement({ textAlign: 'left' }))).toBe('left');
    expect(parseCaptionAlign(mockElement({ textAlign: 'right' }))).toBe('right');
  });
  it('textAlign center 명시 → center', () => {
    expect(parseCaptionAlign(mockElement({ textAlign: 'center' }))).toBe('center');
  });
  it('textAlign 없음 → center', () => {
    expect(parseCaptionAlign(mockElement({}))).toBe('center');
  });
});

describe('captionAlignStyle', () => {
  it.each(['left', 'center', 'right'] as const)('%s 정렬 + caption-side top', (v) => {
    expect(captionAlignStyle(v)).toBe(`text-align: ${v}; caption-side: top`);
  });
});
