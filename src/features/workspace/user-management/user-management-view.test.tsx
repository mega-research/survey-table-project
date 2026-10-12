import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./queries/use-users', () => ({
  useUsers: () => ({
    data: {
      items: [
        {
          id: 'u-fw',
          name: '박실사',
          email: 'fw@example.com',
          userType: 'fieldwork',
          status: 'active',
          isSuperadmin: false,
          jobTitle: null,
          organization: null,
          fieldworkOrgId: 'org-1',
          fieldworkOrgName: '그린리서치',
          fieldworkRole: 'worker',
        },
      ],
      typeCounts: { all: 1, internal: 0, guest: 0, fieldwork: 1 },
    },
    isLoading: false,
    error: null,
  }),
  useCreateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChangeUserStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { UserManagementView } from './user-management-view';

/**
 * 사용자 관리 화면의 실사 입구 (ADR-0029).
 *
 * 닫힌 것은 **발급**이다 — 「협력 업체」 탭과 거기서 여는 계정 발급. 이미 있는 실사 계정은
 * 목록에 그대로 보이고 유형 칩으로 걸러진다: 남은 계정을 정리(정지·퇴사·비밀번호 재설정)할
 * 수 있어야 하기 때문이다.
 */
describe('UserManagementView — 실사 입구', () => {
  it('협력 업체 탭이 없다', () => {
    render(<UserManagementView />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText(/협력 업체/)).toBeNull();
  });

  it('이미 있는 실사 계정은 목록에 보이고 유형 칩으로 걸러 볼 수 있다', () => {
    render(<UserManagementView />);
    expect(screen.getByText('박실사')).toBeInTheDocument();
    expect(screen.getByText('그린리서치')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '실사 1' })).toBeInTheDocument();
  });

  it('사용자 생성 버튼은 그대로 있다', () => {
    render(<UserManagementView />);
    expect(screen.getByRole('button', { name: /사용자 생성/ })).toBeInTheDocument();
  });
});
