import { ExportDataModal } from '@/features/analytics/export-data-modal';
import { DailyParticipationChart } from '@/features/operations/daily-participation-chart';
import { DailyStatsTable } from '@/features/operations/daily-stats-table';
import { DropFunnel } from '@/features/operations/drop-funnel';
import { InquiriesEmptyCard } from '@/features/operations/inquiries-empty-card';
import { KpiRow } from '@/features/operations/kpi-row';
import { PageDwellDistribution } from '@/features/operations/page-dwell-distribution';
import { QuotaStatusPanel } from '@/features/operations/quota/quota-status-panel';
import { ResponseTimeStats } from '@/features/operations/response-time-stats';
import { kstTodayIsoDate } from '@/lib/date-formatters';
import type { OperationsDataScope } from '@/server/data-scope';
import {
  aggregateDaily,
  aggregateDailyAvailableDates,
} from '@/server/operations/services/aggregate-daily';
import { aggregateStatus } from '@/server/operations/services/aggregate-status';
import { getDailyStats } from '@/server/operations/services/daily-stats';
import { getDropFunnel } from '@/server/operations/services/drop-funnel';
import { getPageDwell } from '@/server/operations/services/page-dwell';
import { getResponseTime } from '@/server/operations/services/response-time';
import { getQuotaStatus } from '@/server/quota/services/quota-status';
import { getSurveyById } from '@/server/survey-builder/services/survey-read';
import type { SurveyCapability } from '@/shared/contracts/workspace';

/**
 * 응답 현황 화면의 본문 — 내부 콘솔(`app/(internal)`)과 외주 실사 링크 트리가 함께 쓰는 **한 벌**
 * (ADR-0026, 티켓 06·07).
 *
 * ## 왜 app 층에 사는가
 *
 * 이 조립은 **여러 서버 도메인을 가로질러 읽는다**(operations 집계 + quota 현황 +
 * survey-builder 의 설문 제목). 도메인끼리는 서로를 import 할 수 없고(ESLint), UI 는
 * `@/server` 를 전혀 import 할 수 없다 — 그래서 남는 집이 app 층뿐이다. 선례는 Raw 행
 * 조립(`api/surveys/[surveyId]/export/raw-export-load.ts`)이 라우트 폴더 로컬로 사는 것과
 * 같다. `_` 접두 폴더는 Next 라우팅에서 제외된다.
 *
 * 형제인 조사 대상 목록은 여기 없다 — 그쪽은 조립이 read-model 하나로 닫혀
 * (`server/read-models/contacts-list-page`) UI 를 그대로 feature 로 올릴 수 있었다.
 * **가로질러 읽는 화면만 이 폴더에 온다.**
 *
 * ## 트리마다 다른 것
 *
 * `basePath` 는 쓰지 않는다(이 화면이 만드는 주소가 없다). 갈리는 것은 둘뿐이다.
 *  - `capabilities` — 내보내기 모달이 `export.download` 로 갈린다. 예전에는
 *    `isExternalViewer()`(계정 유형)로 물었는데, 그 문은 계정을 요구하므로 링크 세션에서
 *    던진다. 판정 결과로 물으면 주체 종류가 늘어도 이 줄은 그대로다.
 *  - `scope` — 링크는 언제나 real 파티션이다(스펙 §11-3).
 *
 * 쿼터 현황판은 **감추지 않는다.** 외주가 보는 숫자는 연구원이 보는 것과 같아야 하고
 * (스토리 34), 남은 목표치는 실사 배분에 직접 쓰이는 값이다. 쿼터 **탭**(플랜 편집)이
 * 링크에 안 서는 것과 다른 축이다 — 저쪽은 내부 셸 전용 화면이다.
 */
export interface OperationsOverviewSearchParams {
  mode?: 'day' | 'hour';
  date?: string;
  weekOffset?: string;
  dwellOffset?: string;
}

interface Props {
  surveyId: string;
  capabilities: ReadonlySet<SurveyCapability>;
  scope: OperationsDataScope;
  searchParams: OperationsOverviewSearchParams;
}

export async function OperationsOverviewScreen({
  surveyId,
  capabilities,
  scope,
  searchParams,
}: Props) {
  const { mode = 'day', date, weekOffset: weekOffsetStr, dwellOffset: dwellOffsetStr } = searchParams;
  const weekOffset = Math.max(0, parseInt(weekOffsetStr ?? '0', 10) || 0);
  const dwellOffset = Math.max(0, parseInt(dwellOffsetStr ?? '0', 10) || 0);

  // hour 모드 진입 시 date 미지정이면 응답이 있는 가장 최근 일자, 응답 자체가 없으면 KST 오늘로
  // fallback. 어댑터가 effectiveDate 없는 hour 모드에서 throw 하지 않도록 보장.
  const availableDates = await aggregateDailyAvailableDates(surveyId, scope);
  const latestAvailable =
    availableDates.length > 0 ? availableDates[availableDates.length - 1] : undefined;
  const effectiveDate = mode === 'hour' ? (date ?? latestAvailable ?? kstTodayIsoDate()) : undefined;

  const canExport = capabilities.has('export.download');

  const [
    statusCounts,
    dailyBuckets,
    dailyStats,
    responseTime,
    dropFunnel,
    pageDwell,
    quotaStatus,
    survey,
  ] = await Promise.all([
    aggregateStatus(surveyId, scope),
    aggregateDaily({
      surveyId,
      scope,
      mode,
      ...(effectiveDate !== undefined ? { hourModeDate: effectiveDate } : {}),
    }),
    getDailyStats(surveyId, scope),
    getResponseTime(surveyId, scope),
    getDropFunnel(surveyId, scope),
    getPageDwell(surveyId, scope),
    // 테스트 모드에서도 테스트 응답 기준으로 집계해 보여준다(표시 전용 — 집행은 실응답만).
    getQuotaStatus(surveyId, scope),
    // 내보내기 모달의 제목 말고는 쓰지 않는다 — 그릴 일이 없으면 읽지도 않는다.
    canExport ? getSurveyById(surveyId) : null,
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
        {/* analytics 대시보드와 동일한 내보내기 모달 — RawData·SPSS·분할 다운로드. */}
        {canExport && <ExportDataModal surveyId={surveyId} surveyTitle={survey?.title ?? '설문'} />}
      </div>

      <KpiRow counts={statusCounts} quota={quotaStatus?.summary ?? null} />

      {/* 플랜이 있으면 셀이 비어 있어도 그린다 — 카드 안에서 "목표 없음" 을 안내한다 */}
      {quotaStatus && <QuotaStatusPanel status={quotaStatus} isTestScope={scope === 'test'} />}

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
