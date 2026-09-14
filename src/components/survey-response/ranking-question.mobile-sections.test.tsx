import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RankingQuestion } from '@/components/survey-response/ranking-question';
import type { Question } from '@/types/survey';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));

/**
 * 표 소스 순위형 — 첫 열 분류 셀이 rowspan 으로 두 행을 덮고 「헤더」로 지정된 표.
 * 데스크톱은 표 그대로라 분류가 보이지만, 모바일 카드 목록은 보기만 나열해 소속 분류가 사라졌다.
 */
function tableRankingQuestion(inputMode: 'click' | 'dropdown'): Question {
  return {
    id: 'q1',
    type: 'ranking',
    title: '공급처 선택 기준',
    required: false,
    order: 0,
    rankingConfig: { optionsSource: 'table', positions: 2, inputMode },
    tableColumns: [
      { id: 'c0', label: '분류', width: 120 },
      { id: 'c1', label: '항목', width: 200 },
      { id: 'c2', label: '항목', width: 200 },
    ],
    tableRowsData: [
      {
        id: 'r1',
        cells: [
          {
            id: 'cat-tech',
            type: 'text',
            content: '기술 성능',
            rowspan: 2,
            mobileDisplay: 'header',
          },
          { id: 'o1', type: 'ranking_opt', content: '연산 성능' },
          { id: 'o2', type: 'ranking_opt', content: '전력 효율' },
        ],
      },
      {
        id: 'r2',
        cells: [
          { id: 'r2c0', type: 'text', content: '', isHidden: true },
          { id: 'o3', type: 'ranking_opt', content: '품질 신뢰성' },
          { id: 'o4', type: 'ranking_opt', content: '보안성' },
        ],
      },
      {
        id: 'r3',
        cells: [
          { id: 'cat-econ', type: 'text', content: '경제성', mobileDisplay: 'header' },
          { id: 'o5', type: 'ranking_opt', content: '가격' },
          { id: 'o6', type: 'text', content: '' },
        ],
      },
    ],
  } as unknown as Question;
}

describe('모바일 순위형 카드 — 헤더 셀 구간을 카드 하나로 묶는다', () => {
  it.each(['click', 'dropdown'] as const)(
    '%s 방식: 헤더 셀이 묶음 카드의 제목 띠로 한 번 나오고 rowspan 으로 덮인 행의 보기도 그 카드 안 행이다',
    (mode) => {
      render(
        <RankingQuestion
          question={tableRankingQuestion(mode)}
          value={undefined}
          onChange={vi.fn()}
        />,
      );

      const tech = screen.getByRole('heading', { name: '기술 성능' });
      const econ = screen.getByRole('heading', { name: '경제성' });
      expect(screen.getAllByRole('heading', { name: '기술 성능' })).toHaveLength(1);

      // 묶음 카드(section) 하나가 제목과 보기 넷을 담고, 다른 구간의 보기는 없다
      const techCard = tech.closest('section')!;
      expect(techCard).toHaveClass('rounded-2xl', 'border');
      expect(within(techCard).getByText('연산 성능')).toBeInTheDocument();
      expect(within(techCard).getByText('전력 효율')).toBeInTheDocument();
      expect(within(techCard).getByText('품질 신뢰성')).toBeInTheDocument();
      expect(within(techCard).getByText('보안성')).toBeInTheDocument();
      expect(within(techCard).queryByText('가격')).not.toBeInTheDocument();

      // 카드 안 보기는 낱장 카드가 아니라 행이다 — 테두리 카드가 카드 안에 또 있으면 안 된다
      expect(techCard.querySelectorAll('.rounded-2xl')).toHaveLength(0);

      const econCard = econ.closest('section')!;
      expect(within(econCard).getByText('가격')).toBeInTheDocument();
    },
  );

  it('헤더 지정이 없으면 묶지 않는다 — 낱장 카드 목록 그대로', () => {
    const q = tableRankingQuestion('click');
    for (const row of q.tableRowsData ?? []) for (const c of row.cells) delete c.mobileDisplay;
    const { container } = render(
      <RankingQuestion question={q} value={undefined} onChange={vi.fn()} />,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByText('기술 성능')).not.toBeInTheDocument();
    // 보기 다섯이 각각 낱장 카드다
    expect(container.querySelectorAll('.rounded-2xl')).toHaveLength(5);
  });
});
