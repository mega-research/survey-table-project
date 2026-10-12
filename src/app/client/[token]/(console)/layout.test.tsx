import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// 이 셸은 게스트 계정 입구와 같은 조각(`GuestShell`·`GuestSurveyHeader`)을 쓴다. 조각 자체의
// 계약은 각자의 테스트가 지고, 여기서 보는 것은 **링크 입구가 넣는 값**이다 — 탭이 자기 주소
// 아래로 가는가, 계정 입구에만 있어야 할 것(목록·홈·프로필)이 없는가.

const TOKEN = 'tok_abcdefghijklmnop';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useSelectedLayoutSegment: () => 'overview',
}));

const gate = vi.hoisted(() => ({ assert: vi.fn() }));
vi.mock('@/server/page-client-link-access', () => ({
  assertClientLinkPageAccess: gate.assert,
}));

const header = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/server/read-models/guest-surveys', () => ({
  getClientSurveyHeader: header.load,
}));

vi.mock('@/shared/lib/rpc', () => ({ client: {} }));

import ClientLinkConsoleLayout from './layout';

async function renderLayout() {
  const element = await ClientLinkConsoleLayout({
    children: <p>본문</p>,
    params: Promise.resolve({ token: TOKEN }),
  });
  return render(element);
}

describe('클라이언트 링크 콘솔 셸', () => {
  it('화면 머리에 조사 이름이 서고 탭이 자기 주소 아래로 간다', async () => {
    gate.assert.mockResolvedValue({
      surveyId: 'survey-1',
      tabs: { overview: true, progressReport: true, contactsMasked: false, quota: false },
    });
    header.load.mockResolvedValue({
      surveyId: 'survey-1',
      title: '고객사 열람 조사',
      publishedAt: new Date('2026-10-01T00:00:00Z'),
      endDate: null,
      lifecycle: 'paused',
    });

    await renderLayout();

    expect(screen.getByText('고객사 열람 조사')).toBeInTheDocument();
    // 중단된 설문도 열린다 — 화면 머리가 그 상태를 말한다.
    expect(screen.getByText(/일시중지/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '응답 현황' })).toHaveAttribute(
      'href',
      `/client/${TOKEN}/overview`,
    );
    expect(screen.getByRole('link', { name: '진척 보고' })).toHaveAttribute(
      'href',
      `/client/${TOKEN}/report`,
    );
    // 꺼진 탭은 그리지 않는다.
    expect(screen.queryByRole('link', { name: /조사 대상/ })).not.toBeInTheDocument();
    expect(screen.getByText('본문')).toBeInTheDocument();
  });

  it('목록·홈으로 가는 링크가 없고 나가기가 있다 — 링크는 설문 하나만 연다', async () => {
    gate.assert.mockResolvedValue({
      surveyId: 'survey-1',
      tabs: { overview: true, progressReport: false, contactsMasked: false, quota: false },
    });
    header.load.mockResolvedValue({
      surveyId: 'survey-1',
      title: '고객사 열람 조사',
      publishedAt: null,
      endDate: null,
      lifecycle: 'running',
    });

    await renderLayout();

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    // 이 화면의 모든 링크가 자기 콘솔 아래다 — 게스트 홈·로그인·프로필로 나가는 길이 없다.
    expect(hrefs.every((href) => href?.startsWith(`/client/${TOKEN}/`))).toBe(true);
    expect(screen.getByRole('button', { name: /나가기/ })).toBeInTheDocument();
  });

  it('관문을 탭 없이 지난다 — 탭 판정은 각 화면의 몫이다', async () => {
    gate.assert.mockClear();
    gate.assert.mockResolvedValue({
      surveyId: 'survey-1',
      tabs: { overview: false, progressReport: false, contactsMasked: false, quota: false },
    });
    header.load.mockResolvedValue({
      surveyId: 'survey-1',
      title: '고객사 열람 조사',
      publishedAt: null,
      endDate: null,
      lifecycle: 'running',
    });

    await renderLayout();
    // 탭을 넘기면 그 탭을 끈 설문에서 미리보기까지 404 가 된다.
    expect(gate.assert).toHaveBeenCalledWith(TOKEN);
  });

  it('관문을 지난 뒤 머리를 읽지 못하면 notFound 다 — 그 사이 설문이 닫혔다', async () => {
    gate.assert.mockResolvedValue({
      surveyId: 'survey-1',
      tabs: { overview: true, progressReport: false, contactsMasked: false, quota: false },
    });
    header.load.mockResolvedValue(null);
    await expect(renderLayout()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
