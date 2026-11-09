import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccessLinkKind } from '@/shared/contracts/workspace';
import type { AccessLinkListItem, SurveyAccessLinksOutput } from '@/shared/contracts/workspace-io';

const { state, issue, setTab, close, reset, reveal, setLabel } = vi.hoisted(() => ({
  state: { data: null as unknown },
  issue: vi.fn(),
  setTab: vi.fn(),
  close: vi.fn(),
  reset: vi.fn(),
  reveal: vi.fn(),
  setLabel: vi.fn(),
}));

function mutation(fn: (input: unknown) => unknown) {
  return { mutateAsync: fn, isPending: false };
}

vi.mock('../queries/use-survey-access-link', () => ({
  useSurveyAccessLinks: () => ({ data: state.data, isPending: false, isError: false }),
  useSetAccessLinkLabel: () => mutation(setLabel),
  useIssueAccessLink: () => mutation(issue),
  useResetAccessLinkPassword: () => mutation(reset),
  useRevealAccessLinkPassword: () => mutation(reveal),
  useCloseAccessLink: () => mutation(close),
  useSetClientLinkTab: () => mutation(setTab),
  useClientResponseColumns: () => ({ data: undefined, isPending: true, isError: false }),
  useSetClientResponseColumns: () => mutation(vi.fn()),
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

const LINK_ID = '11111111-1111-4111-8111-111111111111';

const SECOND_LINK_ID = '22222222-2222-4222-8222-222222222222';

function linkOf(kind: AccessLinkKind, over: Partial<AccessLinkListItem> = {}): AccessLinkListItem {
  return {
    id: LINK_ID,
    kind,
    token: 'Xk9mQ2vR7pLw4nTz',
    clientTabs: kind === 'client' ? TABS : null,
    label: null,
    ordinal: 1,
    share: kind === 'fieldwork' ? { divided: false, count: 0 } : null,
    passwordUpdatedAt: new Date('2026-10-12T00:00:00.000Z'),
    createdAt: new Date('2026-10-12T00:00:00.000Z'),
    ...over,
  };
}

/** 링크 하나가 열린 상태. `link` 로 그 링크를 바로 집는다(옛 단건 모양의 테스트가 쓴다). */
function linkState(kind: AccessLinkKind, over: Partial<SurveyAccessLinksOutput> = {}) {
  const state = { links: [linkOf(kind)], canManage: true, ...over } satisfies SurveyAccessLinksOutput;
  return { ...state, link: state.links[0]! };
}

/** 외주 링크 둘 — 「프롬」 이름표와 이름표 없는 순번 2. */
function twoFieldworkLinks(): SurveyAccessLinksOutput {
  return {
    links: [
      linkOf('fieldwork', { label: '프롬' }),
      linkOf('fieldwork', { id: SECOND_LINK_ID, token: 'Bq7nW3xY9kLm2pRt', ordinal: 2 }),
    ],
    canManage: true,
  };
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
    issue.mockResolvedValue({ link: linkOf('client'), password: 'GeneratedPw1' });
    setLabel.mockResolvedValue(linkOf('fieldwork'));
    setTab.mockResolvedValue(linkState('client').link);
  });

  it('발급은 자기 종류로 보낸다 — 다른 종류의 링크를 만들지 않는다', async () => {
    state.data = { links: [], canManage: true };
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

  it('상세 통계 칩이 서고, 누르면 그 칩만 저장한다', async () => {
    state.data = linkState('client');
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);

    const chip = screen.getByRole('checkbox', { name: '상세 통계' });
    expect(chip).toBeChecked();
    await user.click(chip);

    await waitFor(() => expect(setTab).toHaveBeenCalledTimes(1));
    expect(setTab).toHaveBeenCalledWith({ surveyId: 's-1', tab: 'overviewDetail', enabled: false });
  });

  /**
   * 상세 통계는 응답 현황에 딸린 칩이다 — 응답 현황이 꺼져 있으면 켜도 보이는 곳이 없다.
   * 값은 지우지 않는다: 응답 현황을 다시 켜면 연구원이 두었던 대로 돌아온다.
   */
  it('응답 현황이 꺼져 있으면 상세 통계 칩이 잠기고 값은 그대로 보인다', () => {
    const base = linkState('client');
    state.data = { ...base, links: [{ ...base.link, clientTabs: { ...TABS, overview: false } }] };
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);

    const chip = screen.getByRole('checkbox', { name: '상세 통계' });
    expect(chip).toBeDisabled();
    expect(chip).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '쿼터 현황' })).toBeEnabled();
  });

  it('응답 내역 칩이 서고 새 링크에서는 꺼져 있다 — 누르면 켜기로 나간다', async () => {
    state.data = linkState('client');
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);

    const chip = screen.getByRole('checkbox', { name: '응답 내역' });
    expect(chip).not.toBeChecked();
    await user.click(chip);

    await waitFor(() =>
      expect(setTab).toHaveBeenCalledWith({ surveyId: 's-1', tab: 'responses', enabled: true }),
    );
  });

  it('발급 전에는 탭 칩이 없다 — 저장할 링크가 없다', () => {
    state.data = { links: [], canManage: true };
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

  it('클라이언트 링크에만 응답 내역 열 설정이 있고, 누르면 다이얼로그가 열린다', async () => {
    state.data = linkState('client');
    const user = userEvent.setup();
    const { unmount } = render(<AccessLinkPanel surveyId="s-1" kind="client" />);
    await user.click(screen.getByRole('button', { name: '응답 내역 열 설정' }));
    expect(screen.getByRole('dialog', { name: '응답 내역 열 설정' })).toBeInTheDocument();
    unmount();

    state.data = linkState('fieldwork');
    render(<AccessLinkPanel surveyId="s-1" kind="fieldwork" />);
    expect(screen.queryByRole('button', { name: '응답 내역 열 설정' })).toBeNull();
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

  /**
   * 이미 있는 링크를 움직이는 셋(보기·변경·종료)은 **그 링크의 id** 로 나간다 — 종류가 아니다
   * (fieldwork-multi-company 티켓 01). 외주 링크가 여럿이 되면 종류는 하나를 가리키지 못한다.
   * 요청에 종류가 실리지 않는 것까지 본다 — 서버 입력이 종류를 모른다.
   */
  it.each(['client', 'fieldwork'] as const)('%s 링크의 종료는 화면이 그린 그 링크의 id 로 나간다', async (kind) => {
    state.data = linkState(kind);
    close.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind={kind} />);

    await user.click(screen.getByRole('button', { name: '종료' }));
    // 확인 행의 「종료」가 실제로 보낸다.
    const buttons = screen.getAllByRole('button', { name: '종료' });
    await user.click(buttons[0]!);

    await waitFor(() => expect(close).toHaveBeenCalledWith({ surveyId: 's-1', linkId: LINK_ID }));
  });

  it('비밀번호 보기는 그 링크의 id 로 나가고 받은 평문을 그린다', async () => {
    state.data = linkState('fieldwork');
    reveal.mockResolvedValue({ password: 'Revealed2026' });
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind="fieldwork" />);

    await user.click(screen.getByRole('button', { name: '보기' }));

    await waitFor(() => expect(screen.getByText('Revealed2026')).toBeInTheDocument());
    expect(reveal).toHaveBeenCalledWith({ surveyId: 's-1', linkId: LINK_ID });
  });

  it('비밀번호 변경은 그 링크의 id 와 직접 입력한 값으로 나간다', async () => {
    state.data = linkState('client');
    reset.mockResolvedValue({ link: linkOf('client'), password: 'Typed2026x' });
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);

    await user.type(screen.getByPlaceholderText(/비밀번호 직접 입력/), 'Typed2026x');
    await user.click(screen.getByRole('button', { name: '변경' }));

    await waitFor(() =>
      expect(reset).toHaveBeenCalledWith({ surveyId: 's-1', linkId: LINK_ID, password: 'Typed2026x' }),
    );
  });
  // ───────────────────────────────────────────────────────────────────────────
  // 외주 링크 여럿 · 이름표 (fieldwork-multi-company 티켓 02)
  // ───────────────────────────────────────────────────────────────────────────

  it('외주 링크 둘이 각각 자기 주소로 서고, 이름표 없는 링크는 순번으로 구별된다', () => {
    state.data = twoFieldworkLinks();
    render(<AccessLinkPanel surveyId="s-1" kind="fieldwork" />);

    expect(screen.getByText(/\/fw\/Xk9mQ2vR7pLw4nTz$/)).toBeInTheDocument();
    expect(screen.getByText(/\/fw\/Bq7nW3xY9kLm2pRt$/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '프롬' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '링크 2' })).toBeInTheDocument();
    expect(screen.getByText('이름표 없음')).toBeInTheDocument();
  });

  it('외주 링크 카드마다 담당 범위 요약과 그 링크의 나누기 화면 바로가기가 선다', () => {
    state.data = {
      links: [
        linkOf('fieldwork', { label: '프롬', share: { divided: true, count: 1234 } }),
        linkOf('fieldwork', {
          id: SECOND_LINK_ID,
          token: 'Bq7nW3xY9kLm2pRt',
          ordinal: 2,
          share: { divided: false, count: 0 },
        }),
      ],
      canManage: true,
    };
    render(<AccessLinkPanel surveyId="s-1" kind="fieldwork" />);

    const from = within(screen.getByRole('group', { name: '프롬' }));
    expect(from.getByText('나눔 · 1,234명')).toBeInTheDocument();
    expect(from.getByRole('link', { name: '담당 범위 나누기' })).toHaveAttribute(
      'href',
      `/surveys/s-1/operations/contacts/shares/${LINK_ID}`,
    );
    const second = within(screen.getByRole('group', { name: '링크 2' }));
    expect(second.getByText('설문 전체')).toBeInTheDocument();
    expect(second.getByRole('link', { name: '담당 범위 나누기' })).toHaveAttribute(
      'href',
      `/surveys/s-1/operations/contacts/shares/${SECOND_LINK_ID}`,
    );
  });

  it('클라이언트 링크에는 담당 범위 줄이 없다', () => {
    state.data = linkState('client');
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);
    expect(screen.queryByText('담당 범위')).not.toBeInTheDocument();
  });

  it('외주 링크가 있어도 발급 칸이 남고, 발급은 적은 이름표와 함께 외주 종류로 나간다', async () => {
    state.data = twoFieldworkLinks();
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind="fieldwork" />);

    await user.click(screen.getByRole('button', { name: '외주 링크 추가' }));
    await user.type(screen.getByPlaceholderText(/이름표 \(예: 업체명\)/), '프라임');
    await user.click(screen.getByRole('button', { name: '링크 발급' }));

    await waitFor(() =>
      expect(issue).toHaveBeenCalledWith({ surveyId: 's-1', kind: 'fieldwork', label: '프라임' }),
    );
  });

  it('외주 링크가 없으면 발급 칸이 바로 보이고, 이름표를 비우면 이름표 없이 발급한다', async () => {
    state.data = { links: [], canManage: true };
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind="fieldwork" />);

    await user.click(screen.getByRole('button', { name: '링크 발급' }));

    expect(issue).toHaveBeenCalledWith({ surveyId: 's-1', kind: 'fieldwork' });
  });

  it('두 번째 카드의 종료·보기는 그 카드의 링크 id 로 나간다 — 다른 링크에 닿지 않는다', async () => {
    state.data = twoFieldworkLinks();
    close.mockResolvedValue({ success: true });
    reveal.mockResolvedValue({ password: 'SecondPw2026' });
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind="fieldwork" />);

    const second = within(screen.getByRole('group', { name: '링크 2' }));
    await user.click(second.getByRole('button', { name: '보기' }));
    await waitFor(() => expect(second.getByText('SecondPw2026')).toBeInTheDocument());
    expect(reveal).toHaveBeenCalledWith({ surveyId: 's-1', linkId: SECOND_LINK_ID });

    await user.click(second.getByRole('button', { name: '종료' }));
    await user.click(second.getAllByRole('button', { name: '종료' })[0]!);
    await waitFor(() => expect(close).toHaveBeenCalledWith({ surveyId: 's-1', linkId: SECOND_LINK_ID }));
    // 첫 카드의 비밀번호는 여전히 가려져 있다 — 카드마다 상태가 따로다.
    expect(within(screen.getByRole('group', { name: '프롬' })).queryByText('SecondPw2026')).toBeNull();
  });

  it('외주 링크의 종료 확인은 다른 외주 링크가 그대로라고 말한다', async () => {
    state.data = twoFieldworkLinks();
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind="fieldwork" />);

    await user.click(within(screen.getByRole('group', { name: '프롬' })).getByRole('button', { name: '종료' }));
    expect(screen.getByText(/다른 외주 링크는 그대로입니다/)).toBeInTheDocument();
  });

  it('이름표를 고치면 그 링크 id 와 정돈한 값으로 저장하고, 비우면 이름표를 지운다', async () => {
    state.data = twoFieldworkLinks();
    const user = userEvent.setup();
    render(<AccessLinkPanel surveyId="s-1" kind="fieldwork" />);

    const second = within(screen.getByRole('group', { name: '링크 2' }));
    await user.click(second.getByRole('button', { name: '이름표 고치기' }));
    await user.type(second.getByRole('textbox', { name: '이름표' }), '  프라임 ');
    await user.click(second.getByRole('button', { name: '저장' }));
    await waitFor(() =>
      expect(setLabel).toHaveBeenCalledWith({ surveyId: 's-1', linkId: SECOND_LINK_ID, label: '프라임' }),
    );

    const first = within(screen.getByRole('group', { name: '프롬' }));
    await user.click(first.getByRole('button', { name: '이름표 고치기' }));
    await user.clear(first.getByRole('textbox', { name: '이름표' }));
    await user.click(first.getByRole('button', { name: '저장' }));
    await waitFor(() =>
      expect(setLabel).toHaveBeenCalledWith({ surveyId: 's-1', linkId: LINK_ID, label: null }),
    );
  });

  it('클라이언트 링크는 하나라 발급 뒤에는 발급 칸도 이름표도 없다', () => {
    state.data = linkState('client');
    render(<AccessLinkPanel surveyId="s-1" kind="client" />);

    expect(screen.queryByRole('button', { name: '링크 발급' })).toBeNull();
    expect(screen.queryByRole('button', { name: '외주 링크 추가' })).toBeNull();
    expect(screen.queryByRole('button', { name: '이름표 고치기' })).toBeNull();
  });
});
