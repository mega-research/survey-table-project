import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChoiceGroup, Question } from '@/types/survey';

import { ChoiceTableResponse } from './choice-table-response';

/**
 * 보기 소스 표(radio 문항 + 내장 표) — 보기 모양이 「척도 슬라이더」인 보기 그룹. 슬라이더를 그릴 수 있기
 * 전까지는 표 문항과 같이 원본 한 줄로 그리고, 선택 쓰기는 이 문항의 그룹 맵 그대로다.
 * 슬라이더 조각이 생기면 이 파일의 기대가 바뀐다.
 */

const view = vi.hoisted(() => ({ mobile: true }));
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => view.mobile,
  useMediaQuery: () => view.mobile,
}));
vi.mock('@/features/question-renderer/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/question-renderer/contact-attrs-context')>()),
  useContactAttrs: () => ({}),
  useAnswerQuotes: () => ({}),
}));
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  view.mobile = true;
});

const CIRC = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

function question(
  mode: Question['mobileTableDisplayMode'],
  satGroup: Partial<ChoiceGroup> = { scaleSlider: 'positive-right' },
): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '지원제도',
    required: false,
    order: 0,
    mobileTableDisplayMode: mode,
    mobileDrilldownOmitLeadingColumns: 1,
    choiceGroups: [
      { id: 'g-use', type: 'radio', groupKey: 'rad1', label: '활용 여부' },
      { id: 'g-sat', type: 'radio', groupKey: 'rad2', label: '만족도', ...satGroup },
    ],
    tableColumns: [
      { id: 'c-item', label: '평가항목' },
      { id: 'c-u1', label: '활용함' },
      { id: 'c-u2', label: '활용 안함' },
      ...CIRC.map((_, n) => ({ id: `c-s${n}`, label: `${n}점` })),
    ],
    tableHeaderGrid: [
      [
        { id: 'h-item', label: '평가항목', colspan: 1, rowspan: 2 },
        { id: 'h-use', label: '활용 여부', colspan: 2, rowspan: 1 },
        { id: 'h-sat', label: '만족도', colspan: 11, rowspan: 1 },
      ],
      [
        { id: 'h-u1', label: '활용함', colspan: 1, rowspan: 1 },
        { id: 'h-u2', label: '활용 안함', colspan: 1, rowspan: 1 },
        { id: 'h-0', label: '매우 불만족', colspan: 1, rowspan: 1 },
        { id: 'h-neg', label: '불만족', colspan: 4, rowspan: 1 },
        { id: 'h-5', label: '보통', colspan: 1, rowspan: 1 },
        { id: 'h-pos', label: '만족', colspan: 4, rowspan: 1 },
        { id: 'h-10', label: '매우 만족', colspan: 1, rowspan: 1 },
      ],
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '회의실 및 교통비 지원',
        cells: [
          { id: 'item', type: 'text', content: '1) 회의실 및 교통비 지원' },
          { id: 'u1', type: 'choice_opt', content: '①', choiceLabel: '활용함', choiceGroupId: 'g-use' },
          { id: 'u2', type: 'choice_opt', content: '②', choiceLabel: '활용 안함', choiceGroupId: 'g-use' },
          ...CIRC.map((content, n) => ({
            id: `sat${n}`,
            type: 'choice_opt' as const,
            content,
            choiceLabel: `${n}점`,
            choiceGroupId: 'g-sat',
          })),
        ],
      },
    ],
  } as unknown as Question;
}

function Harness({ q }: { q: Question }) {
  const [value, setValue] = useState<unknown>(undefined);
  return (
    <>
      <ChoiceTableResponse question={q} value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value ?? null)}</output>
    </>
  );
}

const valueOf = () => JSON.parse(screen.getByTestId('value').textContent!);
const rowBlock = (rowId: string) =>
  document.querySelector<HTMLElement>(`[data-row-question-id="${rowId}"]`)!;

describe('보기 소스 표 — 척도 슬라이더를 고른 그룹(슬라이더 조각이 생기기 전)', () => {
  it('「행 단위 그룹 카드」: 그 그룹을 원본 한 줄로 그리고 다른 그룹은 세로 타일 그대로다', () => {
    render(<Harness q={question('row-group-cards')} />);
    const line = screen.getByTestId('choice-group-original-line-g-sat');
    for (const label of ['만족도', '매우 불만족', '보통', '매우 만족']) {
      expect(within(line).getByText(label)).toBeInTheDocument();
    }
    expect(within(line).getAllByRole('radio')).toHaveLength(11);
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-original-line-g-use')).not.toBeInTheDocument();
    expect(screen.getByText('활용 안함', { selector: 'span' })).toBeInTheDocument();
  });

  it('「행 단위 그룹 카드」: 한 줄의 칸을 누르면 그룹 맵에 셀 id 가 들어간다', () => {
    render(<Harness q={question('row-group-cards', { scaleSlider: 'positive-left' })} />);
    fireEvent.click(within(screen.getByTestId('choice-group-original-line-g-sat')).getByText('⑦'));
    expect(valueOf()).toEqual({ rad2: 'sat7' });
  });

  it('「행 단위 그룹 카드」: 척도 막대 필드가 함께 켜져 있어도 막대가 아니라 원본 한 줄이다', () => {
    render(
      <Harness
        q={question('row-group-cards', { scaleSlider: 'positive-right', mobileScaleBar: true })}
      />,
    );
    expect(screen.getByTestId('choice-group-original-line-g-sat')).toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
  });

  it('「행별 척도」: 그 그룹 열의 원본 표 조각으로 그리고 같은 그룹 맵으로 저장된다', () => {
    render(<Harness q={question('row-wise-scale')} />);
    const block = rowBlock('r1');
    expect(screen.queryByTestId('choice-group-scale-bar-g-sat')).not.toBeInTheDocument();
    const tiles = within(block).getByRole('group', { name: '활용 여부' });
    expect(within(tiles).getAllByRole('radio')).toHaveLength(2);
    expect(within(block).queryByRole('group', { name: '만족도' })).not.toBeInTheDocument();
    const pieceRadios = within(block)
      .getAllByRole('radio')
      .filter((radio) => !tiles.contains(radio));
    expect(pieceRadios).toHaveLength(11);
    fireEvent.click(pieceRadios[7]!);
    expect(valueOf()).toEqual({ rad2: 'sat7' });
  });

  it('데스크톱 폭에서는 원본 표 그대로다', () => {
    view.mobile = false;
    render(<Harness q={question('row-wise-scale')} />);
    expect(screen.queryByTestId('mobile-row-wise-original-sheet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('choice-group-original-line-g-sat')).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(13);
  });
});
