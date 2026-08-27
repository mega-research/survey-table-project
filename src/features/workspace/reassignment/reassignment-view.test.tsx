/**
 * 재배치 센터 인박스 (.pen FLOW 8-2·9-2).
 *
 * 화면이 고정할 값 셋.
 *  ① **지표는 전체 수, 표는 상위 N건**이다. 두 수가 다를 수 있다는 것을 화면이 말해야 한다 —
 *     안 말하면 「배치 대기 1200」인데 표에 200줄만 있는 것이 버그로 읽힌다.
 *  ② 선택은 **보이는 행으로 좁혀진다**. 다른 창에서 먼저 배치된 설문이 선택에 남아 있으면
 *     일괄 배치가 「배치 대기가 아님」으로 통째로 거부된다(서버는 전부 아니면 전무다).
 *  ③ 「외부 응답·게스트·메일은 계속」이 항상 보인다 — 해산 확인 모달과 같은 이유로, 이 문장이
 *     없으면 조사가 도는 설문을 아무도 못 옮긴다.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useReassignmentInbox } = vi.hoisted(() => ({ useReassignmentInbox: vi.fn() }));

vi.mock('./queries/use-reassignment', () => ({
  useReassignmentInbox,
  useAssignUserToTeam: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAssignSurveys: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOwnerCandidates: () => ({ data: [], isLoading: false }),
}));

vi.mock('../team-management/queries/use-teams', () => ({
  useTeams: () => ({ data: { teams: [] }, isLoading: false, error: null }),
}));

import { ReassignmentView } from './reassignment-view';

const USER = {
  userId: '11111111-1111-4111-8111-111111111111',
  name: '박도윤',
  email: 'dypark@megaresearch.co.kr',
  jobTitle: '부장',
  previousTeamName: '연구1본부 - 1팀',
};

const SURVEY = {
  surveyId: '22222222-2222-4222-8222-222222222222',
  title: '브랜드 인지도 조사',
  ownerUserId: null,
  ownerName: null,
  ownerIsUnassigned: false,
  previousTeamName: '연구1본부 - 1팀',
  updatedAt: '2026-08-27T00:00:00.000Z',
};

function mockInbox(overrides: Record<string, unknown> = {}) {
  useReassignmentInbox.mockReturnValue({
    data: {
      summary: { archivedTeamCount: 1, unassignedUserCount: 1, pendingSurveyCount: 1 },
      unassignedUsers: [USER],
      pendingSurveys: [SURVEY],
      ...overrides,
    },
    isLoading: false,
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInbox();
});

describe('ReassignmentView', () => {
  it('지표 셋과 처리 대기 합계를 보여준다', () => {
    render(<ReassignmentView />);

    expect(screen.getByText('해산된 팀')).toBeInTheDocument();
    expect(screen.getByText('미배치 사용자')).toBeInTheDocument();
    expect(screen.getByText('배치 대기 설문')).toBeInTheDocument();
    // 배지는 사용자 + 설문의 합이다.
    expect(screen.getByText('처리 대기 2')).toBeInTheDocument();
  });

  it('미배치 사용자 행에 이전 소속과 「(해산)」이 붙는다', () => {
    render(<ReassignmentView />);

    expect(screen.getByText('박도윤')).toBeInTheDocument();
    // 미배치인데 멤버십 행이 남아 있다면 그 팀은 archived 다 — 접미사가 그 사실을 말한다.
    expect(screen.getByText('연구1본부 - 1팀 (해산)')).toBeInTheDocument();
  });

  it('바뀌지 않는 것을 말한다 — 외부 응답·게스트·메일', () => {
    render(<ReassignmentView />);
    expect(
      screen.getByText(/외부 응답 · 게스트 열람 · 메일 발송은 재배치와 무관하게 계속 동작합니다/),
    ).toBeInTheDocument();
  });

  it('탭을 옮기면 배치 대기 표와 일괄 배치 바가 나온다', async () => {
    const user = userEvent.setup();
    render(<ReassignmentView />);

    await user.click(screen.getByRole('button', { name: /배치 대기 설문/ }));

    expect(screen.getByText('브랜드 인지도 조사')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '일괄 배치' })).toBeDisabled();
    expect(screen.getByText('0개 선택')).toBeInTheDocument();
  });

  it('상한을 넘긴 목록만 「상위 N건」을 말한다', async () => {
    const user = userEvent.setup();
    mockInbox({ summary: { archivedTeamCount: 1, unassignedUserCount: 1, pendingSurveyCount: 1200 } });
    render(<ReassignmentView />);

    // 사용자 탭(1건 = 전체)에는 안내가 없다.
    expect(screen.queryByText(/상위/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /배치 대기 설문/ }));
    expect(screen.getByText(/전체 1200건 중 상위 1건입니다/)).toBeInTheDocument();
  });

  it('목록에서 사라진 선택은 자동으로 빠진다', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReassignmentView />);

    await user.click(screen.getByRole('button', { name: /배치 대기 설문/ }));
    await user.click(screen.getByRole('checkbox', { name: '브랜드 인지도 조사 선택' }));
    expect(screen.getByText('1개 선택')).toBeInTheDocument();

    // 다른 창에서 먼저 배치돼 목록에서 빠졌다. 선택에 남겨두면 일괄 배치가 통째로 거부된다.
    mockInbox({ pendingSurveys: [], summary: { archivedTeamCount: 1, unassignedUserCount: 1, pendingSurveyCount: 0 } });
    rerender(<ReassignmentView />);

    expect(screen.getByText('0개 선택')).toBeInTheDocument();
    expect(screen.getByText('배치 대기 설문이 없습니다.')).toBeInTheDocument();
  });

  it('전체 선택은 보이는 행만 고른다', async () => {
    const user = userEvent.setup();
    render(<ReassignmentView />);

    await user.click(screen.getByRole('button', { name: /배치 대기 설문/ }));
    await user.click(screen.getByRole('checkbox', { name: '전체 선택' }));

    expect(screen.getByText('1개 선택')).toBeInTheDocument();
  });

  it('소유자가 없는 설문은 메가리서치로 적는다', async () => {
    const user = userEvent.setup();
    render(<ReassignmentView />);

    await user.click(screen.getByRole('button', { name: /배치 대기 설문/ }));
    // 팀 도입 이전 백필분은 owner_user_id 가 NULL 이다 — 「소유자 없음」은 오류처럼 읽힌다.
    const row = screen.getByText('브랜드 인지도 조사').closest('div')!.parentElement!;
    expect(within(row.parentElement!).getByText('메가리서치')).toBeInTheDocument();
  });
});
