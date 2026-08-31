import { DailyParticipationChart } from '@/features/operations/daily-participation-chart';
import { DailyStatsTable } from '@/features/operations/daily-stats-table';
import { DropFunnel } from '@/features/operations/drop-funnel';
import { KpiRow } from '@/features/operations/kpi-row';
import { PageDwellDistribution } from '@/features/operations/page-dwell-distribution';
import { ResponseTimeStats } from '@/features/operations/response-time-stats';
import { kstTodayIsoDate } from '@/lib/date-formatters';
import { assertFieldworkSurveyPageAccess } from '@/server/page-fieldwork-access';
import {
  aggregateDaily,
  aggregateDailyAvailableDates,
} from '@/server/operations/services/aggregate-daily';
import { aggregateStatus } from '@/server/operations/services/aggregate-status';
import { getDailyStats } from '@/server/operations/services/daily-stats';
import { getDropFunnel } from '@/server/operations/services/drop-funnel';
import { getPageDwell } from '@/server/operations/services/page-dwell';
import { getResponseTime } from '@/server/operations/services/response-time';

import { EXTERNAL_VIEWER_DATA_SCOPE } from '@/server/data-scope';

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
 * 실사의 응답 현황 (.pen FLOW 10-2 탭, 스펙 §6 「응답 현황 대시보드·설문지 프리뷰 열람」).
 *
 * 운영 콘솔·게스트 콘솔과 **같은 위젯**을 같은 서비스 위에 얹는다 — 축약본을 따로 만들면
 * 세 화면의 숫자가 갈릴 때 어느 쪽이 맞는지 알 수 없다.
 *
 * 빠지는 것 둘이 이 화면의 정의다.
 *  - **엑셀 내보내기 버튼**: 실사에게 export 는 항상 차단이다(스펙 §8). 화면에 없고
 *    서버(`export.download` 미보유)에서도 막힌다.
 *  - **쿼터**: 실사 열에 쿼터 축이 없다. 게스트는 탭 화이트리스트로 열 수 있었지만
 *    실사에게는 그 축 자체가 없으므로 KPI 의 쿼터 칸을 언제나 비운다.
 *
 * 파티션은 **언제나 real** 이다 — 실사는 밖에서 실제 응답을 받는다.
 */
export default async function FieldworkOverviewPage({ params, searchParams }: Props) {
  const { surveyId } = await params;
  await assertFieldworkSurveyPageAccess(surveyId);

  const {
    mode = 'day',
    date,
    weekOffset: weekOffsetStr,
    dwellOffset: dwellOffsetStr,
  } = await searchParams;
  const weekOffset = Math.max(0, parseInt(weekOffsetStr ?? '0', 10) || 0);
  const dwellOffset = Math.max(0, parseInt(dwellOffsetStr ?? '0', 10) || 0);

  const availableDates = await aggregateDailyAvailableDates(surveyId, EXTERNAL_VIEWER_DATA_SCOPE);
  const latestAvailable =
    availableDates.length > 0 ? availableDates[availableDates.length - 1] : undefined;
  const effectiveDate = mode === 'hour' ? (date ?? latestAvailable ?? kstTodayIsoDate()) : undefined;

  const [statusCounts, dailyBuckets, dailyStats, responseTime, dropFunnel, pageDwell] =
    await Promise.all([
      aggregateStatus(surveyId, EXTERNAL_VIEWER_DATA_SCOPE),
      aggregateDaily({
        surveyId,
        scope: EXTERNAL_VIEWER_DATA_SCOPE,
        mode,
        ...(effectiveDate !== undefined ? { hourModeDate: effectiveDate } : {}),
      }),
      getDailyStats(surveyId, EXTERNAL_VIEWER_DATA_SCOPE),
      getResponseTime(surveyId, EXTERNAL_VIEWER_DATA_SCOPE),
      getDropFunnel(surveyId, EXTERNAL_VIEWER_DATA_SCOPE),
      getPageDwell(surveyId, EXTERNAL_VIEWER_DATA_SCOPE),
    ]);

  return (
    <main className="mx-auto max-w-[1100px] space-y-4 px-6 py-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900">응답 현황</h2>
        <p className="text-sm text-slate-500">
          응답자 진행 현황 · 일자별 추이 · 응답시간 통계 · 이탈 위치 분석
        </p>
      </div>

      <KpiRow counts={statusCounts} quota={null} />

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
