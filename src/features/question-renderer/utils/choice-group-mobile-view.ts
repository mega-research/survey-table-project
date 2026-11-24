import {
  DEFAULT_SCALE_SLIDER_DIRECTION,
  type ScaleSliderDirection,
  isScaleSliderDirection,
} from '@/types/scale-slider';
import type { ChoiceGroup } from '@/types/survey';

/**
 * 보기 그룹 한 섹션을 그리는 모양 — 네 가지 중 하나다.
 *
 * - `tiles`: 세로 타일(기본)
 * - `original-line`: 원본 한 줄 — 그룹 열만 잘라 낸 원본 표 조각(choice-group-original-line)
 * - `scale-bar`: 척도 막대(choice-group-scale-bar). 그릴 수 없으면 원본 한 줄로 폴백한다
 * - `scale-slider`: 척도 슬라이더(타일 줄 + 트랙). radio 그룹 전용
 *
 * ── 배선과 규칙 ──
 * - 저장은 보기 그룹 JSONB 의 세 필드(`mobileOriginalLine`·`mobileScaleBar`·`scaleSlider`)이고 서로 배타다.
 *   읽기·쓰기를 이 파일 하나로 모아, 빌더가 한쪽만 켜고 응답 화면이 같은 규칙으로 읽는다.
 * - **읽기 우선순위는 슬라이더 → 척도 막대 → 원본 한 줄 → 세로 타일**이다. 둘 이상 켜진 어긋난 값도
 *   하나로 읽힌다(빌더는 둘을 같이 쓰지 않는다).
 * - 앞의 셋은 모바일 「행 단위 그룹 카드」·「행별 척도」에서만 읽는다. 슬라이더는 웹과 모바일 둘 다에
 *   적용하는 첫 모양이다 — 타입 이름의 `Mobile` 은 앞의 셋만 있던 때의 이름이다.
 * - 슬라이더의 필드는 켬과 방향을 함께 담는다(`@/types/scale-slider` — 값이 있으면 켜진 것). 어휘에 없는
 *   값과 순위·체크박스 그룹에 적힌 값은 꺼진 것으로 읽는다.
 * - **슬라이더를 아직 그릴 수 없는 호출부**는 이 값을 「못 그리는 묶음」과 같이 다룬다 — 원본 한 줄,
 *   그것도 안 되면 세로 타일(choice-group-section-view · row-scale-bars).
 */
export type ChoiceGroupMobileView = 'tiles' | 'original-line' | 'scale-bar' | 'scale-slider';

/** 슬라이더를 고를 수 있는 그룹인가 — 단일 선택(radio) 그룹만. 순위·체크박스 그룹은 될 수 없다 */
export function canChoiceGroupUseScaleSlider(group: ChoiceGroup | undefined): boolean {
  return group?.type === 'radio';
}

/** 슬라이더 그룹이면 그 긍정 방향, 아니면 null */
export function resolveChoiceGroupSliderDirection(
  group: ChoiceGroup | undefined,
): ScaleSliderDirection | null {
  if (!group || !canChoiceGroupUseScaleSlider(group)) return null;
  // JSONB 라 어휘 밖의 값이 들어 있을 수 있다 — 방향으로 읽히는 값만 켜진 것이다
  const direction: unknown = group.scaleSlider;
  return isScaleSliderDirection(direction) ? direction : null;
}

export function resolveChoiceGroupMobileView(
  group: ChoiceGroup | undefined,
): ChoiceGroupMobileView {
  if (!group || group.type === 'ranking') return 'tiles';
  if (resolveChoiceGroupSliderDirection(group) !== null) return 'scale-slider';
  // 둘 다 켜진 어긋난 값은 나중에 생긴 쪽(척도 막대)으로 읽는다 — 빌더는 둘을 같이 쓰지 않는다
  if (group.mobileScaleBar === true) return 'scale-bar';
  if (group.mobileOriginalLine === true) return 'original-line';
  return 'tiles';
}

/**
 * 모양을 바꾼 그룹 — 고른 쪽 필드만 남기고, 세로 타일이면 셋 다 지운다(켜 둔 적 없는 그룹과 같은 모양).
 * 그룹의 나머지 필드(필수·가운데 구간 이름 등)는 그대로 둔다.
 *
 * 슬라이더는 방향을 함께 적는다 — `sliderDirection` 을 주면 그 방향, 안 주면 이미 적혀 있던 방향(슬라이더를
 * 다시 고를 때), 그것도 없으면 기본(오른쪽이 긍정)이다. 다른 모양으로 가면 방향은 지워진다. 슬라이더를
 * 고를 수 없는 그룹(순위·체크박스)에 슬라이더를 쓰면 그룹을 그대로 돌려준다.
 */
export function withChoiceGroupMobileView(
  group: ChoiceGroup,
  view: ChoiceGroupMobileView,
  sliderDirection?: ScaleSliderDirection,
): ChoiceGroup {
  if (view === 'scale-slider' && !canChoiceGroupUseScaleSlider(group)) return group;
  const {
    mobileOriginalLine: _line,
    mobileScaleBar: _bar,
    scaleSlider: _slider,
    ...rest
  } = group;
  if (view === 'original-line') return { ...rest, mobileOriginalLine: true };
  if (view === 'scale-bar') return { ...rest, mobileScaleBar: true };
  if (view === 'scale-slider') {
    return {
      ...rest,
      scaleSlider:
        sliderDirection ??
        resolveChoiceGroupSliderDirection(group) ??
        DEFAULT_SCALE_SLIDER_DIRECTION,
    };
  }
  return rest;
}
