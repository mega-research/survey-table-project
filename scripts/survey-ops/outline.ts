/**
 * 그려진 화면(DOM)을 사람이 읽을 글자로 편다 — `pnpm survey:render` 가 쓴다.
 *
 * jsdom 은 CSS 를 계산하지 않는다. 그래서 보이는지는 표식으로만 판정한다:
 * `hidden` 속성 · `aria-hidden="true"` · 인라인 `display:none`/`visibility:hidden` · Tailwind `sr-only`,
 * 그리고 Tailwind 화면 폭 클래스(`hidden` / `md:hidden` / `md:block` 류)를 지정한 기기 폭으로 푼다.
 * 그 밖의 CSS 로 숨긴 요소는 보이는 것으로 나온다 — 출력 머리에 이 한계를 적는다.
 */

export interface OutlineOptions {
  /** 768px 미만으로 본다 — Tailwind `md:` 클래스를 풀 때 쓴다 */
  mobile: boolean;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'svg']);
const BLOCK_TAGS = new Set([
  'DIV',
  'P',
  'LI',
  'UL',
  'OL',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'MAIN',
  'NAV',
  'ASIDE',
  'FORM',
  'FIELDSET',
  'LEGEND',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'BR',
  'HR',
  'BLOCKQUOTE',
  'PRE',
  'DL',
  'DT',
  'DD',
  'FIGURE',
  'FIGCAPTION',
  // 보기 하나가 한 줄로 읽히도록 label 도 줄을 바꾼다
  'LABEL',
]);
const CELL_TAGS = new Set(['TD', 'TH']);

/** Tailwind 화면 폭 접두 — 이 도구는 데스크톱을 md(768) 이상 lg 미만이 아니라 「넓은 화면」으로 본다 */
const WIDE_PREFIXES = ['sm:', 'md:', 'lg:', 'xl:', '2xl:'];
const DISPLAY_VALUES = [
  'block',
  'flex',
  'grid',
  'inline',
  'inline-block',
  'inline-flex',
  'table',
  'table-row',
  'table-cell',
  'contents',
];

export function isTailwindHidden(className: string, mobile: boolean): boolean {
  const classes = className.split(/\s+/).filter(Boolean);
  if (classes.includes('sr-only')) return true;
  let hidden = classes.includes('hidden');
  if (mobile) {
    // 모바일 폭(<768)에서는 sm: 만 켜진다고 본다(640~767). 응답 화면의 분기는 md: 라 sm: 는 무시해도 결과가 같다.
    return hidden;
  }
  for (const prefix of WIDE_PREFIXES) {
    if (classes.includes(`${prefix}hidden`)) hidden = true;
    if (DISPLAY_VALUES.some((d) => classes.includes(`${prefix}${d}`))) hidden = false;
  }
  return hidden;
}

function isHidden(el: Element, options: OutlineOptions): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.hasAttribute('hidden')) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const style = (el as HTMLElement).style;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
  const className =
    typeof el.className === 'string' ? el.className : (el.getAttribute('class') ?? '');
  return isTailwindHidden(className, options.mobile);
}

function describeControl(el: Element): string | null {
  const locked =
    (el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly ? ' 잠김' : '';
  if (el.tagName === 'INPUT') {
    const input = el as HTMLInputElement;
    if (input.type === 'hidden') return null;
    if (input.type === 'checkbox') return `[${input.checked ? '✓' : ' '}]${locked}`;
    if (input.type === 'radio') return `(${input.checked ? '●' : ' '})${locked}`;
    return input.value ? `[입력 "${input.value}"${locked}]` : `[입력 비어 있음${locked}]`;
  }
  if (el.tagName === 'TEXTAREA') {
    const value = (el as HTMLTextAreaElement).value;
    return value ? `[입력 "${value}"${locked}]` : `[입력 비어 있음${locked}]`;
  }
  if (el.tagName === 'SELECT') {
    const select = el as HTMLSelectElement;
    const label = select.selectedOptions[0]?.textContent?.trim() ?? '';
    return `[선택 "${label}"${locked}]`;
  }
  // Radix 라디오·체크박스(button role)
  const role = el.getAttribute('role');
  if (role === 'radio' || role === 'checkbox' || role === 'switch') {
    const state =
      el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'checked';
    return role === 'radio' ? `(${state ? '●' : ' '})` : `[${state ? '✓' : ' '}]`;
  }
  return null;
}

/** 보이는 글자와 입력 상태를 줄 단위로 낸다. 표의 칸은 ` | ` 로 잇는다. */
export function outlinePage(root: Element, options: OutlineOptions): string {
  const lines: string[] = [];
  let current = '';
  const flush = () => {
    const line = current
      .replace(/\s+/g, ' ')
      .replace(/^\s*\|\s*/, '')
      .trim();
    if (line && line !== '|' && lines[lines.length - 1] !== line) lines.push(line);
    current = '';
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      current += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (isHidden(el, options)) return;
    const control = describeControl(el);
    if (control) {
      current += ` ${control} `;
      // Radix 컨트롤 안의 표시 점 등은 건너뛴다. 네이티브 select 의 option 글자도 다시 찍지 않는다.
      return;
    }
    const block = BLOCK_TAGS.has(el.tagName);
    const cell = CELL_TAGS.has(el.tagName);
    if (block) flush();
    if (cell) current += ' | ';
    for (const child of Array.from(el.childNodes)) walk(child);
    if (block) flush();
  };
  walk(root);
  flush();
  return lines.join('\n');
}
