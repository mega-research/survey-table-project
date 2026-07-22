import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CycleSummaryTable } from '@/components/operations/mail-cost/cycle-summary-table';
import type { CycleSummary } from '@/lib/operations/mail-billing.server';

const cycle: CycleSummary = {
  cycleKey: '2026-07-15T00:00:00.000Z',
  startedAt: new Date('2026-07-15T00:00:00Z'),
  endsAt: new Date('2026-08-15T00:00:00Z'),
  startLabel: '2026-07-15',
  endLabel: '2026-08-14',
  planLabel: '기본',
  billingDayOfMonth: 15,
  includedEmails: 1000,
  overagePer1kKrw: 1000,
  isCurrent: true,
  totalBillable: 1,
  totalIncluded: 1,
  totalOverage: 0,
  overageCostKrw: 0,
  monthlyFeeKrw: 10000,
  totalCostKrw: 10000,
  campaigns: [{
    campaignId: 'campaign-archived',
    surveyId: 'survey-1',
    surveyTitle: '정산 설문',
    runNumber: 3,
    title: '삭제된 테스트 발송',
    status: 'cancelled',
    startedAt: new Date('2026-07-22T00:00:00Z'),
    completedAt: null,
    billableCount: 1,
    includedCount: 1,
    overageCount: 0,
    costKrw: 0,
    averageUnitPriceKrw: 0,
    isTest: true,
    archivedAt: new Date('2026-07-22T01:00:00Z'),
  }],
};

describe('CycleSummaryTable archived test campaign', () => {
  it('테스트 배지와 비식별 제목을 표시하고 운영 상세 링크는 만들지 않는다', () => {
    render(<CycleSummaryTable cycle={cycle} />);

    expect(screen.getByText('테스트')).toBeInTheDocument();
    expect(screen.getByText('삭제된 테스트 발송')).toBeInTheDocument();
    expect(screen.getByText('정산 설문')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '정산 설문' })).not.toBeInTheDocument();
  });
});
