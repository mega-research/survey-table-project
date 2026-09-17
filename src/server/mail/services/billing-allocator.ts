/**
 * 사이클 내 단체 메일을 발송 순으로 정렬해 사이클 한도 안에서 포함분/초과분으로 분배한다.
 *
 * 핵심 정책:
 *  - 단체 메일 정렬: `startedAt ASC`. 같은 시각이면 `campaignId` 사전순.
 *  - 누적 한도까지는 포함분(0원), 그 이후는 초과분 (per-1K KRW 단가).
 *  - 라운딩: 사이클 총 초과비 = round(sum(overage_count * per1k) / 1000) 을 먼저 확정 → 회차별 round 후
 *    sum(회차) 와 사이클 총 사이의 차이(drift)를 초과분이 있는 회차가 흡수. 양수는 마지막 초과 회차가,
 *    음수는 초과 회차에서 차감하되 회차별 0 clamp 후 잔여분을 다음 초과 회차로 이월. 모든 회차 cost>=0 +
 *    회차 합 ≡ 사이클 합 보장.
 *  - 빈 단체 메일 입력은 비용 0.
 */

export interface AllocatorInputCampaign {
  campaignId: string;
  /** 청구 대상 인원수 (mail_recipients.status IN (delivered|opened|bounced|complained) COUNT). */
  billableCount: number;
  /** 사이클 매핑에 사용된 시각. 정렬 키. */
  startedAt: Date;
}

export interface AllocatorInputPlan {
  includedEmails: number;
  monthlyFeeKrw: number;
  overagePer1kKrw: number;
}

export interface AllocatedCampaign extends AllocatorInputCampaign {
  /** 사이클 한도 안에 들어간 인원수. */
  includedCount: number;
  /** 한도 초과 인원수. */
  overageCount: number;
  /** 이 단체 메일이 부담하는 초과 비용 (원). */
  costKrw: number;
  /** 평균 단가 = costKrw / billableCount (billableCount=0 이면 0). */
  averageUnitPriceKrw: number;
}

export interface CycleAllocation {
  /** 사이클 내 모든 단체 메일의 청구 대상 합. */
  totalBillable: number;
  /** 포함분 인원수 합 (≤ plan.includedEmails). */
  totalIncluded: number;
  /** 초과 인원수 합. */
  totalOverage: number;
  /** 초과 비용 합 (원). */
  overageCostKrw: number;
  /** 월 구독료 + 초과 비용 (원). */
  totalCostKrw: number;
  /** 분배 결과. 입력과 동일한 정렬(startedAt ASC). */
  campaigns: AllocatedCampaign[];
}

export function allocateCycleCosts(args: {
  plan: AllocatorInputPlan;
  campaigns: readonly AllocatorInputCampaign[];
}): CycleAllocation {
  const { plan, campaigns } = args;

  const sorted = [...campaigns].sort((a, b) => {
    const da = a.startedAt.getTime();
    const db = b.startedAt.getTime();
    if (da !== db) return da - db;
    return a.campaignId.localeCompare(b.campaignId);
  });

  // 1차 패스: 포함/초과 인원수 산정.
  let remaining = Math.max(0, plan.includedEmails);
  const breakdown: Array<{
    src: AllocatorInputCampaign;
    included: number;
    overage: number;
  }> = [];
  let totalBillable = 0;
  let totalIncluded = 0;
  let totalOverage = 0;

  for (const c of sorted) {
    const billable = Math.max(0, c.billableCount);
    totalBillable += billable;
    let included = 0;
    let overage = 0;
    if (remaining >= billable) {
      included = billable;
      remaining -= billable;
    } else if (remaining > 0) {
      included = remaining;
      overage = billable - remaining;
      remaining = 0;
    } else {
      overage = billable;
    }
    totalIncluded += included;
    totalOverage += overage;
    breakdown.push({ src: c, included, overage });
  }

  // 사이클 총 초과비를 micros 합계 후 한 번만 round → 회차 합과 정확히 일치.
  const per1k = Math.max(0, plan.overagePer1kKrw);
  const cycleOverageMicros = totalOverage * per1k; // overageCount × per-1K
  const cycleOverageKrw = Math.round(cycleOverageMicros / 1000);

  // 2차 패스: 회차별 round 후 잔액 흡수.
  // 잔액은 "실제 초과분이 있는 회차"만 흡수한다. 초과분이 0인 회차에
  // drift 를 넣으면 그 회차 costKrw 가 양/음으로 흔들려 청구 UI 에 노출되므로 금지.
  const preliminary = breakdown.map((b) => Math.round((b.overage * per1k) / 1000));
  if (preliminary.length > 0) {
    const sumPreliminary = preliminary.reduce((a, b) => a + b, 0);
    let drift = cycleOverageKrw - sumPreliminary;
    if (drift !== 0) {
      // 초과분이 있는 회차 인덱스 (뒤에서 앞 순서).
      const overageIdx: number[] = [];
      for (let i = breakdown.length - 1; i >= 0; i -= 1) {
        if ((breakdown[i]?.overage ?? 0) > 0) overageIdx.push(i);
      }
      if (drift > 0) {
        // 양수 drift 는 마지막 초과 회차가 전부 흡수해도 음수가 될 수 없다.
        const idx = overageIdx[0];
        if (idx !== undefined) {
          preliminary[idx] = (preliminary[idx] ?? 0) + drift;
          drift = 0;
        }
      } else {
        // 음수 drift 는 초과 회차에서 차감하되 회차별로 0 에서 clamp 하고
        // 남는 음수 drift 를 다음 초과 회차로 이월(redistribute)한다.
        // cycleOverageKrw >= 0 + sum(preliminary) >= |drift| 이므로 항상 0 으로 수렴.
        for (const idx of overageIdx) {
          if (drift === 0) break;
          const current = preliminary[idx] ?? 0;
          const applied = Math.max(current + drift, 0);
          drift += current - applied; // 0 으로 clamp 되어 남은 음수만큼 다음으로 이월.
          preliminary[idx] = applied;
        }
      }
    }
  }

  const allocated: AllocatedCampaign[] = breakdown.map((b, i) => {
    const costKrw = preliminary[i] ?? 0;
    const averageUnitPriceKrw = b.src.billableCount > 0
      ? Math.round(costKrw / b.src.billableCount)
      : 0;
    return {
      campaignId: b.src.campaignId,
      billableCount: b.src.billableCount,
      startedAt: b.src.startedAt,
      includedCount: b.included,
      overageCount: b.overage,
      costKrw,
      averageUnitPriceKrw,
    };
  });

  return {
    totalBillable,
    totalIncluded,
    totalOverage,
    overageCostKrw: cycleOverageKrw,
    totalCostKrw: Math.max(0, plan.monthlyFeeKrw) + cycleOverageKrw,
    campaigns: allocated,
  };
}
