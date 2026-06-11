import { describe, expect, it } from 'vitest';

import {
  allocateCycleCosts,
  type AllocatorInputCampaign,
  type AllocatorInputPlan,
} from '@/lib/mail/billing-allocator';

const PRO_50K: AllocatorInputPlan = {
  includedEmails: 50_000,
  monthlyFeeKrw: 28_600,
  overagePer1kKrw: 1_290,
};

function campaign(id: string, billable: number, isoDate: string): AllocatorInputCampaign {
  return { campaignId: id, billableCount: billable, startedAt: new Date(isoDate) };
}

describe('allocateCycleCosts', () => {
  it('단체 메일 0건이면 월정액만 비용', () => {
    const r = allocateCycleCosts({ plan: PRO_50K, campaigns: [] });
    expect(r.totalBillable).toBe(0);
    expect(r.totalIncluded).toBe(0);
    expect(r.totalOverage).toBe(0);
    expect(r.overageCostKrw).toBe(0);
    expect(r.totalCostKrw).toBe(28_600);
    expect(r.campaigns).toEqual([]);
  });

  it('전체가 포함량 안이면 초과 비용 0', () => {
    const r = allocateCycleCosts({
      plan: PRO_50K,
      campaigns: [
        campaign('a', 10_000, '2026-04-20T10:00:00Z'),
        campaign('b', 20_000, '2026-04-25T10:00:00Z'),
      ],
    });
    expect(r.totalBillable).toBe(30_000);
    expect(r.totalIncluded).toBe(30_000);
    expect(r.totalOverage).toBe(0);
    expect(r.overageCostKrw).toBe(0);
    expect(r.totalCostKrw).toBe(28_600);
    expect(r.campaigns.every((c) => c.costKrw === 0)).toBe(true);
  });

  it('경계를 걸친 회차는 비례 분할', () => {
    const r = allocateCycleCosts({
      plan: PRO_50K,
      campaigns: [
        campaign('a', 30_000, '2026-04-20T10:00:00Z'),
        campaign('b', 25_000, '2026-04-27T10:00:00Z'),
        campaign('c', 10_000, '2026-05-04T10:00:00Z'),
      ],
    });
    expect(r.totalBillable).toBe(65_000);
    expect(r.totalIncluded).toBe(50_000);
    expect(r.totalOverage).toBe(15_000);

    // a: 30K 전부 포함
    expect(r.campaigns[0]?.includedCount).toBe(30_000);
    expect(r.campaigns[0]?.overageCount).toBe(0);
    expect(r.campaigns[0]?.costKrw).toBe(0);

    // b: 20K 포함 + 5K 초과
    expect(r.campaigns[1]?.includedCount).toBe(20_000);
    expect(r.campaigns[1]?.overageCount).toBe(5_000);

    // c: 전부 초과
    expect(r.campaigns[2]?.includedCount).toBe(0);
    expect(r.campaigns[2]?.overageCount).toBe(10_000);

    // 사이클 총 초과비 = 15,000 × 1,290 / 1,000 = 19,350
    expect(r.overageCostKrw).toBe(19_350);
    // 총비용 = 월정액 + 초과
    expect(r.totalCostKrw).toBe(28_600 + 19_350);
  });

  it('회차 cost 합이 사이클 overage 합과 정확히 일치 (라운딩 잔액 흡수)', () => {
    // 라운딩 차이를 유발하는 단가 (per-1k 가 1000 의 약수가 아님)
    const plan: AllocatorInputPlan = {
      includedEmails: 100,
      monthlyFeeKrw: 0,
      overagePer1kKrw: 333,
    };
    const r = allocateCycleCosts({
      plan,
      campaigns: [
        campaign('a', 17, '2026-04-20T10:00:00Z'),
        campaign('b', 23, '2026-04-21T10:00:00Z'),
        campaign('c', 200, '2026-04-22T10:00:00Z'),
      ],
    });
    const sumCosts = r.campaigns.reduce((acc, c) => acc + c.costKrw, 0);
    expect(sumCosts).toBe(r.overageCostKrw);
  });

  it('정확히 50,000 도달 후 추가 회차는 전부 초과', () => {
    const r = allocateCycleCosts({
      plan: PRO_50K,
      campaigns: [
        campaign('a', 50_000, '2026-04-20T10:00:00Z'),
        campaign('b', 1_000, '2026-04-22T10:00:00Z'),
      ],
    });
    expect(r.campaigns[0]?.overageCount).toBe(0);
    expect(r.campaigns[1]?.includedCount).toBe(0);
    expect(r.campaigns[1]?.overageCount).toBe(1_000);
    // 1,000건 × 1,290원/1K = 1,290
    expect(r.overageCostKrw).toBe(1_290);
  });

  it('정렬되지 않은 입력은 startedAt ASC 로 정렬되어 동일 결과', () => {
    const a = campaign('a', 30_000, '2026-04-20T10:00:00Z');
    const b = campaign('b', 25_000, '2026-04-27T10:00:00Z');
    const c = campaign('c', 10_000, '2026-05-04T10:00:00Z');

    const r1 = allocateCycleCosts({ plan: PRO_50K, campaigns: [a, b, c] });
    const r2 = allocateCycleCosts({ plan: PRO_50K, campaigns: [c, a, b] });

    expect(r2.campaigns.map((x) => x.campaignId)).toEqual(['a', 'b', 'c']);
    expect(r2.totalCostKrw).toBe(r1.totalCostKrw);
  });

  it('음수 billableCount 는 0 으로 가드', () => {
    const r = allocateCycleCosts({
      plan: PRO_50K,
      campaigns: [campaign('a', -5, '2026-04-20T10:00:00Z')],
    });
    expect(r.totalBillable).toBe(0);
    expect(r.campaigns[0]?.includedCount).toBe(0);
    expect(r.campaigns[0]?.overageCount).toBe(0);
  });

  it('overagePer1kKrw=0 이면 초과분이 있어도 비용 0', () => {
    const r = allocateCycleCosts({
      plan: { includedEmails: 100, monthlyFeeKrw: 0, overagePer1kKrw: 0 },
      campaigns: [campaign('a', 500, '2026-04-20T10:00:00Z')],
    });
    expect(r.totalOverage).toBe(400);
    expect(r.overageCostKrw).toBe(0);
    expect(r.campaigns[0]?.costKrw).toBe(0);
  });

  it('마지막 회차 초과분이 0이면 음수 drift 가 그 회차로 흡수되지 않는다', () => {
    // 마지막 회차(startedAt 기준)의 billableCount=0 → 초과분 0.
    // 라운딩 음수 drift 가 이 회차로 흡수되면 costKrw 가 음수가 되는 회귀.
    const plan: AllocatorInputPlan = {
      includedEmails: 6,
      monthlyFeeKrw: 0,
      overagePer1kKrw: 500,
    };
    const r = allocateCycleCosts({
      plan,
      campaigns: [
        campaign('a', 9, '2026-04-20T10:00:00Z'), // 6 포함 + 3 초과
        campaign('b', 3, '2026-04-21T10:00:00Z'), // 3 전부 초과
        campaign('c', 0, '2026-04-22T10:00:00Z'), // 초과분 0 (마지막 회차)
      ],
    });

    // 어떤 회차도 음수 cost 를 가지면 안 된다.
    expect(r.campaigns.every((c) => c.costKrw >= 0)).toBe(true);
    // 초과분 0인 마지막 회차는 정확히 0원.
    expect(r.campaigns[2]?.overageCount).toBe(0);
    expect(r.campaigns[2]?.costKrw).toBe(0);
    expect(r.campaigns[2]?.averageUnitPriceKrw).toBe(0);
    // 회차 cost 합 ≡ 사이클 총 초과비 (잔액 흡수 불변식 유지).
    const sumCosts = r.campaigns.reduce((acc, c) => acc + c.costKrw, 0);
    expect(sumCosts).toBe(r.overageCostKrw);
  });

  it('같은 startedAt 이면 campaignId 사전순 정렬', () => {
    const r = allocateCycleCosts({
      plan: PRO_50K,
      campaigns: [
        campaign('b', 25_000, '2026-04-20T10:00:00Z'),
        campaign('a', 30_000, '2026-04-20T10:00:00Z'),
      ],
    });
    expect(r.campaigns.map((c) => c.campaignId)).toEqual(['a', 'b']);
  });
});
