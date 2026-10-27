import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccessLinkKind } from '@/shared/contracts/workspace';
import type { SurveyAccessLinkOutput } from '@/shared/contracts/workspace-io';

const { state, issue, setTab, close } = vi.hoisted(() => ({
  state: { data: null as unknown },
  issue: vi.fn(),
  setTab: vi.fn(),
  close: vi.fn(),
}));

function mutation(fn: (input: unknown) => unknown) {
  return { mutateAsync: fn, isPending: false };
}

vi.mock('../queries/use-survey-access-link', () => ({
  useSurveyAccessLink: () => ({ data: state.data, isPending: false, isError: false }),
  useIssueAccessLink: () => mutation(issue),
  useResetAccessLinkPassword: () => mutation(vi.fn()),
  useRevealAccessLinkPassword: () => mutation(vi.fn()),
  useCloseAccessLink: () => mutation(close),
  useSetClientLinkTab: () => mutation(setTab),
}));

import { AccessLinkPanel } from './access-link-panel';

const TABS = {
  overview: true,
  progressReport: false,
  contactsMasked: false,
  quota: false,
  preview: true,
  overviewDetail: true,
  responses: false,
};

function linkState(kind: AccessLinkKind, over: Partial<SurveyAccessLinkOutput> = {}) {
  return {
    link: {
      id: '11111111-1111-4111-8111-111111111111',
      kind,
      token: 'Xk9mQ2vR7pLw4nTz',
      clientTabs: kind === 'client' ? TABS : null,
      passwordUpdatedAt: new Date('2026-10-12T00:00:00.000Z'),
      createdAt: new Date('2026-10-12T00:00:00.000Z'),
    },
    canManage: true,
    ...over,
  } satisfies SurveyAccessLinkOutput;
}

/**
 * 링크 패널 — 외주 실사 링크와 클라이언트 링크가 **한 벌**을 쓴다 (ADR-0029).
 *
 * 두 종류가 하는 일(발급·주소 복사·비밀번호 보기·변경·종료)이 같아 패널을 따로 짜면 한쪽만
 * 고쳐진다. 갈리는 것은 주소 접두, 안내 문구, 그리고 클라이언트에게만 있는 **탭 칩**이다.
 */
describe('AccessLinkPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.data = null;
    issue.mockResolvedValue({ link: linkState('client').link, password: 'GeneratedPw1' });
    setTab.mockResolvedValue(linkState('client').link);
  });

  it('발급은 자기 종류로 보낸다 — 다른 종류의 링크를 만들지 않는다', async () => {
    state.data = { link: null, canManage: true };
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);

    await user.click(screen.getByRole('button', { name: '링크 발급' }));

    expect(issue).toHaveBeenCalledWith({ surveyId: 's-1', kind: 'client' });
  });

  it('클라이언트 링크의 주소는 /client 아래다', () => {
    state.data = linkState('client');
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);
    expect(screen.getByText(/\/client\/Xk9mQ2vR7pLw4nTz$/)).toBeInTheDocument();
  });

  it('외주 링크의 주소는 /fw 아래이고 탭 칩이 없다', () => {
    state.data = linkState('fieldwork');
    render(<AccessLinkPanel surveyId="s-1" kind="fieldwork" />);
    expect(screen.getByText(/\/fw\/Xk9mQ2vR7pLw4nTz$/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('클라이언트 링크에는 탭 칩이 서고 지금 열린 탭이 보인다', () => {
    state.data = linkState('client');
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);

    expect(screen.getByRole('checkbox', { name: '응답 현황' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '진척 보고' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '조사 대상' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '쿼터 현황' })).not.toBeChecked();
  });

  /**
   * 누른 칩과 그 값만 보낸다 — 네 값을 통째로 보내지 않는다 (2026-10-12 리뷰).
   *
   * 통째로 보내면 이 화면이 낡았을 때 다른 사람이 방금 끈 칩이 요청에 실려 되살아난다.
   * 요청에 **다른 칩이 실리지 않는 것**까지 본다 — 그것이 이 계약의 전부다.
   */
  it('칩을 누르면 그 칩과 값만 저장한다 — 다른 칩은 요청에 실리지 않는다', async () => {
    state.data = linkState('client');
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);

    await user.click(screen.getByRole('checkbox', { name: '쿼터 현황' }));

    await waitFor(() => expect(setTab).toHaveBeenCalledTimes(1));
    expect(setTab).toHaveBeenCalledWith({ surveyId: 's-1', tab: 'quota', enabled: true });
  });

  it('켜진 칩을 누르면 끄기로 나간다 — 토글이 아니라 값이다', async () => {
    state.data = linkState('client');
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);

    await user.click(screen.getByRole('checkbox', { name: '응답 현황' }));

    await waitFor(() =>
      expect(setTab).toHaveBeenCalledWith({ surveyId: 's-1', tab: 'overview', enabled: false }),
    );
  });

  it('설문 보기도 칩이다 — 켜져 있으면 체크로 보이고, 누르면 그 칩만 끄기로 나간다', async () => {
    state.data = linkState('client');
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);

    const chip = screen.getByRole('checkbox', { name: '설문 보기' });
    expect(chip).toBeChecked();
    await user.click(chip);

    await waitFor(() => expect(setTab).toHaveBeenCalledTimes(1));
    expect(setTab).toHaveBeenCalledWith({ surveyId: 's-1', tab: 'preview', enabled: false });
  });

  it('「설문 미리보기는 언제나 열립니다」라고 말하지 않는다 — 이제 칩으로 닫힌다', () => {
    state.data = linkState('client');
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);
    expect(screen.queryByText(/언제나 열립니다/)).toBeNull();
  });

  it('발급 전에는 탭 칩이 없다 — 저장할 링크가 없다', () => {
    state.data = { link: null, canManage: true };
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('관리 권한이 없으면 칩과 버튼이 잠기되 지금 열린 탭은 보인다', () => {
    state.data = linkState('client', { canManage: false });
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);

    expect(screen.getByRole('checkbox', { name: '응답 현황' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '응답 현황' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '종료' })).toBeDisabled();
  });

  it('닫히는 조건을 종류마다 다르게 말한다', () => {
    state.data = linkState('client');
    const { unmount } = render(<AccessLinkPanel surveyId="s-1" kind="client" />);
    expect(screen.getByText(/설문을 중단해도 열려 있고, 종료하면 닫힙니다/)).toBeInTheDocument();
    unmount();

    state.data = linkState('fieldwork');
    render(<AccessLinkPanel surveyId="s-1" kind="fieldwork" />);
    expect(screen.getByText(/설문을 중단하거나 종료하면 닫힙니다/)).toBeInTheDocument();
  });

  it('종료는 자기 종류의 링크만 닫는다', async () => {
    state.data = linkState('client');
    close.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);

    await user.click(screen.getByRole('button', { name: '종료' }));
    // 확인 행의 「종료」가 실제로 보낸다.
    const buttons = screen.getAllByRole('button', { name: '종료' });
    await user.click(buttons[0]!);

    await waitFor(() => expect(close).toHaveBeenCalledWith({ surveyId: 's-1', kind: 'client' }));
  });
});
