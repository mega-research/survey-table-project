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

function mergeStyle(existing: string | undefined, injected: string): string {
  if (!existing) return injected;
  const trimmed = existing.trim();
  const sep = trimmed.endsWith(';') ? '' : ';';
  return `${trimmed}${sep}${injected}`;
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
      style: mergeStyle(attribs.style, injected),
    },
  };
}

const RICH_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'span', 'div',
    'strong', 'em', 'u', 's', 'mark',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'code', 'pre',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    '*': ['class', 'style'],
    a: [
      'href', 'target', 'rel', 'download',
      // notice 파일 첨부 노드 marker (a[data-file-attachment])
      'data-file-attachment', 'data-key', 'data-filename', 'data-size', 'data-mime',
    ],
    img: ['src', 'alt', 'width', 'height'],
    td: ['colspan', 'rowspan', 'colwidth'],
    th: ['colspan', 'rowspan', 'colwidth'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  // TipTap inline style (text-align, image wrapperStyle 의 width/height/float 등) 을 raw 보존.
  // DOMPurify 기본 동작과 동등 — style 값을 파싱·필터링하지 않고 그대로 통과.
  parseStyleAttributes: false,
  transformTags: {
    table: (tagName, attribs) => withStyle(tagName, attribs, TABLE_STYLE),
    td: (tagName, attribs) => withStyle(tagName, attribs, CELL_STYLE),
    th: (tagName, attribs) => withStyle(tagName, attribs, TH_STYLE),
    a: (tagName, attribs) => {
      if (attribs['data-file-attachment'] === 'true') {
        return withStyle(tagName, attribs, FILE_LINK_STYLE);
      }
      return { tagName, attribs };
    },
    span: (tagName, attribs) => {
      const cls = attribs.class ?? '';
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
