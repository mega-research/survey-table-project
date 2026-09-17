/**
 * 일괄 배치 바 (.pen FLOW 9-2) + 공유 필드(assignment-fields).
 *
 * 여기서 고정하는 것은 **화면이 서버에 거부당할 조합을 만들지 않는가**이다.
 * 새 소유자 후보는 목적지 팀의 활성 멤버로 좁혀지므로, 팀을 바꾸고도 이전 소유자를 들고 있으면
 * 화면에는 이름이 보이는 채로 서버가 BAD_REQUEST 를 던진다 — 사용자에게는 "고른 값을 서버가
 * 거부한다" 로 보인다. 후보를 좁히는 이유 자체는 판정 코어와의 계약이다(티켓 13 소유자 분기).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { selectOption } from '@tests/helpers/select';

const { mutateAsync, useOwnerCandidates } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  useOwnerCandidates: vi.fn(),
}));

vi.mock('./queries/use-reassignment', () => ({
  useAssignSurveys: () => ({ mutateAsync, isPending: false }),
  useOwnerCandidates,
}));

const TEAM_A = { id: '11111111-1111-4111-8111-111111111111', name: 'A팀' };
const TEAM_B = { id: '22222222-2222-4222-8222-222222222222', name: 'B팀' };
const OWNER_A = { userId: '33333333-3333-4333-8333-333333333333', name: '김담당', jobTitle: null, role: 'member' as const };
const OWNER_B = { userId: '44444444-4444-4444-8444-444444444444', name: '이담당', jobTitle: null, role: 'leader' as const };

vi.mock('../team-management/queries/use-teams', () => ({
  useTeams: () => ({
    data: {
      teams: [
        { ...TEAM_A, memberCount: 1, surveyCount: 0 },
        { ...TEAM_B, memberCount: 1, surveyCount: 0 },
      ],
    },
    isLoading: false,
    error: null,
  }),
}));

import { SurveyAssignBar } from './survey-assign-bar';

const SURVEY_ID = '55555555-5555-4555-8555-555555555555';
const onAssigned = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({ assignedCount: 1 });
  useOwnerCandidates.mockImplementation((teamId: string | null) => ({
    data: teamId === TEAM_A.id ? [OWNER_A] : teamId === TEAM_B.id ? [OWNER_B] : [],
    isLoading: false,
  }));
});

describe('SurveyAssignBar', () => {
  it('선택이 없으면 무엇을 해야 하는지 말한다', () => {
    render(<SurveyAssignBar surveyIds={[]} onAssigned={onAssigned} />);
    expect(screen.getByRole('button', { name: '일괄 배치' })).toBeDisabled();
    expect(screen.getByText(/아래 표에서 설문을 선택하면/)).toBeInTheDocument();
  });

  it('새 소유자는 목적지 팀을 고르기 전에는 잠겨 있다', () => {
    render(<SurveyAssignBar surveyIds={[SURVEY_ID]} onAssigned={onAssigned} />);
    expect(screen.getByRole('combobox', { name: '새 소유자' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '일괄 배치' })).toBeDisabled();
  });

  it('팀·소유자·공개 범위를 한 벌로 보낸다', async () => {
    const user = userEvent.setup();
    render(<SurveyAssignBar surveyIds={[SURVEY_ID]} onAssigned={onAssigned} />);

    await selectOption(user, '목적지 팀', 'A팀');
    await selectOption(user, '새 소유자', '김담당');
    await selectOption(user, '공개 범위', '초대된 멤버만');
    await user.click(screen.getByRole('button', { name: '일괄 배치' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      surveyIds: [SURVEY_ID],
      teamId: TEAM_A.id,
      ownerUserId: OWNER_A.userId,
      visibility: 'invite_only',
    });
    expect(onAssigned).toHaveBeenCalled();
  });

  it('목적지 팀을 바꾸면 이전 소유자 선택이 지워진다', async () => {
    const user = userEvent.setup();
    render(<SurveyAssignBar surveyIds={[SURVEY_ID]} onAssigned={onAssigned} />);

    await selectOption(user, '목적지 팀', 'A팀');
    await selectOption(user, '새 소유자', '김담당');
    expect(screen.getByRole('button', { name: '일괄 배치' })).toBeEnabled();

    // B팀 후보에 김담당은 없다 — 들고 있으면 서버가 거부하는 조합이 된다.
    await selectOption(user, '목적지 팀', 'B팀');
    expect(screen.getByRole('button', { name: '일괄 배치' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '새 소유자' })).toHaveTextContent('소유자 선택');
  });

  it('후보가 없는 팀은 먼저 팀원을 배정하라고 말한다', async () => {
    const user = userEvent.setup();
    useOwnerCandidates.mockReturnValue({ data: [], isLoading: false });
    render(<SurveyAssignBar surveyIds={[SURVEY_ID]} onAssigned={onAssigned} />);

    await selectOption(user, '목적지 팀', 'A팀');

    expect(screen.getByText(/재직 중 팀원이 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '일괄 배치' })).toBeDisabled();
  });

  it('서버 거부 문구를 그대로 보여주고 선택을 지우지 않는다', async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValue(new Error('배치 대기 상태가 아닌 설문이 포함돼 있습니다.'));
    render(<SurveyAssignBar surveyIds={[SURVEY_ID]} onAssigned={onAssigned} />);

    await selectOption(user, '목적지 팀', 'A팀');
    await selectOption(user, '새 소유자', '김담당');
    await user.click(screen.getByRole('button', { name: '일괄 배치' }));

    expect(
      await screen.findByText('배치 대기 상태가 아닌 설문이 포함돼 있습니다.'),
    ).toBeInTheDocument();
    // 선택을 비우면 사용자가 무엇을 고쳐야 하는지 알 수 없다.
    expect(onAssigned).not.toHaveBeenCalled();
    expect(screen.getByText('1개 선택')).toBeInTheDocument();
  });
});
