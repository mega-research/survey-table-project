import { substituteTokens } from '@/lib/survey/substitute-tokens';
import type { Question } from '@/types/survey';

/**
 * 문항 제목 서식본(Question.titleHtml)의 순수 규칙.
 *
 * 정본은 평문 `title` 이다 — 내보내기·조건·쿼터·분석은 평문만 본다. 서식본은 글자 일부에
 * 굵게·밑줄·색·크기를 준 경우에만 곁에 두고, 응답 화면의 제목 표시만 이것을 우선한다.
 */

/** 제목 편집기가 고르는 글자 크기(px). 편집기 선택지와 sanitizeTitleHtml 허용값이 같아야 한다. */
export const TITLE_FONT_SIZES = [14, 16, 18, 20, 24, 28, 32] as const;

/** 응답 화면 제목의 기본 글자 크기(px) — text-lg. 편집기가 '기본' 으로 보여 준다. */
export const TITLE_DEFAULT_FONT_SIZE = 18;

/** 서식본에 실제 마크가 있는가. 없으면 서식본을 둘 이유가 없다. */
export function titleHtmlHasMarks(html: string): boolean {
  return /<(strong|b|u|span)\b/i.test(html);
}

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** 서식본의 글자만 — 문단·줄바꿈은 공백 하나. DOM 없이 서버·클라이언트 공용. */
export function titleHtmlToText(html: string): string {
  return html
    .replace(/<\/p>\s*<p[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITY_MAP[m] ?? m);
}

function normalizeSpaces(text: string): string {
  return text.replace(/[\s ]+/g, ' ').trim();
}

/**
 * 표시용 제목 서식본 — 쓸 수 있으면 토큰을 치환해 돌려주고, 아니면 undefined(평문을 그린다).
 *
 * 서식본의 글자가 평문 제목과 다르면 버린다. 제목 편집 모달이 아닌 경로(라이브러리·일괄 수정 등)가
 * 평문만 고치면 서식본은 옛 문구로 남는데, 그걸 그리면 응답자에게 바뀌기 전 제목이 보인다.
 * sanitize 는 호출부가 치환 뒤에 한다 — 치환값에 사용자 입력이 섞일 수 있다.
 */
export function resolveQuestionTitleHtml(
  question: Pick<Question, 'title' | 'titleHtml'>,
  attrs: Record<string, string>,
  quotes: Record<string, string>,
): string | undefined {
  const html = question.titleHtml;
  if (!html || !titleHtmlHasMarks(html)) return undefined;
  if (normalizeSpaces(titleHtmlToText(html)) !== normalizeSpaces(question.title ?? '')) {
    return undefined;
  }
  return substituteTokens(html, attrs, quotes);
}
