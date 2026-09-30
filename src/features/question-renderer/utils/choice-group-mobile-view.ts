import type { ChoiceGroup } from '@/types/survey';

/**
 * 「행 단위 그룹 카드」에서 보기 그룹 한 섹션을 그리는 모양 — 세 가지 중 하나다.
 *
 * - `tiles`: 세로 타일(기본)
 * - `original-line`: 원본 한 줄 — 그룹 열만 잘라 낸 원본 표 조각(choice-group-original-line)
 * - `scale-bar`: 척도 막대(choice-group-scale-bar). 그릴 수 없으면 원본 한 줄로 폴백한다
 *
 * 저장은 보기 그룹 JSONB 의 두 필드(`mobileOriginalLine`·`mobileScaleBar`)이고 서로 배타다.
 * 읽기·쓰기를 이 파일 하나로 모아, 빌더가 한쪽만 켜고 응답 화면이 같은 규칙으로 읽는다.
 */
export type ChoiceGroupMobileView = 'tiles' | 'original-line' | 'scale-bar';

export function resolveChoiceGroupMobileView(
  group: ChoiceGroup | undefined,
): ChoiceGroupMobileView {
  if (!group || group.type === 'ranking') return 'tiles';
  // 둘 다 켜진 어긋난 값은 나중에 생긴 쪽(척도 막대)으로 읽는다 — 빌더는 둘을 같이 쓰지 않는다
  if (group.mobileScaleBar === true) return 'scale-bar';
  if (group.mobileOriginalLine === true) return 'original-line';
  return 'tiles';
}

/** 모양을 바꾼 그룹 — 고른 쪽 필드만 남기고, 세로 타일이면 둘 다 지운다(켜 둔 적 없는 그룹과 같은 모양) */
export function withChoiceGroupMobileView(
  group: ChoiceGroup,
  view: ChoiceGroupMobileView,
): ChoiceGroup {
  const { mobileOriginalLine: _line, mobileScaleBar: _bar, ...rest } = group;
  if (view === 'original-line') return { ...rest, mobileOriginalLine: true };
  if (view === 'scale-bar') return { ...rest, mobileScaleBar: true };
  return rest;
}
