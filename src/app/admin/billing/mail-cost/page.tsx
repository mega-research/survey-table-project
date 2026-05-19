import { Receipt } from 'lucide-react';

import { BackButton } from '@/components/operations/mail-cost/back-button';
import { BillingPeriodsDialog } from '@/components/operations/mail-cost/billing-periods-dialog';
import {
  CostDisclaimer,
  EmptyPeriodsNotice,
} from '@/components/operations/mail-cost/cost-disclaimer';
import { CycleSelector } from '@/components/operations/mail-cost/cycle-selector';
import { CycleSummaryTable } from '@/components/operations/mail-cost/cycle-summary-table';
import { Card } from '@/components/ui/card';
import { computeCycleBreakdown } from '@/lib/operations/mail-billing.server';

interface Props {
  searchParams: Promise<{ cycle?: string }>;
}

export default async function GlobalMailCostPage({ searchParams }: Props) {
  const { cycle: cycleKey } = await searchParams;
  const { periods, usingFallbackPeriod, cycles } = await computeCycleBreakdown();

  const selected = cycles.find((c) => c.cycleKey === cycleKey) ?? cycles[0];
  // disclaimer 에 표시할 plan: 선택된 사이클의 plan → 없으면 가장 최근 등록된 period.
  const planForDisclaimer = selected ?? periods[periods.length - 1];

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-4">
            <BackButton />
            <div className="h-6 w-px bg-gray-300" />
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-blue-500" />
              <h1 className="text-lg font-medium text-gray-900">메일 발송 비용 정산</h1>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {usingFallbackPeriod ? (
          <EmptyPeriodsNotice />
        ) : (
          <CostDisclaimer
            planLabel={planForDisclaimer?.planLabel}
            monthlyFeeKrw={planForDisclaimer?.monthlyFeeKrw}
            includedEmails={planForDisclaimer?.includedEmails}
            overagePer1kKrw={planForDisclaimer?.overagePer1kKrw}
          />
        )}

        <div className="flex items-center justify-between gap-3">
          {cycles.length > 0 ? (
            <CycleSelector
              value={selected?.cycleKey ?? ''}
              options={cycles.map((c) => ({
                cycleKey: c.cycleKey,
                startLabel: c.startLabel,
                endLabel: c.endLabel,
                isCurrent: c.isCurrent,
                totalCostKrw: c.totalCostKrw,
              }))}
            />
          ) : (
            <div />
          )}
          <BillingPeriodsDialog periods={periods} />
        </div>

        {cycles.length === 0 ? (
          <Card className="border-dashed">
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-gray-500">
                아직 발송된 메일이 없습니다. 첫 메일을 발송하면 이 페이지에 정산이 표시됩니다.
              </p>
            </div>
          </Card>
        ) : (
          selected && <CycleSummaryTable cycle={selected} />
        )}
      </main>
    </div>
  );
}
