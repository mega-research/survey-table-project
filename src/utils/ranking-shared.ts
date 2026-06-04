import type { RankingAnswer } from '@/types/survey';

/** 순위형 응답에서 '기타(직접 입력)' 옵션을 나타내는 sentinel 값. */
export const RANKING_OTHER_VALUE = '__other__';

// ── 순위형 드롭다운 공통 스타일 ──
// RankingDropdownStack(응답) 과 question-preview(빌더 미리보기) 가 공유해
// 두 뷰의 select 생김새를 완전히 일치시킨다.

/** 가로(columns=0) 모드에서 rank 블록 1개 select 의 고정 폭(px). */
export const RANKING_HORIZONTAL_ITEM_WIDTH = 200;

/** select 공통 기본 클래스 (disabled/interactive 모두에 공통). */
// 네이티브 select 의 펼침 옵션 글자 크기는 select 자체 font-size 를 따른다.
// text-base(16px) 로 키워 옵션 목록 가독성을 높임.
export const RANKING_SELECT_BASE_CLS =
  'truncate rounded-md border border-gray-200 bg-white px-3 py-2.5 text-base';

/** 인터랙티브 select 의 focus ring 추가 클래스. disabled 에는 사용하지 않음. */
export const RANKING_SELECT_FOCUS_CLS =
  'focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none';

/** 값이 올바른 RankingAnswer shape 인지 판별. */
export function isRankingAnswer(v: unknown): v is RankingAnswer {
  if (!v || typeof v !== 'object') return false;
  const rec = v as Record<string, unknown>;
  return typeof rec['rank'] === 'number' && typeof rec['optionValue'] === 'string';
}

/** 임의 값(unknown) → RankingAnswer[] 로 안전하게 정규화. 배열이 아니거나 shape 불일치는 제거. */
export function parseRankingAnswers(value: unknown): RankingAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRankingAnswer);
}
