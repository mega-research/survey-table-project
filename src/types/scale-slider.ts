/**
 * 슬라이더 방향 (CONTEXT.md 「척도 슬라이더」) — 값 목록의 SSOT.
 *
 * ── 배선과 규칙 ──
 * - **값이 있으면 켜진 것이고 그 값이 긍정 방향이다.** 없으면 꺼진 것이다. 켬과 방향을 한 필드에 담아
 *   「켜졌는데 방향이 없는」 상태가 생길 수 없다.
 * - `positive-right`: 오른쪽이 긍정(기본) · `positive-left`: 왼쪽이 긍정(1점이 「매우 만족」인 척도).
 *   방향은 색(부정 붉은색 · 중립 · 긍정 푸른색)만 정한다 — 눈금 순서·저장 값은 바꾸지 않는다.
 * - 켜는 설정은 둘이고 같은 어휘를 쓴다 — 보기 묶음(`ChoiceGroup.scaleSlider`, JSONB 라 마이그레이션 없음)과
 *   문항(`Question.scaleSlider`, 컬럼 `questions.scale_slider` 0173). 표마다 하나만 읽힌다.
 *   - 묶음 쪽 읽기·쓰기는 features/question-renderer/utils/choice-group-mobile-view 한 곳이다(단일 선택
 *     묶음만 — 순위·체크박스 묶음에 적힌 값은 꺼진 것으로 읽는다).
 *   - 문항 쪽은 보통 라디오 문항(radio-option-scale-slider 의 `projectRadioQuestionScaleSlider`)과 라디오·
 *     체크박스 묶음이 하나도 없는 라디오 보기 소스 표(scale-slider-table-layout 의
 *     `resolveChoiceTableQuestionSliderDirection`)만 읽는다. 서버는 유형과 무관하게 저장하므로 읽는 쪽이 거른다.
 * - 문항 쪽 값은 로드한 문항·발행 스냅샷에서 값이 있거나 키가 없다. 빌더 스토어에는 「끄기」로 null 이 온다
 *   (부분 수정은 undefined 를 「그대로 두기」로 읽는다) — 켜졌는지는 `isScaleSliderDirection` 으로 본다.
 * - 값을 늘리면 이 배열과 함께 문항 컬럼의 스키마 check() · 마이그레이션 CHECK 를 고친다
 *   (루트 AGENTS.md 주의사항 1 — 배열만 고치면 tsc 는 통과하는데 INSERT 가 깨진다). 셋의 대조는
 *   tests/repo/scale-slider-question-column.test.ts — 0173 을 고치지 말고 새 마이그레이션에서 제약을 갈아끼운다.
 * - 그릴지·배치·호스트·빌더 경고의 자리는 src/features/AGENTS.md 「보기 모양과 척도 슬라이더」.
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
