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
  ],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

export function sanitizeRichHtml(input: string | null | undefined): string {
  if (input == null) return '';
  return DOMPurify.sanitize(input, RICH_CONFIG);
}
