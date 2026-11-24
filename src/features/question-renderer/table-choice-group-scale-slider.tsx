'use client';

import React, { useCallback, useMemo } from 'react';

import { useChoiceGroupToggle } from '@/features/question-renderer/hooks/use-choice-opt-toggle';
import type { ChoiceGroup, TableCell } from '@/types/survey';

import { ScaleSlider, type ScaleSliderProps } from './scale-slider';

interface TableChoiceGroupScaleSliderProps extends Omit<
  ScaleSliderProps,
  'sliderId' | 'selectedChoiceId' | 'onToggleChoice'
> {
  group: ChoiceGroup;
  /** 눈금·척도 밖 보기가 된 원래 보기 칸 — 선택 쓰기 규칙(단독 선택·따라 선택) 판정에 셀 정의가 필요하다 */
  cells: readonly TableCell[];
  value?: Record<string, unknown> | undefined;
  onChange?: ((value: Record<string, unknown>) => void) | undefined;
}

/**
 * 표 문항(보기 그룹 표)의 척도 슬라이더 — 슬라이더 컴포넌트에 이 문항의 선택 쓰기를 잇는다.
 *
 * ── 배선과 규칙 ──
 * - 선택 읽기·쓰기는 데스크톱 보기 칸·세로 타일·척도 막대와 같은 `useChoiceGroupToggle` 이다. 저장은 표 응답
 *   안 예약 키 `__choiceGroups[그룹키]` 에 고른 보기 칸 id 하나 — **슬라이더를 끈 같은 문항과 응답 키·값이
 *   같다.** 고른 것을 다시 누르면 푸는 것도 그 토글의 규칙이다.
 * - 슬라이더는 끄는 동안 토글을 부르지 않고 손을 뗄 때 한 번만 부른다(scale-slider). 그래서 끄는 동안에는
 *   응답 상태가 바뀌지 않고, 스친 눈금 때문에 표시 조건이 돌거나 숨은 답이 지워지지 않는다.
 * - 모델의 `choiceId` 는 보기 칸 id 다. 이 묶음의 칸이 아닌 id 는 무시한다.
 * - 잠금(`fieldset disabled`)·필수 강조·좁은 화면은 슬라이더 컴포넌트가 다룬다 — 여기서는 넘기기만 한다.
 */
export const TableChoiceGroupScaleSlider = React.memo(function TableChoiceGroupScaleSlider({
  group,
  cells,
  value,
  onChange,
  ...sliderProps
}: TableChoiceGroupScaleSliderProps) {
  const { selection, toggle } = useChoiceGroupToggle({
    questionId: sliderProps.questionId,
    group,
    value,
    onChange,
  });
  const cellById = useMemo(() => new Map(cells.map((cell) => [cell.id, cell])), [cells]);
  const onToggleChoice = useCallback(
    (choiceId: string) => {
      const cell = cellById.get(choiceId);
      if (cell) toggle(cell);
    },
    [cellById, toggle],
  );
  return (
    <ScaleSlider
      {...sliderProps}
      sliderId={group.id}
      ariaLabel={sliderProps.ariaLabel ?? group.label}
      selectedChoiceId={typeof selection === 'string' ? selection : undefined}
      onToggleChoice={onToggleChoice}
    />
  );
});
