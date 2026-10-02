import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChoiceGroupScaleBar } from '@/features/question-renderer/choice-group-scale-bar';
import type { ScaleBarModel } from '@/features/question-renderer/utils/choice-group-scale-bar';

/** 헤더에 구간 줄이 없는 5점 척도 — 칸마다 이름이 하나씩이라 구간(bands)이 비어 있다 */
const fivePoint: ScaleBarModel = {
  cells: ['①', '②', '③', '④', '⑤'].map((text, n) => ({
    cellId: `c${n}`,
    text,
    bandIndex: null,
  })),
  bands: [],
  anchors: {},
  showsSelectionLabel: false,
};

function strip(selectedCellId?: string) {
  render(
    <ChoiceGroupScaleBar
      questionId="q1"
      barId="g1"
      model={fivePoint}
      label=""
      ariaLabel="척도"
      selectedCellId={selectedCellId}
      onToggleCell={() => {}}
    />,
  );
  return Array.from(screen.getByTestId('scale-bar-strip').children).map((el) => el.className);
}

describe('ChoiceGroupScaleBar — 구간 줄 없는 척도의 색 띠', () => {
  it('칸마다 띠 하나 — 왼쪽 붉은색(끝은 짙게) · 가운데 회색 · 오른쪽 파란색(끝은 짙게)', () => {
    const classes = strip();
    expect(classes).toHaveLength(5);
    expect(classes[0]).toContain('bg-red-400');
    expect(classes[1]).toContain('bg-red-200');
    expect(classes[2]).toContain('bg-gray-300');
    expect(classes[3]).toContain('bg-blue-200');
    expect(classes[4]).toContain('bg-blue-400');
  });

  it('고른 칸의 띠만 가장 짙다', () => {
    const classes = strip('c3');
    expect(classes[3]).toContain('bg-blue-600');
    expect(classes[4]).toContain('bg-blue-400');
  });
});
