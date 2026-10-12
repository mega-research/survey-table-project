import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// 이 셸의 얼굴은 운영 콘솔과 한 벌이다 — 화면 머리는 `OperationsPageHeader`, 탭 줄은 같은
// 모양의 `GuestTabStrip`. 여기서 보는 것은 **링크 입구가 넣는 값**이다 — 탭이 자기 주소 아래로
// 가는가, 내부 콘솔에만 있어야 할 것(목록·편집·제어·로그아웃)이 없는가.

const TOKEN = 'tok_abcdefghijklmnop';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useSelectedLayoutSegment: () => 'overview',
  // 화면 머리의 새로고침 버튼이 쓴다.
  useRouter: () => ({ refresh: vi.fn() }),
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

  it('화면 머리에 서는 것은 새로고침·설문 보기·나가기 셋뿐이다', async () => {
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

    expect(screen.getByRole('button', { name: '새로고침' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /나가기/ })).toBeInTheDocument();
    // 설문 미리보기는 탭이 아니라 화면 머리의 「설문 보기」가 연다 — 자기 콘솔 아래의 주소다.
    expect(screen.getByRole('link', { name: /설문 보기/ })).toHaveAttribute(
      'href',
      `/client/${TOKEN}/preview`,
    );
    expect(screen.queryByRole('link', { name: /설문 미리보기/ })).not.toBeInTheDocument();
    // 내부 콘솔에만 있어야 할 것이 없다.
    expect(screen.queryByText('목록으로')).not.toBeInTheDocument();
    expect(screen.queryByText('설문 편집')).not.toBeInTheDocument();
    expect(screen.queryByText(/테스트 모드/)).not.toBeInTheDocument();
    expect(screen.queryByText('메가허브')).not.toBeInTheDocument();
  });

  it('밖으로 나가는 링크가 없다 — 링크는 설문 하나만 연다', async () => {
    gate.assert.mockResolvedValue({
      surveyId: 'survey-1',
      tabs: { overview: true, progressReport: true, contactsMasked: true, quota: true },
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
    // 이 화면의 모든 링크가 자기 콘솔 아래다 — 설문 목록·편집·로그인·프로필로 나가는 길이 없다.
    expect(hrefs.every((href) => href?.startsWith(`/client/${TOKEN}/`))).toBe(true);
    // 설문 보기 + 켜진 탭 넷.
    expect(hrefs).toHaveLength(5);
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
