import {
  type SurveyListOwner,
  splitSurveyListSearchWords,
} from '@/shared/contracts/survey-builder-io';

/** 자동완성 「소유자」 칸의 최대 후보 수. */
export const OWNER_SUGGEST_LIMIT = 3;

function containsWord(name: string, word: string): boolean {
  return name.toLocaleLowerCase('ko').includes(word.toLocaleLowerCase('ko'));
}

/**
 * 자동완성 「소유자」 칸 (티켓 05) — 목록 페이지가 준 범위 안 소유자 목록에서 브라우저가 거른다
 * (서버 호출 없음). 검색 단어 하나라도 이름에 들어 있으면 맞는다 — 「은철 2026」처럼 소유자와
 * 제목 낱말을 섞어 쳐도 소유자가 뜬다. 받은 순서(이름순)를 지키고 3명까지.
 */
export function matchOwnerSuggestions(
  owners: readonly SurveyListOwner[],
  q: string,
): SurveyListOwner[] {
  const words = splitSurveyListSearchWords(q);
  if (words.length === 0) return [];
  return owners
    .filter((owner) => words.some((word) => containsWord(owner.name, word)))
    .slice(0, OWNER_SUGGEST_LIMIT);
}

/**
 * 후보를 고른 뒤 남길 검색어 — 그 후보 이름에 들어 있던 단어를 지우고 나머지를 한 칸씩 띄워
 * 남긴다(대소문자 무시). 소유자를 고르면 「은철 2026」이 소유자 조건 + 「2026」이 된다. 태그 후보
 * (티켓 10)의 「a사 실」 → [A사] + 「실」도 같은 규칙이다.
 */
export function dropWordsMatching(q: string, label: string): string {
  return splitSurveyListSearchWords(q)
    .filter((word) => !containsWord(label, word))
    .join(' ');
}
