/**
 * 팀 해산 확인 모달 (.pen FLOW 8-1) — 화면이 되돌릴 수 없다는 사실을 먼저 말하는가.
 *
 * 서버가 확인 문구를 다시 대조하므로 여기는 방어선이 아니라 **안내**다. 그래도 고정할 값이
 * 있다: ① 확정 전에는 버튼이 눌리지 않는다 ② 무엇이 바뀌고 무엇이 안 바뀌는지 세 줄이 다
 * 보인다 ③ 서버 거부 문구를 그대로 보여준다(임의 문구로 덮으면 CONFLICT 사유가 사라진다).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('./queries/use-teams', () => ({
  useDissolveTeam: () => ({ mutateAsync, isPending: false }),
}));

import { TeamDissolveModal } from './team-dissolve-modal';

const TEAM = {
  id: '22222222-2222-4222-8222-222222222222',
  name: '연구1본부 - 1팀',
  memberCount: 3,
  surveyCount: 8,
};

const onClose = vi.fn();
const onDissolved = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({ success: true });
});

function renderModal() {
  return render(<TeamDissolveModal team={TEAM} onClose={onClose} onDissolved={onDissolved} />);
}

describe('TeamDissolveModal', () => {
  it('되돌릴 수 없다는 것과 영향 세 줄을 모두 보여준다', () => {
    renderModal();

    expect(screen.getByText(/되돌릴 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByText(/팀원 3명이 미배치로 전환됩니다/)).toBeInTheDocument();
    expect(screen.getByText(/설문 8개가 배치 대기로 이동합니다/)).toBeInTheDocument();
    // 바뀌지 않는 것도 말해야 한다 — 이 줄이 없으면 조사가 도는 팀은 아무도 못 누른다.
    expect(screen.getByText(/외부 응답 · 게스트 열람 · 메일 발송은 계속 동작합니다/)).toBeInTheDocument();
  });

  it('이름이 정확히 일치하기 전에는 해산 버튼이 잠겨 있다', async () => {
    const user = userEvent.setup();
    renderModal();

    const button = screen.getByRole('button', { name: '팀 해산' });
    expect(button).toBeDisabled();

    // 부분 일치로는 열리지 않는다.
    await user.type(screen.getByLabelText('확인을 위해 팀 이름을 입력하세요'), '연구1본부');
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText('확인을 위해 팀 이름을 입력하세요'), ' - 1팀');
    expect(button).toBeEnabled();

    await user.click(button);
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ teamId: TEAM.id, confirmName: TEAM.name }),
    );
    expect(onDissolved).toHaveBeenCalledWith(TEAM);
    expect(onClose).toHaveBeenCalled();
  });

  it('서버 거부 문구를 그대로 보여주고 모달을 닫지 않는다', async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValue(new Error('팀 이름이 일치하지 않습니다.'));
    renderModal();

    await user.type(screen.getByLabelText('확인을 위해 팀 이름을 입력하세요'), TEAM.name);
    await user.click(screen.getByRole('button', { name: '팀 해산' }));

    expect(await screen.findByText('팀 이름이 일치하지 않습니다.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDissolved).not.toHaveBeenCalled();
  });
});
