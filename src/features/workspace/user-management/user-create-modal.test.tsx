/**
 * 사용자 생성 모달 (.pen FLOW 1-2) — 유형에 따라 필드가 바뀌고, 서버로 무엇을 보내는가.
 *
 * 실사 세그먼트는 노출하되 비활성이라는 것도 여기서 고정한다. 서버(CreateUserInput 유니온)가
 * 유일한 판정자이지만, 화면이 먼저 막아야 "눌렀는데 400" 이 되지 않는다.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('./queries/use-users', () => ({
  useCreateUser: () => ({ mutateAsync, isPending: false }),
}));

import { UserCreateModal } from './user-create-modal';

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
  it('실사 세그먼트는 노출하되 비활성이다 (티켓 24 에서 열림)', () => {
    renderModal();
    expect(screen.getByRole('button', { name: '실사' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '내부' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '게스트' })).toBeEnabled();
  });

  it('내부 유형은 직책과 (아직 비활성인) 팀 배정을 보여준다', () => {
    renderModal();
    expect(screen.getByLabelText('직책')).toBeEnabled();
    expect(screen.getByLabelText('팀 배정 (선택)')).toBeDisabled();
    expect(screen.queryByLabelText('소속 기관')).not.toBeInTheDocument();
  });

  it('게스트 유형으로 바꾸면 소속 기관 필드로 교체된다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: '게스트' }));

    expect(screen.getByLabelText('소속 기관')).toBeInTheDocument();
    expect(screen.queryByLabelText('직책')).not.toBeInTheDocument();
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

  it('게스트 계정 생성은 소속 기관을 실어 보낸다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: '게스트' }));
    await fillCommon(user);
    await user.type(screen.getByLabelText('소속 기관'), '한국물류협회');
    await user.click(screen.getByRole('button', { name: '생성' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      userType: 'guest',
      name: '김새로',
      email: 'saero.kim@megaresearch.co.kr',
      password: 'initial-pw-12',
      organization: '한국물류협회',
    });
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
