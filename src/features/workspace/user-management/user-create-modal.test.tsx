/**
 * 사용자 생성 모달 (.pen FLOW 1-2) — 서버로 무엇을 보내는가.
 *
 * **만들 수 있는 유형이 직원 하나다** (ADR-0029). 외주 실사와 클라이언트가 둘 다 설문별
 * 링크로 바뀌어, 실사·게스트 계정을 발급해도 쓸 곳이 없다 — 로그인만 되고 아무 설문도 못
 * 여는 계정이 쌓인다. 유형이 하나뿐이라 고르는 세그먼트 자체가 없다. 옛 모델의 코드는
 * 남아 있다 — 닫은 것은 입구다.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserCreateModal } from './user-create-modal';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('./queries/use-users', () => ({
  useCreateUser: () => ({ mutateAsync, isPending: false }),
}));

const onOpenChange = vi.fn();

function renderModal() {
  return render(<UserCreateModal open onOpenChange={onOpenChange} />);
}

async function fillCommon(user: ReturnType<typeof userEvent.setup>, password = 'initial-pw-12') {
  await user.type(screen.getByLabelText('이름'), '김새로');
  await user.type(screen.getByLabelText('이메일 (로그인 ID)'), 'saero.kim@megaresearch.co.kr');
  await user.type(screen.getByLabelText('초기 비밀번호'), password);
}

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({ id: 'new-user' });
});

describe('UserCreateModal', () => {
  it('유형을 고르는 자리가 없다 — 만들 수 있는 것이 직원 하나다', () => {
    renderModal();
    expect(screen.queryByText('계정 유형')).toBeNull();
    for (const label of ['직원', '게스트', '실사']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    // 유형별로 갈리던 칸도 함께 없다.
    expect(screen.queryByLabelText('소속 기관')).toBeNull();
    expect(screen.queryByLabelText('소속 업체')).toBeNull();
  });

  it('직책과 (아직 비활성인) 팀 배정을 보여준다', () => {
    renderModal();
    expect(screen.getByLabelText('직책')).toBeEnabled();
    expect(screen.getByLabelText('팀 배정 (선택)')).toBeDisabled();
  });

  it('내부 계정 생성은 직책을 실어 보낸다', async () => {
    const user = userEvent.setup();
    renderModal();
    await fillCommon(user);
    await user.type(screen.getByLabelText('직책'), '연구원');
    await user.click(screen.getByRole('button', { name: '생성' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      userType: 'internal',
      name: '김새로',
      email: 'saero.kim@megaresearch.co.kr',
      password: 'initial-pw-12',
      jobTitle: '연구원',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('8자 미만 비밀번호는 서버로 보내지 않는다', async () => {
    const user = userEvent.setup();
    renderModal();
    await fillCommon(user, 'short7c');
    await user.click(screen.getByRole('button', { name: '생성' }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('비밀번호는 최소 8자 이상이어야 합니다.')).toBeInTheDocument();
  });

  it('서버 거부 문구를 그대로 보여주고 모달을 닫지 않는다', async () => {
    mutateAsync.mockRejectedValue(new Error('이미 사용 중인 이메일입니다.'));
    const user = userEvent.setup();
    renderModal();
    await fillCommon(user);
    await user.click(screen.getByRole('button', { name: '생성' }));

    expect(screen.getByText('이미 사용 중인 이메일입니다.')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
