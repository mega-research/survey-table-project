import type { Metadata } from 'next';

import { ExportDataModal } from '@/components/analytics/export-data-modal';
import { DailyParticipationChart } from '@/components/operations/daily-participation-chart';
import { DailyStatsTable } from '@/components/operations/daily-stats-table';
import { DropFunnel } from '@/components/operations/drop-funnel';
import { InquiriesEmptyCard } from '@/components/operations/inquiries-empty-card';
import { KpiRow } from '@/components/operations/kpi-row';
import { PageDwellDistribution } from '@/components/operations/page-dwell-distribution';
import { QuotaStatusPanel } from '@/components/operations/quota/quota-status-panel';
import { ResponseTimeStats } from '@/components/operations/response-time-stats';
import {
  aggregateDaily,
  aggregateDailyAvailableDates,
} from '@/lib/operations/aggregate-daily.server';
import { aggregateStatus } from '@/lib/operations/aggregate-status.server';
import { getDailyStats } from '@/lib/operations/daily-stats.server';
import { getDropFunnel } from '@/lib/operations/drop-funnel.server';
import { getPageDwell } from '@/lib/operations/page-dwell.server';
import { getQuotaStatus } from '@/lib/operations/quota-status.server';
import { getResponseTime } from '@/lib/operations/response-time.server';
import { getOperationsDataScope } from '@/lib/operations/data-scope.server';
import { getSurveyById } from '@/features/survey-builder/server/services/survey-read.service';

/**
 * 플랜 §9 정책 — 30초 자동 폴링 의도.
 *
 * 본 라우트는 `searchParams` 를 사용하므로 Next.js 16 의 동적 렌더 규칙상
 * 매 요청 RSC 가 재평가된다 → `revalidate` 는 동적 라우트에서는 사실상 무력화되며
 * ISR 캐시가 활성화된 환경에서만 의미를 갖는다.
 *
 * 사용자 체감 갱신은 (a) 페이지 진입/네비게이션 (b) `<RefreshButton />` 의
 * `router.refresh()` 두 경로로 보장된다. 향후 정적/캐시 환경에서 의미를 살리기
 * 위해 의도값은 보존한다.
 */
export const revalidate = 30;

export const metadata: Metadata = {
  title: '현황 - 응답 진행 현황',
};

interface OperationsOverviewPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    mode?: 'day' | 'hour';
    date?: string;
    weekOffset?: string;
    dwellOffset?: string;
  }>;
}

/**
 * KST(Asia/Seoul) 기준 오늘 일자를 'YYYY-MM-DD' 로 반환.
 * `availableDates` 가 비어 있는 hour 모드 진입 시 fallback 으로 사용한다.
 */
function todayKst(): string {
  const now = new Date();
  // ko-KR 로케일은 'YYYY. MM. DD.' 형태로 반환되므로 정규화해서 'YYYY-MM-DD' 로 만든다.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now); // en-CA → 'YYYY-MM-DD'
}

/**
 * 현황 콘솔 — Fieldwork report 진입 페이지.
 *
 * 슬라이스 1 의 7개 위젯을 모두 마운트한다 (A1 KPI → A2 일자별 차트 →
 * A3 일자별 통계 → A4 응답시간 → A5 Drop funnel → A6 Page dwell →
 * Inquiries placeholder). 계획 3 에서 쿼터 진행 카드(A1 옆) + 쿼터 현황판을 추가한다.
 *
 * - 7개 어댑터를 `Promise.all` 로 병렬 호출.
 * - hour 모드에서 `date` 미지정 시 응답이 존재하는 가장 최근 일자(KST)로 자동 결정.
 *   응답이 전무하면 KST 오늘 일자로 fallback (어댑터의 `hourModeDate` 필수 조건 충족).
 * - 설문이 존재하지 않거나 soft-delete 된 경우 `notFound()` (D-7 전용 UI 는 후속 작업).
 * - `getQuotaStatus`는 쿼터 미설정 설문에서 null을 반환 — 이 경우 KPI 쿼터 카드는 '-'를 표시하고 현황판만 생략.
 */
export default async function OperationsOverviewPage({
  params,
  searchParams,
}: OperationsOverviewPageProps) {
  const { id: surveyId } = await params;
  const { mode = 'day', date, weekOffset: weekOffsetStr, dwellOffset: dwellOffsetStr } = await searchParams;
  const weekOffset = Math.max(0, parseInt(weekOffsetStr ?? '0', 10) || 0);
  const dwellOffset = Math.max(0, parseInt(dwellOffsetStr ?? '0', 10) || 0);

  // hour 모드 진입 시 date 미지정이면 응답이 있는 가장 최근 일자, 응답 자체가 없으면 KST 오늘로
  // fallback. 어댑터가 effectiveDate 없는 hour 모드에서 throw 하지 않도록 보장.
  const scope = await getOperationsDataScope(surveyId);
  const availableDates = await aggregateDailyAvailableDates(surveyId, scope);
  const latestAvailable =
    availableDates.length > 0 ? availableDates[availableDates.length - 1] : undefined;
  const effectiveDate =
    mode === 'hour' ? (date ?? latestAvailable ?? todayKst()) : undefined;

  const [statusCounts, dailyBuckets, dailyStats, responseTime, dropFunnel, pageDwell, quotaStatus, survey] =
    await Promise.all([
      aggregateStatus(surveyId, scope),
      aggregateDaily({ surveyId, scope, mode, ...(effectiveDate !== undefined ? { hourModeDate: effectiveDate } : {}) }),
      getDailyStats(surveyId, scope),
      getResponseTime(surveyId, scope),
      getDropFunnel(surveyId, scope),
      getPageDwell(surveyId, scope),
      scope === 'test' ? Promise.resolve(null) : getQuotaStatus(surveyId),
      getSurveyById(surveyId),
    ]);

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-6 py-8">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">응답 현황</h2>
          <p className="text-sm text-slate-500">
            응답자 진행 현황 · 일자별 추이 · 응답시간 통계 · 이탈 위치 분석
          </p>
        </div>
        {/* analytics 대시보드와 동일한 내보내기 모달 — RawData·SPSS·분할 다운로드 */}
        <ExportDataModal surveyId={surveyId} surveyTitle={survey?.title ?? '설문'} />
      </div>

      <KpiRow counts={statusCounts} quota={quotaStatus?.summary ?? null} />

      {quotaStatus && quotaStatus.cells.length > 0 && <QuotaStatusPanel status={quotaStatus} />}

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

      {/* 응답자 문의사항 (백엔드 미구현 — 슬라이스 1 범위 외) */}
      <InquiriesEmptyCard />
    </main>
  );
}
