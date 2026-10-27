import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientOverviewScreen } from './overview-screen';

const svc = vi.hoisted(() => ({
  availableDates: vi.fn(async () => ['2026-10-26']),
  status: vi.fn(async () => ({})),
  daily: vi.fn(async () => []),
  dailyStats: vi.fn(async () => []),
  responseTime: vi.fn(async () => []),
  dropFunnel: vi.fn(async () => ({})),
  pageDwell: vi.fn(async () => ({})),
  quota: vi.fn(async () => null),
}));

vi.mock('@/server/operations/services/aggregate-daily', () => ({
  aggregateDaily: svc.daily,
  aggregateDailyAvailableDates: svc.availableDates,
}));
vi.mock('@/server/operations/services/aggregate-status', () => ({ aggregateStatus: svc.status }));
vi.mock('@/server/operations/services/daily-stats', () => ({ getDailyStats: svc.dailyStats }));
vi.mock('@/server/operations/services/response-time', () => ({
  getResponseTime: svc.responseTime,
}));
vi.mock('@/server/operations/services/drop-funnel', () => ({ getDropFunnel: svc.dropFunnel }));
vi.mock('@/server/operations/services/page-dwell', () => ({ getPageDwell: svc.pageDwell }));
vi.mock('@/server/quota/services/quota-status', () => ({ getQuotaStatus: svc.quota }));

// 위젯은 이름표만 그린다 — 여기서 보는 것은 「무엇을 그리는가」이지 위젯의 내용이 아니다.
vi.mock('@/features/operations/kpi-row', () => ({ KpiRow: () => <div>KPI</div> }));
vi.mock('@/features/operations/daily-participation-chart', () => ({
  DailyParticipationChart: () => <div>일자별 추이</div>,
}));
vi.mock('@/features/operations/daily-stats-table', () => ({
  DailyStatsTable: () => <div>일자별 통계표</div>,
}));
vi.mock('@/features/operations/response-time-stats', () => ({
  ResponseTimeStats: () => <div>응답시간 통계</div>,
}));
vi.mock('@/features/operations/drop-funnel', () => ({ DropFunnel: () => <div>이탈 위치</div> }));
vi.mock('@/features/operations/page-dwell-distribution', () => ({
  PageDwellDistribution: () => <div>페이지 체류시간</div>,
}));

const DETAIL_CARDS = ['일자별 통계표', '응답시간 통계', '이탈 위치', '페이지 체류시간'];

/**
 * 응답 현황 본문의 「상세 통계」 칩 (`.scratch/client-link-response-list` 티켓 02).
 *
 * 끄면 KPI·일자별 추이만 남는다 — 카드만 감추는 것이 아니라 **집계도 하지 않는다**(쿼터 칸과 같은
 * 규칙: 쓰지 않을 값을 읽지 않는다).
 */
describe('ClientOverviewScreen — 상세 통계', () => {
  beforeEach(() => vi.clearAllMocks());

  it('꺼져 있으면 KPI·일자별 추이만 그리고 상세 카드 넷은 그리지도 집계하지도 않는다', async () => {
    render(
      await ClientOverviewScreen({
        surveyId: 's-1',
        showQuota: false,
        showDetail: false,
        searchParams: {},
      }),
    );

    expect(screen.getByText('KPI')).toBeInTheDocument();
    expect(screen.getByText('일자별 추이')).toBeInTheDocument();
    for (const card of DETAIL_CARDS) expect(screen.queryByText(card)).not.toBeInTheDocument();
    expect(svc.dailyStats).not.toHaveBeenCalled();
    expect(svc.responseTime).not.toHaveBeenCalled();
    expect(svc.dropFunnel).not.toHaveBeenCalled();
    expect(svc.pageDwell).not.toHaveBeenCalled();
    // 머리 문구도 그린 것만 말한다.
    expect(screen.getByText('응답자 진행 현황 · 일자별 추이')).toBeInTheDocument();
  });

  it('켜져 있으면 지금처럼 전부 그린다', async () => {
    render(
      await ClientOverviewScreen({
        surveyId: 's-1',
        showQuota: false,
        showDetail: true,
        searchParams: {},
      }),
    );

    for (const card of DETAIL_CARDS) expect(screen.getByText(card)).toBeInTheDocument();
    expect(
      screen.getByText('응답자 진행 현황 · 일자별 추이 · 응답시간 통계 · 이탈 위치 분석'),
    ).toBeInTheDocument();
  });
});
