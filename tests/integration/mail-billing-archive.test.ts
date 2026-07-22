import { beforeEach, describe, expect, it, vi } from 'vitest';

const { selectResults } = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
}));

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => {
      const rows = selectResults.shift() ?? [];
      const chain = {
        from() {
          return chain;
        },
        innerJoin() {
          return chain;
        },
        where() {
          return chain;
        },
        groupBy() {
          return Promise.resolve(rows);
        },
        orderBy() {
          return Promise.resolve(rows);
        },
      };
      return chain;
    }),
  },
}));

import { computeCycleBreakdown } from '@/lib/operations/mail-billing.server';

beforeEach(() => {
  selectResults.length = 0;
});

describe('mail billing archive policy', () => {
  it('archived 테스트 캠페인도 recipient status 기준 한 번 집계하고 표시 상태를 전달한다', async () => {
    const archivedAt = new Date('2026-07-22T01:00:00Z');
    const startedAt = new Date('2026-07-22T00:00:00Z');
    selectResults.push(
      [],
      [{
        id: 'campaign-archived',
        surveyId: 'survey-1',
        surveyTitle: '정산 설문',
        runNumber: 3,
        title: '삭제된 테스트 발송',
        status: 'cancelled',
        startedAt,
        completedAt: null,
        isTest: true,
        archivedAt,
      }],
      [{ campaignId: 'campaign-archived', billable: 2 }],
    );

    const result = await computeCycleBreakdown();

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]?.totalBillable).toBe(2);
    expect(result.cycles[0]?.campaigns).toEqual([
      expect.objectContaining({
        campaignId: 'campaign-archived',
        title: '삭제된 테스트 발송',
        billableCount: 2,
        isTest: true,
        archivedAt,
      }),
    ]);
  });

  it('active와 archived 테스트 발송을 누락·중복 없이 각각 한 번 합산한다', async () => {
    const startedAt = new Date('2026-07-22T00:00:00Z');
    const archivedAt = new Date('2026-07-22T01:00:00Z');
    selectResults.push(
      [],
      [
        {
          id: 'campaign-active',
          surveyId: 'survey-1',
          surveyTitle: '정산 설문',
          runNumber: 1,
          title: '진행 테스트 발송',
          status: 'completed',
          startedAt,
          completedAt: startedAt,
          isTest: true,
          archivedAt: null,
        },
        {
          id: 'campaign-archived',
          surveyId: 'survey-1',
          surveyTitle: '정산 설문',
          runNumber: 2,
          title: '삭제된 테스트 발송',
          status: 'cancelled',
          startedAt: new Date(startedAt.getTime() + 60_000),
          completedAt: null,
          isTest: true,
          archivedAt,
        },
      ],
      [
        { campaignId: 'campaign-active', billable: 1 },
        { campaignId: 'campaign-archived', billable: 1 },
      ],
    );

    const result = await computeCycleBreakdown();
    const cycle = result.cycles[0];

    expect(cycle?.totalBillable).toBe(2);
    expect(cycle?.campaigns.map((campaign) => campaign.campaignId)).toEqual([
      'campaign-active',
      'campaign-archived',
    ]);
    expect(cycle?.campaigns.map((campaign) => campaign.billableCount)).toEqual([1, 1]);
  });
});
