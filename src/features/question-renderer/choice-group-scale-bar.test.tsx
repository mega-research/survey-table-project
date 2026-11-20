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

describe('ChoiceGroupScaleBar — 글자가 긴 칸과 구간에 붙는 라벨', () => {
  afterEach(cleanup);

  const DESC = ['⑩', '⑨', '⑧', '⑦', '⑥', '⑤', '④', '③', '②', '①'];
  const bandIndexOf = (n: number) => (n < 2 ? 0 : n === 4 || n === 5 ? 1 : n >= 8 ? 2 : null);
  /** 청암대 재학생 문31 — ⑩~① 뒤에 「미참여」 한 칸. 끝 칸에는 구간 이름이 없다 */
  const withOffScale: ScaleBarModel = {
    cells: [
      ...DESC.map((text, n) => ({ cellId: `c${n}`, text, bandIndex: bandIndexOf(n) })),
      { cellId: 'c10', text: '미참여', bandIndex: null, minWidth: 45 },
    ],
    bands: [
      { label: '매우 만족', start: 0, span: 2 },
      { label: '보통', start: 4, span: 2 },
      { label: '매우 불만족', start: 8, span: 2 },
    ],
    anchors: {
      left: '매우 만족',
      middle: { label: '보통', index: 4, span: 2 },
      right: '매우 불만족',
      rightEnd: 9,
    },
    showsSelectionLabel: true,
  };
  const elevenPoint: ScaleBarModel = {
    cells: ['⓪', ...DESC.slice().reverse()].map((text, n) => ({
      cellId: `c${n}`,
      text,
      bandIndex: n === 0 ? 0 : n === 5 ? 1 : n === 10 ? 2 : null,
    })),
    bands: [
      { label: '매우 불만족', start: 0, span: 1 },
      { label: '보통', start: 5, span: 1 },
      { label: '매우 만족', start: 10, span: 1 },
    ],
    anchors: { left: '매우 불만족', middle: { label: '보통', index: 5 }, right: '매우 만족' },
    showsSelectionLabel: true,
  };
  const draw = (model: ScaleBarModel) =>
    render(
      <ChoiceGroupScaleBar
        questionId="q1"
        barId="g1"
        model={model}
        label=""
        ariaLabel="만족도"
        selectedCellId={undefined}
        onToggleCell={() => {}}
      />,
    );
  const template = (el: Element) => (el as HTMLElement).style.gridTemplateColumns;
  const anchor = (name: string) => screen.getByText(name).style;

  it('긴 글자 칸만 최소 폭을 갖고, 막대·띠·라벨이 같은 열 틀을 써 서로 어긋나지 않는다', () => {
    draw(withOffScale);
    const expected = [...Array(10).fill('minmax(0, 1fr)'), 'minmax(45px, 1fr)'].join(' ');
    const bar = screen.getByRole('radio', { name: /미참여/ }).closest('label')!.parentElement!;
    expect(template(bar)).toBe(expected);
    expect(template(screen.getByTestId('scale-bar-strip'))).toBe(expected);
    expect(template(screen.getByTestId('scale-bar-anchors'))).toBe(expected);
  });

  it('라벨은 제 구간에 붙는다 — 오른쪽 라벨은 구간 끝 칸까지, 가운데 라벨은 구간 칸들 가운데', () => {
    draw(withOffScale);
    expect(anchor('매우 만족').gridColumn).toBe('1 / -1');
    expect(anchor('매우 만족').justifySelf).toBe('start');
    expect(anchor('보통').gridColumn).toBe('5 / span 2');
    expect(anchor('보통').justifySelf).toBe('center');
    expect(anchor('매우 불만족').gridColumn).toBe('1 / 11');
    expect(anchor('매우 불만족').justifySelf).toBe('end');
  });

  it('긴 글자 칸이 없는 막대는 종전과 같은 고른 열 틀이고 라벨 자리도 양끝·정가운데 칸이다', () => {
    draw(elevenPoint);
    const equal = 'repeat(11, minmax(0, 1fr))';
    expect(template(screen.getByTestId('scale-bar-strip'))).toBe(equal);
    expect(template(screen.getByTestId('scale-bar-anchors'))).toBe(equal);
    expect(anchor('매우 불만족').gridColumn).toBe('1 / -1');
    expect(anchor('보통').gridColumn).toBe('6 / span 1');
    expect(anchor('매우 만족').gridColumn).toBe('1 / 12');
    expect(anchor('매우 만족').justifySelf).toBe('end');
  });
});
