import DOMPurify, { type Config } from 'isomorphic-dompurify';

const RICH_CONFIG: Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'span', 'div',
    'strong', 'em', 'u', 's', 'mark',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'code', 'pre',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: [
    'href', 'target', 'rel',
    'src', 'alt', 'width', 'height',
    'style',
    'class',
    'colspan', 'rowspan', 'colwidth',
  ],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
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
  return fillEmptyParagraphs(DOMPurify.sanitize(input, RICH_CONFIG));
}
