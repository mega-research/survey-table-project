/**
 * 프로필 화면 (.pen FLOW 3-2) — 무엇을 바꿀 수 있고 무엇이 읽기 전용인가.
 *
 * 화면이 지켜야 할 핵심은 "본인이 바꿀 수 없는 것은 폼에 없다" 는 것이다. 서버가 유일한
 * 판정자이지만(UpdateProfileInput 에 이메일·직책이 없다), 화면이 입력칸을 열어두면
 * 채워 넣고 저장한 뒤에야 아무 일도 없었다는 걸 알게 된다.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProfileView as Profile } from '@/shared/contracts/auth-io';

const { profileQuery, updateProfile, updatePassword, uploadAvatar } = vi.hoisted(() => ({
  profileQuery: { data: undefined as Profile | undefined, isLoading: false, error: null as unknown },
  updateProfile: vi.fn(),
  updatePassword: vi.fn(),
  uploadAvatar: vi.fn(),
}));

vi.mock('./queries/use-profile', () => ({
  useProfile: () => profileQuery,
  useUpdateProfile: () => ({ mutateAsync: updateProfile, isPending: false }),
  useUpdatePassword: () => ({ mutateAsync: updatePassword, isPending: false }),
  uploadAvatar,
}));

import { ProfileView } from './profile-view';

const INTERNAL: Profile = {
  id: '55555555-5555-4555-8555-555555555555',
  name: '김새로',
  email: 'saero.kim@megaresearch.co.kr',
  image: null,
  userType: 'internal',
  jobTitle: '연구원',
  organization: null,
};

function renderView(profile: Profile = INTERNAL) {
  profileQuery.data = profile;
  profileQuery.isLoading = false;
  profileQuery.error = null;
  return render(<ProfileView />);
}

beforeEach(() => {
  vi.clearAllMocks();
  updateProfile.mockResolvedValue(INTERNAL);
  updatePassword.mockResolvedValue({ success: true });
  uploadAvatar.mockResolvedValue('https://cdn.example.com/avatars/u/a.webp');
});

describe('ProfileView — 기본 정보', () => {
  it('이메일과 직책은 읽기 전용이고 이름만 고칠 수 있다', () => {
    renderView();
    expect(screen.getByLabelText('이름')).not.toHaveAttribute('readonly');
    expect(screen.getByLabelText('이메일 (로그인 ID)')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('직책')).toHaveAttribute('readonly');
  });

  it('직책을 본인이 바꿀 수 없다는 것을 문구로 말한다', () => {
    renderView();
    expect(screen.getByText(/직책은 팀장·슈퍼어드민이 팀 상세에서 변경합니다/)).toBeInTheDocument();
  });

  it('게스트에게는 직책 대신 소속을 보여준다', () => {
    // .pen: 게스트·실사는 이름·아바타·비밀번호만 만진다.
    renderView({ ...INTERNAL, userType: 'guest', jobTitle: null, organization: '한국물류협회' });
    expect(screen.getByLabelText('소속')).toHaveValue('한국물류협회');
    expect(screen.queryByLabelText('직책')).not.toBeInTheDocument();
  });

  it('이름 변경을 저장하면 이름과 아바타만 보낸다', async () => {
    const user = userEvent.setup();
    renderView();
    await user.clear(screen.getByLabelText('이름'));
    await user.type(screen.getByLabelText('이름'), '김바뀜');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(updateProfile).toHaveBeenCalledWith({ name: '김바뀜', image: null });
  });

  it('업로드한 아바타는 저장할 때 함께 실린다', async () => {
    const user = userEvent.setup();
    renderView();
    await user.upload(
      screen.getByLabelText('아바타 이미지 파일'),
      new File(['x'], 'me.png', { type: 'image/png' }),
    );
    expect(uploadAvatar).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(updateProfile).toHaveBeenCalledWith({
      name: '김새로',
      image: 'https://cdn.example.com/avatars/u/a.webp',
    });
  });

  it('허용하지 않는 형식은 업로드하지 않고 문구를 띄운다', async () => {
    renderView();
    // accept 속성은 파일 대화상자의 필터일 뿐 "모든 파일" 로 우회할 수 있다. userEvent.upload 는
    // 그 필터를 흉내 내 파일을 아예 떨어뜨리므로, 우회한 상황을 보려면 change 를 직접 쏜다.
    fireEvent.change(screen.getByLabelText('아바타 이미지 파일'), {
      target: { files: [new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })] },
    });

    expect(uploadAvatar).not.toHaveBeenCalled();
    expect(await screen.findByText(/JPG, PNG, WebP, BMP 파일만/)).toBeInTheDocument();
  });

  it('아바타를 기본 이미지로 되돌리면 null 로 저장한다', async () => {
    const user = userEvent.setup();
    renderView({ ...INTERNAL, image: 'https://cdn.example.com/avatars/u/old.webp' });
    await user.click(screen.getByRole('button', { name: '기본 이미지로 되돌리기' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(updateProfile).toHaveBeenCalledWith({ name: '김새로', image: null });
  });

  it('돌아갈 곳은 계정 유형이 정한다', () => {
    const { unmount } = renderView();
    expect(screen.getByRole('link', { name: '돌아가기' })).toHaveAttribute('href', '/admin/surveys');
    unmount();

    renderView({ ...INTERNAL, userType: 'fieldwork' });
    expect(screen.getByRole('link', { name: '돌아가기' })).toHaveAttribute('href', '/fieldwork');
  });
});

describe('ProfileView — 비밀번호 변경', () => {
  it('다른 기기 세션만 해제된다는 것을 미리 말한다', () => {
    renderView();
    expect(
      screen.getByText(/변경하면 다른 기기의 로그인이 모두 해제됩니다 \(현재 세션 유지\)/),
    ).toBeInTheDocument();
  });

  it('세 칸을 그대로 보낸다', async () => {
    const user = userEvent.setup();
    renderView();
    await user.type(screen.getByLabelText('현재 비밀번호'), 'old-pw-12');
    await user.type(screen.getByLabelText('새 비밀번호'), 'new-pw-123');
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'new-pw-123');
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }));

    expect(updatePassword).toHaveBeenCalledWith({
      currentPassword: 'old-pw-12',
      newPassword: 'new-pw-123',
      confirmPassword: 'new-pw-123',
    });
    expect(await screen.findByText('비밀번호를 변경했습니다.')).toBeInTheDocument();
  });

  it('현재 비밀번호가 틀리면 문구를 띄우고 성공으로 치지 않는다', async () => {
    // 실패가 예외가 아니라 { error } 로 온다 — mutation 성공을 변경 성공으로 읽으면 안 된다.
    updatePassword.mockResolvedValue({ error: '현재 비밀번호가 올바르지 않습니다.' });
    const user = userEvent.setup();
    renderView();
    await user.type(screen.getByLabelText('현재 비밀번호'), 'wrong-pw-1');
    await user.type(screen.getByLabelText('새 비밀번호'), 'new-pw-123');
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'new-pw-123');
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }));

    expect(await screen.findByText('현재 비밀번호가 올바르지 않습니다.')).toBeInTheDocument();
    expect(screen.queryByText('비밀번호를 변경했습니다.')).not.toBeInTheDocument();
  });
});
