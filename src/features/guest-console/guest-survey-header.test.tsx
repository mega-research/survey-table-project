import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useSelectedLayoutSegment: () => 'overview' }));

import { DEFAULT_SURVEY_GUEST_TABS } from '@/shared/contracts/workspace';

import { GuestSurveyHeader } from './guest-survey-header';

function renderHeader(over: Partial<Parameters<typeof GuestSurveyHeader>[0]> = {}) {
  return render(
    <GuestSurveyHeader
      basePath="/guest/surveys/s-1"
      backHref="/guest"
      title="고객 만족도 조사"
      publishedAt={new Date('2026-08-10T00:00:00.000Z')}
      endDate={null}
      lifecycle="running"
      tabs={{ ...DEFAULT_SURVEY_GUEST_TABS, quota: true }}
      {...over}
    />,
  );
}

/**
 * 열람 화면의 서브헤더는 **자기 주소를 모른다** (ADR-0029, 티켓 06).
 *
 * 같은 헤더를 계정 입구(`/guest/surveys/<id>`)와 링크 입구(`/client/<token>`)가 함께 쓴다.
 * 접두가 헤더 안에 박혀 있으면 링크로 들어온 클라이언트가 탭을 누르는 순간 계정 주소로 나가
 * 로그인 화면에 떨어진다.
 */
describe('GuestSurveyHeader — 접두와 목록 링크를 주입받는다', () => {
  it('탭 링크가 주입받은 접두 아래로 간다', () => {
    renderHeader({ basePath: '/client/tok' });
    expect(screen.getByRole('link', { name: '설문 미리보기' })).toHaveAttribute(
      'href',
      '/client/tok/preview',
    );
    expect(screen.getByRole('link', { name: '응답 현황' })).toHaveAttribute(
      'href',
      '/client/tok/overview',
    );
    expect(screen.getByRole('link', { name: '쿼터 현황' })).toHaveAttribute(
      'href',
      '/client/tok/quota',
    );
  });

  it('계정 입구에서는 목록으로 돌아가는 링크가 있다', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: '열람 가능한 조사 목록으로' })).toHaveAttribute(
      'href',
      '/guest',
    );
  });

  it('목록 주소를 주지 않으면 돌아가는 링크가 없다 — 링크 입구에는 홈이 없다', () => {
    renderHeader({ basePath: '/client/tok', backHref: null });
    expect(screen.queryByRole('link', { name: '열람 가능한 조사 목록으로' })).toBeNull();
    // 제목과 상태는 그대로 보인다.
    expect(screen.getByRole('heading', { name: '고객 만족도 조사' })).toBeInTheDocument();
    expect(screen.getByText(/진행중/)).toBeInTheDocument();
  });

  it('꺼진 탭은 그리지 않는다 (종전 계약)', () => {
    renderHeader();
    expect(screen.queryByRole('link', { name: '진척 보고' })).toBeNull();
    expect(screen.getByRole('link', { name: '응답 현황' })).toHaveAttribute('aria-current', 'page');
  });
});
