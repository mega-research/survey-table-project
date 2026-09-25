import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Question } from '@/types/survey';

import { RankingQuestion } from './ranking-question';

let mobile = true;
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => mobile,
  useMediaQuery: () => mobile,
}));

const question: Question = {
  id: 'region',
  type: 'ranking',
  title: '선호 근무 지역',
  required: true,
  order: 0,
  rankingConfig: { optionsSource: 'manual', inputMode: 'click', positions: 2 },
  optionsColumns: 6,
  mobileOptionsColumns: 2,
  options: [
    { id: 'seoul', value: '1', label: '① 서울' },
    { id: 'busan', value: '2', label: '② 부산' },
    { id: 'daegu', value: '3', label: '③ 대구' },
  ],
};

beforeEach(() => {
  mobile = true;
});

describe('순위형 클릭 보기의 모바일 배치', () => {
  it('PC 6열 설정과 별개로 모바일 2열을 적용하며 순위를 선택한다', () => {
    const onChange = vi.fn();
    render(
      <RankingQuestion
        question={question}
        value={[{ rank: 1, optionValue: '1' }]}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('group', { name: '순위 보기' })).toHaveStyle({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    });
    fireEvent.click(screen.getByRole('button', { name: '② 부산' }));
    expect(onChange).toHaveBeenCalledWith([
      { rank: 1, optionValue: '1' },
      { rank: 2, optionValue: '2' },
    ]);
  });

  it('PC에서는 모바일 설정 대신 기존 6열 배치를 유지한다', () => {
    mobile = false;
    render(<RankingQuestion question={question} value={[]} onChange={vi.fn()} />);
    const grid = screen.getByRole('group', { name: '순위 보기' });
    expect(grid.style.getPropertyValue('--ranking-cols')).toBe('repeat(6, minmax(0, 1fr))');
    expect(grid.style.gridTemplateColumns).toBe('');
  });

  it('모바일 1열 지정은 짧은 보기에도 적용한다', () => {
    render(
      <RankingQuestion
        question={{ ...question, mobileOptionsColumns: 1 }}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('group', { name: '순위 보기' }).style.getPropertyValue('--ranking-cols'),
    ).toBe('repeat(1, minmax(0, 1fr))');
  });

  it('모바일 가로 배치는 줄바꿈 가능한 가로 목록으로 표시한다', () => {
    render(
      <RankingQuestion
        question={{ ...question, mobileOptionsColumns: 0 }}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('group', { name: '순위 보기' })).toHaveClass('flex', 'flex-wrap');
  });

  it('모바일 자동 배치는 다른 선택형과 같이 짧은 보기를 2열로 표시한다', () => {
    render(
      <RankingQuestion
        question={{ ...question, mobileOptionsColumns: null }}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('group', { name: '순위 보기' })).toHaveStyle({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    });
  });
});
