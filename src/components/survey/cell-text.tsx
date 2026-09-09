/**
 * 표 셀 텍스트 본문 — 「첫 줄만 굵게」를 한 곳에서 처리한다.
 *
 * 셀 텍스트를 그리는 자리가 셋이다(데스크탑 텍스트 셀 · 인터랙티브 셀의 라벨 · 모바일
 * 카드). 각자 판정하면 같은 셀이 화면마다 다른 굵기로 나온다.
 *
 * 자르는 기준은 **첫 줄바꿈**이다. 조사표의 이 칸은 거의 언제나 "제목 한 줄 + 설명
 * 여러 줄" 모양이라, 문장 단위로 자르려 들면(마침표·길이) 제목에 마침표가 없거나 설명이
 * 한 줄인 경우에 어긋난다. 줄바꿈은 담당자가 직접 넣은 것이라 의도가 분명하다.
 *
 * 나머지 줄의 `\n` 은 그대로 남긴다 — 호출부가 `whitespace-pre-wrap` 으로 그리므로
 * 줄바꿈을 여기서 소비하면 설명이 한 줄로 붙는다.
 */
export function CellText({
  text,
  boldFirstLine,
}: {
  text: string;
  boldFirstLine?: boolean | undefined;
}) {
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
