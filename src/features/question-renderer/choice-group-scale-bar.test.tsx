import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChoiceGroupScaleBar } from '@/features/question-renderer/choice-group-scale-bar';
import type { ScaleBarModel } from '@/features/question-renderer/utils/choice-group-scale-bar';

const attrs = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('@/features/question-renderer/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/question-renderer/contact-attrs-context')>()),
  useContactAttrs: () => attrs.value,
  useAnswerQuotes: () => ({}),
}));

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
      { cellId: 'c10', text: '미참여', bandIndex: null },
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

  it('긴 글자 칸만 최소 폭을 갖고, 막대·띠·라벨이 같은 열 틀을 써 서로 어긋나지 않는다', () => {
    draw(withOffScale);
    const expected = [...Array(10).fill('minmax(0, 1fr)'), 'minmax(45px, 1fr)'].join(' ');
    const bar = screen.getByRole('radio', { name: /미참여/ }).closest('label')!.parentElement!;
    expect(template(bar)).toBe(expected);
    expect(template(screen.getByTestId('scale-bar-strip'))).toBe(expected);
    expect(template(screen.getByTestId('scale-bar-anchors'))).toBe(expected);
  });

  it('칸 폭은 화면에 보이는 글자로 잰다 — 명단 토큰은 치환한 값이 기준이다', () => {
    const tokenCell = (raw: string): ScaleBarModel => ({
      ...withOffScale,
      cells: [...withOffScale.cells.slice(0, 10), { cellId: 'c10', text: raw, bandIndex: null }],
    });
    attrs.value = { 긴이름의명단열: '모름', 짧음: '해당없음' };
    // 토큰 이름은 길지만 보이는 글자(「모름」)는 짧다 — 넓히지 않는다
    draw(tokenCell('{{긴이름의명단열}}'));
    expect(template(screen.getByTestId('scale-bar-strip'))).toBe('repeat(11, minmax(0, 1fr))');
    cleanup();
    // 토큰 이름은 짧지만 보이는 글자(「해당없음」)는 길다 — 넓힌다
    draw(tokenCell('{{짧음}}'));
    expect(template(screen.getByTestId('scale-bar-strip'))).toContain('minmax(58px, 1fr)');
    attrs.value = {};
  });

  it('라벨 줄은 제 구간의 칸 범위에 붙는다 — 척도 밖 칸(미참여)은 빼고, 가운데 라벨은 구간 가운데', () => {
    draw(withOffScale);
    const row = screen.getByTestId('scale-bar-anchor-row');
    // 왼쪽 라벨의 첫 칸(1) ~ 오른쪽 라벨의 끝 칸(10) — 11번째 「미참여」 칸 아래는 비운다
    expect(row.style.gridColumn).toBe('1 / 11');
    // 가운데 구간(5·6번째 칸)의 중심이 범위 한가운데라 양옆 자리가 같다
    expect(row.style.gridTemplateColumns).toBe('minmax(0, 5fr) fit-content(40%) minmax(0, 5fr)');
    expect([...row.children].map((el) => el.textContent)).toEqual(['매우 만족', '보통', '매우 불만족']);
    expect(row.children[0]).toHaveClass('text-left');
    expect(row.children[1]).toHaveClass('text-center');
    expect(row.children[2]).toHaveClass('text-right');
  });

  it('긴 라벨은 한 줄로 겹쳐 놓지 않는다 — 제 자리 안에서 줄을 바꾼다', () => {
    draw({
      ...elevenPoint,
      anchors: {
        left: 'Tốt hơn nhiều so với kỳ vọng',
        middle: { label: 'Bình thường', index: 5 },
        right: 'Tệ hơn nhiều so với kỳ vọng',
      },
    });
    const row = screen.getByTestId('scale-bar-anchor-row');
    for (const el of row.children) {
      expect(el).not.toHaveClass('whitespace-nowrap');
      expect(el).toHaveClass('min-w-0');
    }
    // 라벨 줄의 높이를 한 줄로 못박지 않는다(줄이 늘면 아래 내용이 밀린다)
    expect(screen.getByTestId('scale-bar-anchors')).not.toHaveClass('h-4');
  });

  it('가운데 라벨이 없으면 양끝 라벨을 양쪽으로 벌린다', () => {
    draw({ ...elevenPoint, anchors: { left: '전혀 아니다', right: '매우 그렇다' } });
    const row = screen.getByTestId('scale-bar-anchor-row');
    expect(row.style.gridColumn).toBe('1 / 12');
    expect(row.style.gridTemplateColumns).toBe('');
    expect(row).toHaveClass('flex', 'justify-between');
    expect([...row.children].map((el) => el.textContent)).toEqual(['전혀 아니다', '매우 그렇다']);
  });

  it('긴 글자 칸이 없는 막대는 종전과 같은 고른 열 틀이고 라벨 자리도 양끝·정가운데 칸이다', () => {
    draw(elevenPoint);
    const equal = 'repeat(11, minmax(0, 1fr))';
    expect(template(screen.getByTestId('scale-bar-strip'))).toBe(equal);
    expect(template(screen.getByTestId('scale-bar-anchors'))).toBe(equal);
    const row = screen.getByTestId('scale-bar-anchor-row');
    expect(row.style.gridColumn).toBe('1 / 12');
    expect(row.style.gridTemplateColumns).toBe('minmax(0, 5.5fr) fit-content(40%) minmax(0, 5.5fr)');
    expect([...row.children].map((el) => el.textContent)).toEqual(['매우 불만족', '보통', '매우 만족']);
  });
});
