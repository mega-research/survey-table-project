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

export type CellBorderMode = 'all' | 'horizontal' | 'none';

/** [top, right, bottom, left] — null 항목은 기본(두께·모드) 규칙으로 폴백 */
export type CellBorderSideWidths = (number | null)[];

/** [top, right, bottom, left] — null 항목은 기본 borderColor 로 폴백 */
export type CellBorderSideColors = (string | null)[];

/**
 * 셀 테두리 attrs (색·두께·모드·변별 두께)를 inline style 로 직렬화.
 * 커스텀이 전혀 없으면 style 미출력 — 클래스/주입 기본 테두리가 적용된다.
 * 변별 두께(borderSideWidths)가 있으면 그 변은 모드보다 우선한다 — 표 외곽선을
 * 가장자리 셀의 바깥 변에만 두껍게 적용하는 용도. 0 은 none (선 숨김) 이며
 * border-collapse 에서 none 은 항상 지므로 이웃/표 테두리가 대신 그려질 수 있다.
 */
export function cellBorderStyleAttr(attrs: {
  borderColor?: string | null;
  borderWidth?: number | null;
  borderMode?: CellBorderMode | null;
  borderSideWidths?: CellBorderSideWidths | null;
  borderSideColors?: CellBorderSideColors | null;
}): { style?: string } {
  const mode = attrs.borderMode ?? 'all';
  const sidesW = attrs.borderSideWidths ?? null;
  const sidesC = attrs.borderSideColors ?? null;
  const hasCustom =
    !!attrs.borderColor ||
    !!attrs.borderWidth ||
    mode !== 'all' ||
    (sidesW !== null && sidesW.some((v) => v != null)) ||
    (sidesC !== null && sidesC.some((v) => v != null));
  if (!hasCustom) return {};
  const base = attrs.borderWidth && attrs.borderWidth > 0 ? attrs.borderWidth : 1;
  const color = attrs.borderColor ?? '#d1d5db';
  // 변 index: 0=top, 1=right, 2=bottom, 3=left. horizontal 모드는 세로변(1,3)만 0.
  const modeWidth = (i: number) =>
    mode === 'none' ? 0 : mode === 'horizontal' && i % 2 === 1 ? 0 : base;
  const css = ['top', 'right', 'bottom', 'left']
    .map((name, i) => {
      const w = sidesW?.[i] ?? modeWidth(i);
      if (w <= 0) return `border-${name}: none`;
      return `border-${name}: ${w}px solid ${sidesC?.[i] ?? color}`;
    })
    .join('; ');
  return { style: css };
}

function parseSideWidth(el: HTMLElement, side: 'Top' | 'Right' | 'Bottom' | 'Left'): number | null {
  const styleDecl = el.style as unknown as Record<string, string>;
  const sideStyle = styleDecl[`border${side}Style`];
  if (sideStyle === 'none' || sideStyle === 'hidden') return 0;
  const w = parseInt(styleDecl[`border${side}Width`] ?? '', 10);
  return Number.isFinite(w) && w >= 0 ? w : null;
}

export function parseCellBorderSideWidths(el: HTMLElement): CellBorderSideWidths | null {
  const arr = [
    parseSideWidth(el, 'Top'),
    parseSideWidth(el, 'Right'),
    parseSideWidth(el, 'Bottom'),
    parseSideWidth(el, 'Left'),
  ];
  if (arr.every((v) => v == null)) return null;
  // 네 변이 모두 같으면 균일 테두리 — borderWidth(base)가 담당하므로 변별 고정 금지.
  // 여기서 배열을 남기면 이후 내부선 두께 변경이 고정값에 가려 무시된다.
  if (arr[0] != null && arr.every((v) => v === arr[0])) return null;
  return arr;
}

export function parseCellBorderSideColors(el: HTMLElement): CellBorderSideColors | null {
  const styleDecl = el.style as unknown as Record<string, string>;
  const arr = (['Top', 'Right', 'Bottom', 'Left'] as const).map((side) =>
    normalizeHexColor(styleDecl[`border${side}Color`]),
  );
  if (arr.every((v) => v == null)) return null;
  // 균일 색은 borderColor(base)가 담당 — 변별 고정 금지 (두께와 동일한 이유)
  if (arr[0] != null && arr.every((v) => v === arr[0])) return null;
  return arr;
}

export function parseCellBorderWidth(el: HTMLElement): number | null {
  const raw = el.style.borderTopWidth || el.style.borderWidth;
  const w = parseInt(raw, 10);
  return Number.isFinite(w) && w > 0 ? w : null;
}

export function parseCellBorderMode(el: HTMLElement): CellBorderMode {
  const top = el.style.borderTopStyle || el.style.borderStyle;
  const left = el.style.borderLeftStyle || el.style.borderStyle;
  if (top === 'none' && left === 'none') return 'none';
  if (left === 'none') return 'horizontal';
  return 'all';
}

/**
 * CSS 색상 값을 #rrggbb hex 로 정규화. 브라우저 CSSOM 은 authored hex 를
 * rgb(...) 로 재직렬화하므로 왕복 파싱 시 양쪽 모두 처리해야 한다.
 * sanitize.ts 의 border 화이트리스트가 hex 만 허용하므로 hex 로 통일.
 */
export function normalizeHexColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  const hex6 = v.match(/^#([0-9a-f]{6})$/);
  if (hex6) return `#${hex6[1]}`;
  const hex3 = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (hex3) return `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`;
  const rgb = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (rgb) {
    const to2 = (n: string) => Math.min(255, parseInt(n, 10)).toString(16).padStart(2, '0');
    return `#${to2(rgb[1]!)}${to2(rgb[2]!)}${to2(rgb[3]!)}`;
  }
  return null;
}
