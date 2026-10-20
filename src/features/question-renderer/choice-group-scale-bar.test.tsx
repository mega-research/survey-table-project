import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('ChoiceGroupScaleBar — 칸 이름 목록(6칸 이상, 칸마다 이름)', () => {
  afterEach(cleanup);

  const NAMES = [
    '전혀 관련 없음 (지원사업 시점* 불일치)',
    '전혀 도움되지 않음',
    '도움되지 않음',
    '보통',
    '도움이 되는 편',
    '매우 도움 됨',
  ];
  const sixPoint: ScaleBarModel = {
    cells: ['ⓞ', '①', '②', '③', '④', '⑤'].map((text, n) => ({
      cellId: `c${n}`,
      text,
      legendLabel: NAMES[n]!,
      bandIndex: null,
    })),
    bands: [],
    anchors: {},
    showsSelectionLabel: false,
  };

  it('막대 아래에 「칸 글자 + 이름」을 칸 순서대로 적고, 줄을 눌러도 그 칸이 골라진다', () => {
    const onToggleCell = vi.fn();
    render(
      <ChoiceGroupScaleBar
        questionId="q1"
        barId="g1"
        model={sixPoint}
        label=""
        ariaLabel="도움 정도"
        selectedCellId="c3"
        onToggleCell={onToggleCell}
      />,
    );
    const lines = within(screen.getByTestId('scale-bar-legend')).getAllByRole('listitem');
    expect(lines.map((line) => line.textContent)).toEqual(
      ['ⓞ', '①', '②', '③', '④', '⑤'].map((mark, n) => `${mark}${NAMES[n]}`),
    );
    // 고른 칸의 줄만 강조
    expect(lines[3]!.querySelector('label')!.className).toContain('text-blue-800');
    expect(lines[0]!.querySelector('label')!.className).not.toContain('text-blue-800');
    // 스크린리더는 막대 칸에서 이름까지 읽는다
    expect(
      screen.getByRole('radio', { name: 'ⓞ 전혀 관련 없음 (지원사업 시점* 불일치)' }),
    ).toBeTruthy();

    fireEvent.click(within(lines[5]!).getByText('매우 도움 됨'));
    expect(onToggleCell).toHaveBeenCalledWith('c5');
  });

  it('이름 목록이 없는 척도에는 목록을 그리지 않는다', () => {
    render(
      <ChoiceGroupScaleBar
        questionId="q1"
        barId="g1"
        model={fivePoint}
        label=""
        ariaLabel="척도"
        selectedCellId={undefined}
        onToggleCell={() => {}}
      />,
    );
    expect(screen.queryByTestId('scale-bar-legend')).toBeNull();
  });
});
