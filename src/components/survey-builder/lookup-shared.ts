/**
 * LUT 빌더 컴포넌트들이 공통으로 쓰는 타입과 상수.
 *
 * - LookupDraft: 보관함 LUT 편집 모달이 외부와 주고받는 부분 필드 모음.
 *   여러 컴포넌트에서 각자 Pick<SavedLookup, ...> 으로 재정의하던 것을 단일화.
 * - NONE_SENTINEL / CUSTOM_SENTINEL: shadcn Select 는 빈 문자열을 value 로 허용하지 않아
 *   "미선택" / "직접 입력" 같은 가상 옵션이 필요하다. 컴포넌트마다 다른 sentinel 을 쓰면
 *   리뷰 시 헷갈리므로 단일 상수로 통일.
 */

import type { SavedLookup, SurveyLookup } from '@/types/survey';

export type LookupDraft = Pick<
  SavedLookup,
  'name' | 'description' | 'category' | 'tags' | 'columns' | 'rows'
>;

export const NONE_SENTINEL = '__none__';
export const CUSTOM_SENTINEL = '__custom__';

/**
 * Zustand selector 안에서 `?? []` 하면 매 렌더마다 새 빈 배열을 반환해 useSyncExternalStore 가
 * snapshot 변경으로 오인 → 무한 루프 경고. 모듈 스코프 안정 참조로 fallback.
 */
export const EMPTY_LOOKUPS: SurveyLookup[] = [];
