import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const transfer = vi.hoisted(() => ({
  mutateAsync: vi.fn(async (_input: unknown) => undefined),
  isPending: false,
}));

vi.mock('../queries/use-survey-ownership', () => ({
  useTransferCandidates: () => ({
    data: [
      { userId: 'u-team', name: '김팀원', email: 'team@example.test', teamName: '연구1팀', source: 'team_member' },
      { userId: 'u-other', name: '박참여', email: 'other@example.test', teamName: null, source: 'participant' },
    ],
    isPending: false,
  }),
  useTransferSurveyOwnership: () => transfer,
}));

import { OwnershipTransferModal } from './ownership-transfer-modal';

function renderModal(onClose = vi.fn()) {
  render(
    <OwnershipTransferModal
      surveyId="s-1"
      surveyTitle="2026 실태조사"
      currentOwnerName="이소유"
      currentOwnerUserId="u-owner"
      onClose={onClose}
    />,
  );
  return { onClose };
}

/**
 * 소유권 이전 모달 — 되돌리는 표면이 없는 동작이라 두 번 눌러야 넘어가고, 설문이 팀을 옮겨 가는
 * 선택은 누르기 전에 알린다.
 */
describe('OwnershipTransferModal', () => {
  beforeEach(() => {
    transfer.mutateAsync.mockClear();
  });

  it('「소유권 이전」 한 번으로는 넘어가지 않는다 — 확인 줄을 열 뿐이다', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.selectOptions(screen.getByLabelText('새 소유자'), 'u-team');
    await user.click(screen.getByRole('button', { name: '소유권 이전' }));

    expect(transfer.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('김팀원')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이전 확정' })).toBeInTheDocument();
  });

  it('「이전 확정」이 고른 사람과 지금 소유자를 실어 보내고 창을 닫는다', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.selectOptions(screen.getByLabelText('새 소유자'), 'u-team');
    await user.click(screen.getByRole('button', { name: '소유권 이전' }));
    await user.click(screen.getByRole('button', { name: '이전 확정' }));

    expect(transfer.mutateAsync).toHaveBeenCalledWith({
      surveyId: 's-1',
      newOwnerUserId: 'u-team',
      expectedOwnerUserId: 'u-owner',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('「돌아가기」는 보내지 않고 고르는 화면으로 돌아간다', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.selectOptions(screen.getByLabelText('새 소유자'), 'u-team');
    await user.click(screen.getByRole('button', { name: '소유권 이전' }));
    await user.click(screen.getByRole('button', { name: '돌아가기' }));

    expect(transfer.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '소유권 이전' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이전 확정' })).toBeNull();
  });

  it('고른 사람을 바꾸면 확인도 처음부터다', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.selectOptions(screen.getByLabelText('새 소유자'), 'u-team');
    await user.click(screen.getByRole('button', { name: '소유권 이전' }));
    await user.selectOptions(screen.getByLabelText('새 소유자'), 'u-other');

    expect(screen.queryByRole('button', { name: '이전 확정' })).toBeNull();
    expect(transfer.mutateAsync).not.toHaveBeenCalled();
  });

  it('소유 팀 밖의 참여자를 고르면 설문이 그 사람의 팀으로 옮겨 간다고 알린다', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.selectOptions(screen.getByLabelText('새 소유자'), 'u-other');

    const notice = screen.getByRole('status');
    expect(within(notice).getByText(/이 사람의 팀으로 옮겨 가고/)).toBeInTheDocument();
    expect(within(notice).getByText(/미분류/)).toBeInTheDocument();
  });

  it('같은 팀 사람을 고르면 팀 이동 안내가 없다', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.selectOptions(screen.getByLabelText('새 소유자'), 'u-team');

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('실패하면 사유를 보이고 확인 줄에 머문다 — 창을 닫지 않는다', async () => {
    const user = userEvent.setup();
    transfer.mutateAsync.mockRejectedValueOnce(new Error('소유자가 그 사이 바뀌었습니다.'));
    const { onClose } = renderModal();

    await user.selectOptions(screen.getByLabelText('새 소유자'), 'u-team');
    await user.click(screen.getByRole('button', { name: '소유권 이전' }));
    await user.click(screen.getByRole('button', { name: '이전 확정' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '이전 확정' })).toBeInTheDocument();
  });
});
