import 'server-only';

import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { mailBillingPeriods, mailCampaigns, mailRecipients, surveys } from '@/db/schema';
import type { MailCampaignStatus, MailRecipientStatus } from '@/db/schema/mail';
import { allocateCycleCosts, type AllocatorInputCampaign } from '@/lib/mail/billing-allocator';
import {
  cycleStartFor,
  findPeriodFor,
  kstYmd,
  nextCycleStart,
  toPeriodSpecs,
} from '@/lib/mail/billing-cycles';

/**
 * Resend 청구 카운트 — webhook 으로 적재된 mail_recipients.status 에서 'sent' 이상.
 *
 * Resend 는 발송 시도(=email.sent)에 청구하므로, sent 이후 status 는 모두 청구된 메일.
 * 'queued' 만 청구 외, 'skipped_unsubscribed' / 'failed' 는 API 호출 자체가 없거나 거부된 케이스.
 *
 * GET /emails 폴링은 사용하지 않는다 — webhook 적재가 단일 진실원.
 */
const BILLABLE_STATUSES: readonly MailRecipientStatus[] = [
  'sent',
  'delivered',
  'opened',
  'bounced',
  'complained',
];

export interface CampaignCycleRow {
  campaignId: string;
  surveyId: string;
  surveyTitle: string;
  runNumber: number;
  title: string;
  status: MailCampaignStatus;
  startedAt: Date;
  completedAt: Date | null;
  billableCount: number;
  includedCount: number;
  overageCount: number;
  costKrw: number;
  averageUnitPriceKrw: number;
  isTest: boolean;
  archivedAt: Date | null;
}

export interface CycleSummary {
  cycleKey: string;
  startedAt: Date;
  endsAt: Date;
  startLabel: string;
  endLabel: string;
  planLabel: string;
  billingDayOfMonth: number;
  includedEmails: number;
  overagePer1kKrw: number;
  isCurrent: boolean;
  totalBillable: number;
  totalIncluded: number;
  totalOverage: number;
  overageCostKrw: number;
  monthlyFeeKrw: number;
  totalCostKrw: number;
  campaigns: CampaignCycleRow[];
}

export interface BillingPeriodRow {
  id: string;
  startDate: string;
  billingDayOfMonth: number;
  planLabel: string;
  monthlyFeeKrw: number;
  includedEmails: number;
  overagePer1kKrw: number;
  note: string | null;
  createdAt: Date;
}

export interface BillingBreakdown {
  periods: BillingPeriodRow[];
  /** mail_billing_periods 가 비어있어 fallback period 사용 중이면 true. */
  usingFallbackPeriod: boolean;
  cycles: CycleSummary[]; // 최신 순
}

export async function listBillingPeriods(): Promise<BillingPeriodRow[]> {
  const rows = await db
    .select({
      id: mailBillingPeriods.id,
      startDate: mailBillingPeriods.startDate,
      billingDayOfMonth: mailBillingPeriods.billingDayOfMonth,
      planLabel: mailBillingPeriods.planLabel,
      monthlyFeeKrw: mailBillingPeriods.monthlyFeeKrw,
      includedEmails: mailBillingPeriods.includedEmails,
      overagePer1kKrw: mailBillingPeriods.overagePer1kKrw,
      note: mailBillingPeriods.note,
      createdAt: mailBillingPeriods.createdAt,
    })
    .from(mailBillingPeriods)
    .orderBy(asc(mailBillingPeriods.startDate));
  return rows;
}

export async function computeCycleBreakdown(): Promise<BillingBreakdown> {
  const periodRows = await listBillingPeriods();
  const periods = toPeriodSpecs(periodRows);
  const usingFallbackPeriod = periodRows.length === 0;

  const campaignRows = await db
    .select({
      id: mailCampaigns.id,
      surveyId: mailCampaigns.surveyId,
      surveyTitle: surveys.title,
      runNumber: mailCampaigns.runNumber,
      title: mailCampaigns.title,
      status: mailCampaigns.status,
      startedAt: mailCampaigns.startedAt,
      completedAt: mailCampaigns.completedAt,
      isTest: mailCampaigns.isTest,
      archivedAt: mailCampaigns.archivedAt,
    })
    .from(mailCampaigns)
    .innerJoin(surveys, eq(mailCampaigns.surveyId, surveys.id))
    .where(isNotNull(mailCampaigns.startedAt))
    .orderBy(asc(mailCampaigns.startedAt));

  if (campaignRows.length === 0) {
    return { periods: periodRows, usingFallbackPeriod, cycles: [] };
  }

  const campaignIds = campaignRows.map((r) => r.id);

  // 청구 대상 카운트 — webhook 적재된 mail_recipients.status 기반.
  const billableRows = await db
    .select({
      campaignId: mailRecipients.campaignId,
      billable: sql<number>`count(*)::int`,
    })
    .from(mailRecipients)
    .where(
      and(
        inArray(mailRecipients.campaignId, campaignIds),
        inArray(mailRecipients.status, [...BILLABLE_STATUSES]),
      ),
    )
    .groupBy(mailRecipients.campaignId);

  const billableByCampaignId = new Map<string, number>();
  for (const r of billableRows) billableByCampaignId.set(r.campaignId, r.billable);

  // 사이클 그룹핑.
  type CampaignEnriched = (typeof campaignRows)[number] & { billableCount: number };
  interface CycleGroup {
    startedAt: Date;
    endsAt: Date;
    planLabel: string;
    billingDay: number;
    includedEmails: number;
    monthlyFeeKrw: number;
    overagePer1kKrw: number;
    campaigns: CampaignEnriched[];
  }
  const groups = new Map<string, CycleGroup>();
  for (const c of campaignRows) {
    if (!c.startedAt) continue;
    const cycleStart = cycleStartFor(c.startedAt, periods);
    const cycleEnd = nextCycleStart(cycleStart, periods);
    const period = findPeriodFor(cycleStart, periods);
    const key = cycleStart.toISOString();
    const enriched: CampaignEnriched = {
      ...c,
      billableCount: billableByCampaignId.get(c.id) ?? 0,
    };
    const existing = groups.get(key);
    if (existing) {
      existing.campaigns.push(enriched);
    } else {
      groups.set(key, {
        startedAt: cycleStart,
        endsAt: cycleEnd,
        planLabel: period.planLabel,
        billingDay: period.billingDay,
        includedEmails: period.includedEmails,
        monthlyFeeKrw: period.monthlyFeeKrw,
        overagePer1kKrw: period.overagePer1kKrw,
        campaigns: [enriched],
      });
    }
  }

  const now = new Date();
  const cycles: CycleSummary[] = [];
  for (const [cycleKey, group] of groups) {
    const allocatorInput: AllocatorInputCampaign[] = group.campaigns.map((c) => ({
      campaignId: c.id,
      billableCount: c.billableCount,
      startedAt: c.startedAt!,
    }));
    const allocation = allocateCycleCosts({
      plan: {
        includedEmails: group.includedEmails,
        monthlyFeeKrw: group.monthlyFeeKrw,
        overagePer1kKrw: group.overagePer1kKrw,
      },
      campaigns: allocatorInput,
    });
    const allocByCampaign = new Map(allocation.campaigns.map((a) => [a.campaignId, a]));

    const campaignRowsOut: CampaignCycleRow[] = group.campaigns
      .map((c) => {
        const a = allocByCampaign.get(c.id);
        return {
          campaignId: c.id,
          surveyId: c.surveyId,
          surveyTitle: c.surveyTitle,
          runNumber: c.runNumber,
          title: c.title,
          status: c.status as MailCampaignStatus,
          startedAt: c.startedAt!,
          completedAt: c.completedAt,
          billableCount: a?.billableCount ?? c.billableCount,
          includedCount: a?.includedCount ?? 0,
          overageCount: a?.overageCount ?? 0,
          costKrw: a?.costKrw ?? 0,
          averageUnitPriceKrw: a?.averageUnitPriceKrw ?? 0,
          isTest: c.isTest,
          archivedAt: c.archivedAt,
        };
      })
      .sort((x, y) => x.startedAt.getTime() - y.startedAt.getTime());

    const isCurrent =
      now.getTime() >= group.startedAt.getTime() && now.getTime() < group.endsAt.getTime();

    cycles.push({
      cycleKey,
      startedAt: group.startedAt,
      endsAt: group.endsAt,
      startLabel: kstYmd(group.startedAt),
      endLabel: kstYmd(new Date(group.endsAt.getTime() - 24 * 60 * 60 * 1000)),
      planLabel: group.planLabel,
      billingDayOfMonth: group.billingDay,
      includedEmails: group.includedEmails,
      overagePer1kKrw: group.overagePer1kKrw,
      isCurrent,
      totalBillable: allocation.totalBillable,
      totalIncluded: allocation.totalIncluded,
      totalOverage: allocation.totalOverage,
      overageCostKrw: allocation.overageCostKrw,
      monthlyFeeKrw: group.monthlyFeeKrw,
      totalCostKrw: allocation.totalCostKrw,
      campaigns: campaignRowsOut,
    });
  }

  cycles.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return { periods: periodRows, usingFallbackPeriod, cycles };
}
