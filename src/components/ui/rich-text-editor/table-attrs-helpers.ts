export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

export function parseTableAlign(el: HTMLElement): HAlign {
  const ml = el.style.marginLeft;
  const mr = el.style.marginRight;
  if (ml === 'auto' && mr === 'auto') return 'center';
  if (ml === 'auto') return 'right';
  return 'left';
}

export function tableAlignStyle(align: HAlign): string {
  switch (align) {
    case 'center': return 'margin: 0 auto';
    case 'right': return 'margin: 0 0 0 auto';
    case 'left':
    default: return 'margin: 0 auto 0 0';
  }
}

export function parseVerticalAlign(el: HTMLElement): VAlign {
  const v = el.style.verticalAlign;
  if (v === 'middle' || v === 'bottom') return v;
  return 'top';
}

export function verticalAlignStyle(v: VAlign): string {
  return `vertical-align: ${v}`;
}
