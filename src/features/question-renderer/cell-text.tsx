import { sanitizeCellHtml } from '@/lib/sanitize';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { TableCell } from '@/types/survey';

/**
 * 표 셀 텍스트 본문 — 「첫 줄만 굵게」와 서식본(contentHtml) 표시를 한 곳에서 처리한다.
 *
 * 셀 텍스트를 그리는 자리가 여럿이다(데스크탑 텍스트 셀 · 인터랙티브 셀의 라벨 · 모바일
 * 카드 · 보기/순위 옵션 셀 · 빌더 격자). 각자 판정하면 같은 셀이 화면마다 다르게 나온다.
 *
 * 자르는 기준은 **첫 줄바꿈**이다. 조사표의 이 칸은 거의 언제나 "제목 한 줄 + 설명
 * 여러 줄" 모양이라, 문장 단위로 자르려 들면(마침표·길이) 제목에 마침표가 없거나 설명이
 * 한 줄인 경우에 어긋난다. 줄바꿈은 담당자가 직접 넣은 것이라 의도가 분명하다.
 *
 * 나머지 줄의 `\n` 은 그대로 남긴다 — 호출부가 `whitespace-pre-wrap` 으로 그리므로
 * 줄바꿈을 여기서 소비하면 설명이 한 줄로 붙는다.
 *
 * `html` 이 오면(글자 일부에 색·굵게를 준 셀) 평문 대신 그것을 그린다. 문단이 곧 줄이라
 * 첫 줄 굵게는 첫 문단에 건다. 토큰 치환은 호출부가 `resolveCellTextHtml` 로 끝내 오고,
 * sanitize 는 여기서 한다 — 치환값에 사용자 입력이 섞일 수 있어 치환 뒤에 걸어야 한다.
 */
export function CellText({
  text,
  html,
  boldFirstLine,
}: {
  text: string;
  html?: string | undefined;
  boldFirstLine?: boolean | undefined;
}) {
  if (html) {
    return (
      <span
        className={cn('cell-rich-text', boldFirstLine && 'cell-rich-text-bold-first')}
        dangerouslySetInnerHTML={{ __html: sanitizeCellHtml(html) }}
      />
    );
  }
  if (!boldFirstLine) return <>{text}</>;
  const breakAt = text.indexOf('\n');
  // 줄바꿈이 없으면 셀 전체가 제목이다 — 통째로 굵게 그린다.
  if (breakAt === -1) return <span className="font-bold">{text}</span>;
  return (
    <>
      <span className="font-bold">{text.slice(0, breakAt)}</span>
      {text.slice(breakAt)}
    </>
  );
}

/**
 * 셀의 서식본을 표시용으로 — 있으면 토큰을 치환해 돌려주고, 없으면 undefined.
 * `CellText` 의 `html` 에 그대로 넣는다. 평문 `text` 쪽 치환과 같은 attrs·quotes 를 쓴다.
 */
export function resolveCellTextHtml(
  cell: Pick<TableCell, 'contentHtml'>,
  attrs: Record<string, string>,
  quotes: Record<string, string>,
): string | undefined {
  return cell.contentHtml ? substituteTokens(cell.contentHtml, attrs, quotes) : undefined;
}
