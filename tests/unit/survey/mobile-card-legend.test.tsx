import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MobileRowCard } from '@/components/survey-builder/mobile-row-card';
import type { TableColumn, TableRow } from '@/types/survey';
import { collectMobileLegendLabels, hasMobileDisplayCells } from '@/utils/mobile-display-cells';

/**
 * 모바일 카드 범례 (mobileDisplay: 'legend').
 *
 * 저작자가 text 셀을 "카드 범례"로 지정하면 그 내용이 표의 모든 응답 카드 상단에
 * 한 행(양끝 정렬)으로 표시된다 — 스케일 표(0~10점)에서 앵커 라벨(전혀/매우)이
 * 별도 카드로 분리되지 않고 각 카드 안에서 보이게 하기 위함.
 */

const columns: TableColumn[] = [
  { id: 'c0', label: '항목', width: 100 },
  { id: 'c1', label: '점수', width: 200 },
];

const inputRow = {
  id: 'r2',
  label: '1) 직무 · 진로설정',
  cells: [
    { id: 'r2c0', type: 'text', content: '1) 직무 · 진로설정', mobileDisplay: 'header' },
    {
      id: 'r2c1',
      type: 'radio',
      content: '',
      radioOptions: [
        { id: 'o0', label: '⓪', value: '0' },
        { id: 'o1', label: '⑩', value: '10' },
      ],
    },
  ],
} as unknown as TableRow;

function renderCard(legendLabels?: string[]) {
  return render(
    <MobileRowCard
      row={inputRow}
      visibleColumns={columns}
      columnSectionMap={null}
      completed={false}
      hideColumnLabels={false}
      questionId="q1"
      isTestMode={false}
      legendLabels={legendLabels}
    />,
  );
}

describe('collectMobileLegendLabels', () => {
  const rows = [
    {
      id: 'r1',
      label: '헤더행',
      cells: [
        { id: 'h0', type: 'text', content: '항목', mobileDisplay: 'hidden' },
        { id: 'h1', type: 'text', content: '전혀 도움 안 됨', mobileDisplay: 'legend' },
        { id: 'h2', type: 'text', content: '.....', mobileDisplay: 'hidden' },
        { id: 'h3', type: 'text', content: '매우 도움 됨', mobileDisplay: 'legend' },
        { id: 'h4', type: 'text', content: '  ', mobileDisplay: 'legend' },
        { id: 'h5', type: 'text', content: '숨은 legend', mobileDisplay: 'legend', isHidden: true },
        { id: 'h6', type: 'input', content: '' },
      ],
    },
    inputRow,
  ] as unknown as TableRow[];

  it('legend 지정 text 셀 내용을 순서대로 수집한다 (빈 내용·isHidden 제외)', () => {
    expect(collectMobileLegendLabels(rows)).toEqual(['전혀 도움 안 됨', '매우 도움 됨']);
  });

  it('legend 셀은 display 셀(inline/collapsed)로 집계되지 않는다', () => {
    const legendOnly = [
      {
        id: 'r1',
        label: '헤더행',
        cells: [{ id: 'h1', type: 'text', content: '전혀', mobileDisplay: 'legend' }],
      },
    ] as unknown as TableRow[];
    expect(hasMobileDisplayCells(legendOnly[0]!.cells)).toBe(false);
  });
});

describe('MobileRowCard 범례 표시', () => {
  it('첫/마지막 범례에 카드 옵션의 첫/마지막 라벨이 자동 접두된다', () => {
    renderCard(['전혀 도움 안 됨', '매우 도움 됨']);
    expect(screen.getByText('⓪ 전혀 도움 안 됨')).toBeInTheDocument();
    expect(screen.getByText('⑩ 매우 도움 됨')).toBeInTheDocument();
  });

  it('범례 라벨 사이에 점선 리더가 채워지고 전체가 한 행의 형제로 렌더된다', () => {
    renderCard(['전혀 도움 안 됨', '매우 도움 됨']);
    const first = screen.getByText('⓪ 전혀 도움 안 됨');
    const second = screen.getByText('⑩ 매우 도움 됨');
    expect(first.parentElement).toBe(second.parentElement);
    const filler = first.parentElement!.querySelector('[aria-hidden]');
    expect(filler?.className).toContain('border-dotted');
    expect(filler?.className).toContain('flex-1');
  });

  it('옵션 없는 입력 셀뿐이면 접두 없이 범례 텍스트만 표시된다', () => {
    const inputOnlyRow = {
      id: 'r3',
      label: '입력행',
      cells: [{ id: 'r3c0', type: 'input', content: '' }],
    } as unknown as TableRow;
    render(
      <MobileRowCard
        row={inputOnlyRow}
        visibleColumns={columns}
        columnSectionMap={null}
        completed={false}
        hideColumnLabels={false}
        questionId="q1"
        isTestMode={false}
        legendLabels={['전혀 도움 안 됨', '매우 도움 됨']}
      />,
    );
    expect(screen.getByText('전혀 도움 안 됨')).toBeInTheDocument();
    expect(screen.getByText('매우 도움 됨')).toBeInTheDocument();
  });

  it('legendLabels 미지정이면 범례 없이 기존과 동일하다', () => {
    renderCard(undefined);
    expect(screen.queryByText(/전혀 도움 안 됨/)).not.toBeInTheDocument();
  });
});
