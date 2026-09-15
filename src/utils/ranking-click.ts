import type { RankingAnswer } from '@/types/survey';

/**
 * 순위형 "보기 클릭" 입력 모델의 순수 로직.
 *
 * 응답 모양(`{rank, optionValue}[]`)은 드롭다운 시절과 같다 — 저장·검증·내보내기는
 * 이 파일을 모른다. 바뀐 것은 순위를 **어떻게 매기느냐**뿐이다:
 * - 보기를 누르면 비어 있는 가장 낮은 순위에 들어간다
 * - 순위가 있는 보기를 다시 누르면 빠지고, 뒤 순위가 한 칸씩 당겨진다
 * - 순위가 다 찼으면 아무것도 바꾸지 않는다(호출부가 안내 문구를 띄운다)
 */

/** 보기가 현재 몇 순위인지. 없으면 undefined. */
export function rankOfOption(answers: RankingAnswer[], optionValue: string): number | undefined {
  return answers.find((a) => a.optionValue === optionValue)?.rank;
}

/** 1..positions 중 비어 있는 가장 낮은 순위. 다 찼으면 undefined. */
export function lowestEmptyRank(answers: RankingAnswer[], positions: number): number | undefined {
  const taken = new Set(answers.map((a) => a.rank));
  for (let rank = 1; rank <= positions; rank += 1) {
    if (!taken.has(rank)) return rank;
  }
  return undefined;
}

/** rank 오름차순으로 1..n 을 다시 매긴다 — 빠진 자리를 뒤 순위가 당겨 채운다. */
function compactRanks(answers: RankingAnswer[]): RankingAnswer[] {
  return [...answers]
    .sort((a, b) => a.rank - b.rank)
    .map((a, idx) => ({ ...a, rank: idx + 1 }));
}

export interface ToggleRankingResult {
  next: RankingAnswer[];
  /** 순위가 다 차서 넣지 못했다. `next` 는 입력과 같다. */
  full: boolean;
}

/** 보기 클릭 한 번의 결과. */
export function toggleRankingOption(
  answers: RankingAnswer[],
  optionValue: string,
  positions: number,
): ToggleRankingResult {
  const existing = rankOfOption(answers, optionValue);
  if (existing !== undefined) {
    return {
      next: compactRanks(answers.filter((a) => a.optionValue !== optionValue)),
      full: false,
    };
  }
  const rank = lowestEmptyRank(answers, positions);
  if (rank === undefined) return { next: answers, full: true };
  return {
    next: [...answers, { rank, optionValue }].sort((a, b) => a.rank - b.rank),
    full: false,
  };
}
