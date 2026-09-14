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

describe('모바일 순위형 카드 — 헤더 셀 구간 제목', () => {
  it.each(['click', 'dropdown'] as const)(
    '%s 방식: 헤더 셀이 구간 제목으로 한 번 나오고 rowspan 으로 덮인 행의 보기도 그 아래 온다',
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

      // 구간 컨테이너 안에 그 구간의 보기 넷이 있고 다른 구간의 보기는 없다
      const techSection = tech.closest('section')!;
      expect(within(techSection).getByText('연산 성능')).toBeInTheDocument();
      expect(within(techSection).getByText('전력 효율')).toBeInTheDocument();
      expect(within(techSection).getByText('품질 신뢰성')).toBeInTheDocument();
      expect(within(techSection).getByText('보안성')).toBeInTheDocument();
      expect(within(techSection).queryByText('가격')).not.toBeInTheDocument();

      const econSection = econ.closest('section')!;
      expect(within(econSection).getByText('가격')).toBeInTheDocument();
    },
  );

  it('헤더 지정이 없으면 구간 제목을 만들지 않는다 — 기존 카드 목록 그대로', () => {
    const q = tableRankingQuestion('click');
    for (const row of q.tableRowsData ?? []) for (const c of row.cells) delete c.mobileDisplay;
    render(<RankingQuestion question={q} value={undefined} onChange={vi.fn()} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByText('기술 성능')).not.toBeInTheDocument();
  });
});
