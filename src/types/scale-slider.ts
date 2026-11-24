/**
 * 슬라이더 방향 (CONTEXT.md 「척도 슬라이더」) — 값 목록의 SSOT.
 *
 * ── 배선과 규칙 ──
 * - **값이 있으면 켜진 것이고 그 값이 긍정 방향이다.** 없으면 꺼진 것이다. 켬과 방향을 한 필드에 담아
 *   「켜졌는데 방향이 없는」 상태가 생길 수 없다.
 * - `positive-right`: 오른쪽이 긍정(기본) · `positive-left`: 왼쪽이 긍정(1점이 「매우 만족」인 척도).
 *   방향은 색(부정 붉은색 · 중립 · 긍정 푸른색)만 정한다 — 눈금 순서·저장 값은 바꾸지 않는다.
 * - 보기 묶음(`ChoiceGroup.scaleSlider`, JSONB 라 마이그레이션 없음)과 문항이 같은 어휘를 쓴다.
 *   묶음 쪽 읽기·쓰기는 features/question-renderer/utils/choice-group-mobile-view 한 곳이다.
 * - 값을 늘리면 이 배열과 함께 문항 컬럼의 스키마 check() · 마이그레이션 CHECK 를 고친다
 *   (루트 AGENTS.md 주의사항 1 — 배열만 고치면 tsc 는 통과하는데 INSERT 가 깨진다).
 */
export const SCALE_SLIDER_DIRECTIONS = ['positive-right', 'positive-left'] as const;

export type ScaleSliderDirection = (typeof SCALE_SLIDER_DIRECTIONS)[number];

/** 방향을 따로 고르지 않고 켰을 때의 방향 */
export const DEFAULT_SCALE_SLIDER_DIRECTION: ScaleSliderDirection = 'positive-right';

export function isScaleSliderDirection(value: unknown): value is ScaleSliderDirection {
  return (
    typeof value === 'string' && (SCALE_SLIDER_DIRECTIONS as readonly string[]).includes(value)
  );
}
