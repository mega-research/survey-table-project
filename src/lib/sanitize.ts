import sanitizeHtml from 'sanitize-html';

// jsdom 의존을 끌어오는 isomorphic-dompurify 대신 sanitize-html 사용.
// 서버(Lambda) 런타임에서 ESM 모듈 require 충돌이 발생하던 문제 회피.
// 허용 정책은 기존 DOMPurify 설정과 1:1 매핑 — 보안 수준 동일.

// ─────────────────────────────────────────────────────────────────────
// Inline style 주입
//
// 메일 클라이언트(Gmail/Outlook) 및 미리보기 iframe 은 외부 CSS (globals.css,
// tailwind utility class) 를 받지 못한다. table 테두리·첨부 박스 시각이
// 컨텍스트별로 일관되게 보이도록 sanitize 단에서 inline style 을 직접 박는다.
// 응답 페이지에서는 className prose 룰과 cascade 가 겹치지만 inline > class
// 우선순위로 동일한 모양이 유지된다.
// ─────────────────────────────────────────────────────────────────────

// Lucide Paperclip SVG (회색 stroke). globals.css 의 a.notice-file-attachment 원본과 동일.
const PAPERCLIP_SVG_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.83l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48'/></svg>\")";

const TABLE_STYLE = 'border-collapse:collapse;border:1px solid #d1d5db;';
const CELL_STYLE = 'border:1px solid #d1d5db;padding:8px 12px;';
const TH_STYLE = `${CELL_STYLE}background-color:#f9fafb;`;
// inline-flex 는 Outlook 미지원 → inline-block 으로 fallback (modern 클라이언트도 정상 표시)
const FILE_LINK_STYLE = [
  'display:inline-block',
  'padding:10px 14px 10px 38px',
  `background:#f3f4f6 ${PAPERCLIP_SVG_URL} no-repeat 10px center`,
  'background-size:18px 18px',
  'border:1px solid #e5e7eb',
  'border-radius:8px',
  'color:#374151',
  'text-decoration:none',
  'font-size:14px',
  'line-height:1.3',
].join(';');
const FILE_TEXT_STYLE = 'display:inline-block;vertical-align:middle;';
const FILE_LABEL_STYLE = 'display:block;color:#1f2937;font-weight:500;font-size:14px;';
const FILE_META_STYLE = 'display:block;color:#6b7280;font-size:12px;margin-top:2px;';

// 주입 스타일은 "기본값" 역할 — 사용자가 에디터에서 지정한 인라인 스타일
// (셀 테두리 색·배경색 등)이 이겨야 하므로 injected 를 앞에, existing 을 뒤에 둔다.
// (CSS 는 같은 속성이 중복되면 나중 선언이 우선)
function mergeStyle(existing: string | undefined, injected: string): string {
  if (!existing) return injected;
  const trimmed = existing.trim();
  const injectedSep = injected.trim().endsWith(';') ? '' : ';';
  return `${injected}${injectedSep}${trimmed}`;
}

function withStyle(
  tagName: string,
  attribs: sanitizeHtml.Attributes,
  injected: string,
): sanitizeHtml.Tag {
  return {
    tagName,
    attribs: {
      ...attribs,
      style: mergeStyle(attribs['style'], injected),
    },
  };
}

// 테두리 값 패턴 — 색상은 hex 외에 CSSOM 정규화 산물인 rgb()/rgba() 허용.
// url()/expression() 등 function 토큰은 rgb 계열 외 매칭 실패로 차단된다.
const BORDER_LINE_RE =
  /^\d+(?:\.\d+)?px\s+(solid|dashed|dotted)\s+(#(?:[0-9a-f]{3}|[0-9a-f]{6})|rgba?\([\d.,\s%]+\))$/i;
// "none" 및 CSSOM 정규화 변형 ("medium none currentcolor" 등)
const BORDER_NONE_RE =
  /^(?:(?:medium|thin|thick|\d+(?:\.\d+)?px)\s+)?(?:none|hidden)(?:\s+currentcolor)?$/i;

const RICH_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'span', 'div',
    'strong', 'em', 'u', 's', 'mark',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'code', 'pre',
    'a', 'img', 'map', 'area',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    '*': ['class', 'style'],
    a: [
      'href', 'target', 'rel', 'download',
      // notice 파일 첨부 노드 marker (a[data-file-attachment])
      'data-file-attachment', 'data-key', 'data-filename', 'data-size', 'data-mime',
    ],
    img: ['src', 'alt', 'width', 'height', 'usemap'],
    // 이미지 클릭 영역 (메일 이미지맵) — href 는 allowedSchemes(http/https)가 그대로 적용
    map: ['name'],
    area: ['shape', 'coords', 'href', 'target', 'rel', 'alt'],
    td: ['colspan', 'rowspan', 'colwidth'],
    th: ['colspan', 'rowspan', 'colwidth'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  // CSS 인젝션(WS-1 #14) 차단: style 값을 파싱해 화이트리스트 속성만 통과시킨다.
  // sanitize-html 의 CSS 파서(node 전용)가 속성명을 소문자화·정규화하므로
  // 대소문자/여분 공백/주석 우회는 파서 단에서 흡수되고, 화이트리스트에 없는
  // position/behavior/-moz-binding 등 위험 속성은 매칭 실패로 제거된다.
  // 각 속성 값은 정규식으로 제한해 url(/expression(/!important 같은 우회 토큰을 차단.
  parseStyleAttributes: true,
  allowedStyles: {
    '*': {
      // 텍스트 정렬 (TipTap TextAlign)
      'text-align': [/^(left|right|center|justify|start|end)$/i],
      // 색상 (TipTap Color/Highlight) — hex / rgb / rgba / 색상 키워드. url()·function 차단.
      color: [/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, /^rgba?\([\d.,\s%]+\)$/i, /^[a-z]+$/i],
      'background-color': [
        /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i,
        /^rgba?\([\d.,\s%]+\)$/i,
        /^[a-z]+$/i,
      ],
      // 폰트 — 키워드/숫자 단위만. expression() 등 function 차단.
      'font-size': [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i, /^(small|medium|large|smaller|larger)$/i],
      'font-weight': [/^(normal|bold|bolder|lighter|\d{3})$/i],
      'font-style': [/^(normal|italic|oblique)$/i],
      'text-decoration': [/^(none|underline|overline|line-through)(?:\s+(none|underline|overline|line-through))*$/i],
      'font-family': [/^[a-z0-9\s,'"_-]+$/i],
      'line-height': [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)?$/i],
      // 박스 모델 — 숫자 단위만 (음수 허용). url()/function 차단.
      padding: [/^-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?(?:\s+-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?){0,3}$/i],
      'padding-top': [/^-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?$/i],
      'padding-right': [/^-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?$/i],
      'padding-bottom': [/^-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?$/i],
      'padding-left': [/^-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?$/i],
      // margin 단축속성: 각 토큰은 길이 또는 auto (TipTap 표 정렬 "0 auto" 등). 1~4개.
      margin: [/^(?:-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?|auto)(?:\s+(?:-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?|auto)){0,3}$/i],
      'margin-top': [/^-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?$/i, /^auto$/i],
      'margin-right': [/^-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?$/i, /^auto$/i],
      'margin-bottom': [/^-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?$/i, /^auto$/i],
      'margin-left': [/^-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)?$/i, /^auto$/i],
      // 박스 사이징 (TipTap image wrapper)
      'box-sizing': [/^(border-box|content-box)$/i],
      // 크기 (TipTap image wrapperStyle width/height + max-width 안전망)
      width: [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i, /^auto$/i],
      height: [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i, /^auto$/i],
      'max-width': [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i, /^(none|auto)$/i],
      'max-height': [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i, /^(none|auto)$/i],
      'min-width': [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i, /^auto$/i],
      'min-height': [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i, /^auto$/i],
      // 이미지 정렬 (TipTap image float)
      float: [/^(left|right|none)$/i],
      // 표시 모드 (transformTags 가 주입하는 메일 첨부 박스 inline-block 등)
      display: [/^(inline|block|inline-block|none)$/i],
      'vertical-align': [/^(baseline|top|middle|bottom|sub|super|text-top|text-bottom)$/i],
      // 테두리 (transformTags 가 주입하는 표/첨부 박스 border + 에디터 셀 테두리 커스텀)
      // 주의: 브라우저 CSSOM 이 에디터 직렬화 시 hex → rgb(), 변별 longhand →
      // border-width/style/color 다중값 shorthand 로 정규화하므로 그 형태도 허용해야 한다.
      border: [BORDER_LINE_RE, BORDER_NONE_RE],
      'border-top': [BORDER_LINE_RE, BORDER_NONE_RE],
      'border-bottom': [BORDER_LINE_RE, BORDER_NONE_RE],
      'border-left': [BORDER_LINE_RE, BORDER_NONE_RE],
      'border-right': [BORDER_LINE_RE, BORDER_NONE_RE],
      'border-width': [/^(?:(?:\d+(?:\.\d+)?px|thin|medium|thick)\s*){1,4}$/i],
      'border-style': [/^(?:(?:none|hidden|solid|dashed|dotted)\s*){1,4}$/i],
      'border-color': [
        /^(?:(?:#(?:[0-9a-f]{3}|[0-9a-f]{6})|rgba?\([\d.,\s%]+\)|currentcolor)\s*){1,4}$/i,
      ],
      'border-collapse': [/^(collapse|separate)$/i],
      'border-radius': [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i],
      // 배경 (transformTags 가 주입하는 첨부 박스 paperclip 아이콘) — data:image/svg+xml 만 허용.
      // http/https/javascript 등 외부·스크립트 url 은 매칭 실패로 차단.
      background: [
        /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i,
        /^#(?:[0-9a-f]{3}|[0-9a-f]{6})\s+url\(["']?data:image\/svg\+xml[^)]*["']?\)\s+no-repeat\s+[\w\s]+$/i,
      ],
      'background-size': [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)(?:\s+\d+(?:\.\d+)?(?:px|pt|em|rem|%))?$/i, /^(auto|cover|contain)$/i],
    },
  },
  transformTags: {
    // mail-link-bands: 이미지 클릭 영역 밴드 테이블 — 표 테두리/패딩 주입 시
    // 밴드 조각 사이에 선이 생기므로 면제 (expandImageLinkAreas 가 생성)
    table: (tagName, attribs) =>
      (attribs['class'] ?? '').includes('mail-link-bands')
        ? { tagName, attribs }
        : withStyle(tagName, attribs, TABLE_STYLE),
    td: (tagName, attribs) =>
      (attribs['class'] ?? '').includes('mail-link-bands')
        ? { tagName, attribs }
        : withStyle(tagName, attribs, CELL_STYLE),
    th: (tagName, attribs) => withStyle(tagName, attribs, TH_STYLE),
    a: (tagName, attribs) => {
      if (attribs['data-file-attachment'] === 'true') {
        return withStyle(tagName, attribs, FILE_LINK_STYLE);
      }
      return { tagName, attribs };
    },
    span: (tagName, attribs) => {
      const cls = attribs['class'] ?? '';
      if (cls.includes('notice-file-attachment-text')) {
        return withStyle(tagName, attribs, FILE_TEXT_STYLE);
      }
      if (cls.includes('notice-file-attachment-label')) {
        return withStyle(tagName, attribs, FILE_LABEL_STYLE);
      }
      if (cls.includes('notice-file-attachment-meta')) {
        return withStyle(tagName, attribs, FILE_META_STYLE);
      }
      return { tagName, attribs };
    },
  },
};

// TipTap 이 Enter 로 만든 빈 paragraph 는 `<p></p>` 로 직렬화되는데, inline content 가
// 없어 브라우저·메일 클라이언트 모두 height 0 으로 collapse 한다. 시각 줄간격을 보존하려고
// &nbsp; 한 글자를 채워 한 줄 높이를 강제. <br> 보다 Outlook/Gmail 호환이 안정적.
const EMPTY_P_RE = /<p([^>]*)>(\s*)<\/p>/g;

function fillEmptyParagraphs(html: string): string {
  return html.replace(EMPTY_P_RE, '<p$1>&nbsp;</p>');
}

export function sanitizeRichHtml(input: string | null | undefined): string {
  if (input == null) return '';
  return fillEmptyParagraphs(sanitizeHtml(input, RICH_CONFIG));
}
