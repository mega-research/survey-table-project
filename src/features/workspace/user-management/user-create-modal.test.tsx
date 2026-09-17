/**
 * 사용자 생성 모달 (.pen FLOW 1-2) — 유형에 따라 필드가 바뀌고, 서버로 무엇을 보내는가.
 *
 * 티켓 24 로 실사 세그먼트가 열렸다 — 소속 업체와 역할이 **함께** 실려 나가는지가 이 파일의
 * 새 축이다. 서버(CreateUserInput 유니온 + 0120 CHECK)가 유일한 판정자이지만, 화면이 먼저
 * 막아야 "눌렀는데 400" 이 되지 않는다.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserCreateModal } from './user-create-modal';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('./queries/use-users', () => ({
  useCreateUser: () => ({ mutateAsync, isPending: false }),
}));

// 업체 선택지는 서버에서 온다 — 모달이 그 목록을 어떻게 그리는지가 관심사이고 조회 자체는 아니다.
vi.mock('../fieldwork-orgs/queries/use-fieldwork-orgs', () => ({
  useFieldworkOrgOptions: () => ({
    data: [
      { id: '3f000000-0000-4000-8000-00000000a001', name: '그린리서치' },
      { id: '3f000000-0000-4000-8000-00000000a002', name: '블루서베이' },
    ],
  }),
}));

const GREEN_ORG_ID = '3f000000-0000-4000-8000-00000000a001';

const onOpenChange = vi.fn();

function renderModal(props: { presetFieldworkOrgId?: string } = {}) {
  return render(<UserCreateModal open onOpenChange={onOpenChange} {...props} />);
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
  it('세 유형 세그먼트가 모두 열려 있다 (티켓 24)', () => {
    renderModal();
    for (const label of ['내부', '게스트', '실사']) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    }
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

  it('실사 유형은 소속 업체 셀렉트와 역할 세그먼트로 바뀐다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: '실사' }));

    expect(screen.getByLabelText('소속 업체')).toBeEnabled();
    expect(screen.getByRole('button', { name: '실사 팀장' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '실사원' })).toBeInTheDocument();
    // 유형별 칸은 서로 배타다 — 남아 있으면 안 쓰는 값이 함께 실려 나간다.
    expect(screen.queryByLabelText('직책')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('소속 기관')).not.toBeInTheDocument();
  });

  it('실사 계정 생성은 업체 id 와 역할을 함께 실어 보낸다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: '실사' }));
    await fillCommon(user);
    await user.selectOptions(screen.getByLabelText('소속 업체'), GREEN_ORG_ID);
    await user.click(screen.getByRole('button', { name: '실사 팀장' }));
    await user.click(screen.getByRole('button', { name: '생성' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      userType: 'fieldwork',
      name: '김새로',
      email: 'saero.kim@megaresearch.co.kr',
      password: 'initial-pw-12',
      fieldworkOrgId: GREEN_ORG_ID,
      fieldworkRole: 'leader',
    });
  });

  it('업체를 고르지 않으면 서버로 보내지 않는다 — 소속 없는 실사 계정은 없다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: '실사' }));
    await fillCommon(user);
    await user.click(screen.getByRole('button', { name: '생성' }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('소속 업체를 선택하세요.')).toBeInTheDocument();
  });

  it('업체 카드에서 열면 유형이 실사로 잠기고 업체가 미리 정해진다', async () => {
    const user = userEvent.setup();
    renderModal({ presetFieldworkOrgId: GREEN_ORG_ID });

    // 「이 업체에 계정을 만든다」가 그 버튼의 뜻이라 유형을 바꿀 수 없어야 한다.
    expect(screen.getByRole('button', { name: '내부' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '게스트' })).toBeDisabled();
    expect(screen.getByLabelText('소속 업체')).toBeDisabled();

    await fillCommon(user);
    await user.click(screen.getByRole('button', { name: '생성' }));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ userType: 'fieldwork', fieldworkOrgId: GREEN_ORG_ID }),
    );
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
