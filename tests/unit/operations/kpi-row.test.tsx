import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KpiRow } from '@/components/operations/kpi-row';
import type { StatusCounts } from '@/lib/operations/aggregate-status';

const counts: StatusCounts = {
  total: 0,
  completed: 0,
  screenedOut: 0,
  quotafulOut: 0,
  bad: 0,
  drop: 0,
  inProgress: 0,
};

describe('KpiRow', () => {
  it('쿼터 미설정이어도 쿼터 카드를 보여주고 값을 -로 표시한다', () => {
    render(<KpiRow counts={counts} quota={null} />);

    const quotaLabel = screen.getByText('쿼터');
    const quotaCard = quotaLabel.parentElement;

    expect(quotaCard).toBeInTheDocument();
    expect(within(quotaCard as HTMLElement).getAllByText('-')).toHaveLength(2);
  });

  it('쿼터 카드를 완료 카드 바로 뒤에 배치한다', () => {
    render(<KpiRow counts={counts} quota={null} />);

    expect(screen.getByText('완료')).toAppearBefore(screen.getByText('쿼터'));
    expect(screen.getByText('쿼터')).toAppearBefore(screen.getByText('자격 미달'));
  });

  it('자격 미달 카드는 비율 대신 제외 안내를 보여준다', () => {
    render(<KpiRow counts={{ ...counts, total: 123, completed: 97, screenedOut: 4 }} quota={null} />);

    const label = screen.getByText('자격 미달');
    const card = label.parentElement as HTMLElement;

    expect(within(card).getByText('전체·완료에서 제외')).toBeInTheDocument();
    expect(within(card).queryByText('0.0%')).not.toBeInTheDocument();
  });

  it('자격 미달 카드에 전체 설명을 툴팁으로 단다', () => {
    render(<KpiRow counts={{ ...counts, total: 123, completed: 97, screenedOut: 4 }} quota={null} />);

    expect(screen.getByText('전체·완료에서 제외')).toHaveAttribute(
      'title',
      '자격미달인 사람은 전체응답(분모), 완료(분자)에서 제외됩니다.',
    );
  });
});
