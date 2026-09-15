/**
 * 표 셀 본문 서식본(TableCell.contentHtml) 의 순수 변환.
 *
 * 셀 본문의 정본은 여전히 평문 `content` 다. 서식본은 글자 일부에 색·굵게를 준 경우에만
 * 곁에 두고, 화면 표시만 그것을 우선한다. 여기 함수들은 그 둘 사이를 오가는 규칙이다:
 * - 문단 하나 = 평문의 한 줄. 편집기의 Enter 는 새 문단, Shift+Enter 는 `<br>` 이고 둘 다 `\n` 이다.
 * - 마크는 굵게(`<strong>`)·글자색(`<span style="color:#rrggbb">`)뿐.
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

/** 평문을 편집기가 읽는 문단 HTML 로. 빈 줄은 빈 문단. 빈 문자열은 빈 문자열. */
export function plainTextToCellHtml(text: string): string {
  if (text === '') return '';
  return text
    .split('\n')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

/** 서식본에 실제 마크(굵게·글자색)가 있는가. 없으면 서식본을 둘 이유가 없다. */
export function cellHtmlHasMarks(html: string): boolean {
  return /<(strong|b|span)\b/i.test(html);
}
