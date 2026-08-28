import { DailyParticipationChart } from '@/features/operations/daily-participation-chart';
import { DailyStatsTable } from '@/features/operations/daily-stats-table';
import { DropFunnel } from '@/features/operations/drop-funnel';
import { KpiRow } from '@/features/operations/kpi-row';
import { PageDwellDistribution } from '@/features/operations/page-dwell-distribution';
import { ResponseTimeStats } from '@/features/operations/response-time-stats';
import { kstTodayIsoDate } from '@/lib/date-formatters';
import { assertGuestSurveyPageAccess } from '@/server/page-guest-access';
import {
  aggregateDaily,
  aggregateDailyAvailableDates,
} from '@/server/operations/services/aggregate-daily';
import { aggregateStatus } from '@/server/operations/services/aggregate-status';
import { getDailyStats } from '@/server/operations/services/daily-stats';
import { getDropFunnel } from '@/server/operations/services/drop-funnel';
import { getPageDwell } from '@/server/operations/services/page-dwell';
import { getQuotaStatus } from '@/server/quota/services/quota-status';
import { getResponseTime } from '@/server/operations/services/response-time';

import { GUEST_DATA_SCOPE } from '@/server/data-scope';

interface Props {
  params: Promise<{ surveyId: string }>;
  searchParams: Promise<{
    mode?: 'day' | 'hour';
    date?: string;
    weekOffset?: string;
    dwellOffset?: string;
  }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '응답 현황' };

/**
 * 응답 현황 (.pen FLOW 5-3, 스펙 §5 「응답 현황 (KPI·추이·일자별 표 대시보드 통째)」).
 *
 * 운영 콘솔 overview 와 **같은 위젯**을 같은 서비스 위에 얹는다 — 스펙이 「대시보드 통째」라
 * 적었고, 게스트용 축약본을 따로 만들면 두 화면의 숫자가 갈릴 때 어느 쪽이 맞는지 알 수 없다.
 *
 * 빠지는 것 셋이 이 화면의 정의다.
 *  - **엑셀 내보내기 버튼**: 게스트에게 export 는 항상 차단이다(스펙 §5). 화면에 없고
 *    서버(`export.download` 미보유)에서도 막힌다.
 *  - **쿼터**: 현황판도 KPI 의 쿼터 칸도 「쿼터 현황」 탭이 켜졌을 때만 채운다. 그 칸은
 *    목표치·달성률·마감 셀 수를 그리는데, 스펙 §5 의 탭 표가 쿼터를 **기본 OFF 의 별개
 *    항목**으로 두므로 응답 현황만 허용된 게스트에게 보이면 화이트리스트를 우회한 것이다.
 *    현황판 자체는 이 화면에 없다 — 그것은 쿼터 탭의 내용이다.
 *  - **응답자 문의 카드**: 백엔드가 없는 자리표시자다(운영 콘솔의 InquiriesEmptyCard).
 */
export default async function GuestOverviewPage({ params, searchParams }: Props) {
  const { surveyId } = await params;
  const { tabs } = await assertGuestSurveyPageAccess(surveyId, 'overview');

  const {
    mode = 'day',
    date,
    weekOffset: weekOffsetStr,
    dwellOffset: dwellOffsetStr,
  } = await searchParams;
  const weekOffset = Math.max(0, parseInt(weekOffsetStr ?? '0', 10) || 0);
  const dwellOffset = Math.max(0, parseInt(dwellOffsetStr ?? '0', 10) || 0);

  const availableDates = await aggregateDailyAvailableDates(surveyId, GUEST_DATA_SCOPE);
  const latestAvailable =
    availableDates.length > 0 ? availableDates[availableDates.length - 1] : undefined;
  const effectiveDate = mode === 'hour' ? (date ?? latestAvailable ?? kstTodayIsoDate()) : undefined;

  const [statusCounts, dailyBuckets, dailyStats, responseTime, dropFunnel, pageDwell, quotaStatus] =
    await Promise.all([
      aggregateStatus(surveyId, GUEST_DATA_SCOPE),
      aggregateDaily({
        surveyId,
        scope: GUEST_DATA_SCOPE,
        mode,
        ...(effectiveDate !== undefined ? { hourModeDate: effectiveDate } : {}),
      }),
      getDailyStats(surveyId, GUEST_DATA_SCOPE),
      getResponseTime(surveyId, GUEST_DATA_SCOPE),
      getDropFunnel(surveyId, GUEST_DATA_SCOPE),
      getPageDwell(surveyId, GUEST_DATA_SCOPE),
      // 쿼터 탭이 꺼져 있으면 조회 자체를 하지 않는다 — 쓰지 않을 값을 읽지 않는다.
      tabs.quota ? getQuotaStatus(surveyId, GUEST_DATA_SCOPE) : null,
    ]);

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-6 py-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900">응답 현황</h2>
        <p className="text-sm text-slate-500">
          응답자 진행 현황 · 일자별 추이 · 응답시간 통계 · 이탈 위치 분석
        </p>
      </div>

      <KpiRow counts={statusCounts} quota={quotaStatus?.summary ?? null} />

      <DailyParticipationChart
        data={dailyBuckets}
        mode={mode}
        {...(effectiveDate !== undefined ? { hourModeDate: effectiveDate } : {})}
        availableDates={availableDates}
        weekOffset={weekOffset}
      />

      <DailyStatsTable data={dailyStats} />
      <ResponseTimeStats data={responseTime} />
      <DropFunnel data={dropFunnel} />
      <PageDwellDistribution data={pageDwell} pageOffset={dwellOffset} />
    </main>
  );
}
