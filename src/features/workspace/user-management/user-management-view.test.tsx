import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserListItem } from '@/shared/contracts/auth-io';

import { UserManagementView } from './user-management-view';

const FIELDWORK_USER: UserListItem = {
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
  createdAt: '2026-01-01T00:00:00.000Z',
};

function internalUser(id: string, name: string, status: UserListItem['status']): UserListItem {
  return {
    ...FIELDWORK_USER,
    id,
    name,
    email: `${id}@example.com`,
    userType: 'internal',
    status,
    fieldworkOrgId: null,
    fieldworkOrgName: null,
    fieldworkRole: null,
  };
}

let mockItems: UserListItem[] = [FIELDWORK_USER];

vi.mock('./queries/use-users', () => ({
  useUsers: () => ({
    data: {
      items: mockItems,
      typeCounts: { all: mockItems.length, internal: 0, guest: 0, fieldwork: 1 },
    },
    isLoading: false,
    error: null,
  }),
  useCreateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChangeUserStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

/**
 * 사용자 관리 화면의 실사 입구 (ADR-0029).
 *
 * 닫힌 것은 **발급**이다 — 「협력 업체」 탭과 거기서 여는 계정 발급. 이미 있는 실사 계정은
 * 목록에 그대로 보이고 유형 칩으로 걸러진다: 남은 계정을 정리(정지·퇴사·비밀번호 재설정)할
 * 수 있어야 하기 때문이다.
 */
beforeEach(() => {
  mockItems = [FIELDWORK_USER];
});

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

/**
 * 서버는 발급순으로 준다 — 테스트하다 퇴사 처리한 계정이 앞에 몰려 지금 일하는 사람이
 * 밀려나 있었다. 퇴사자는 뒤로 보내고 기본으로 접는다.
 */
describe('UserManagementView — 퇴사자는 뒤로 접는다', () => {
  beforeEach(() => {
    mockItems = [
      internalUser('u-1', '먼저퇴사', 'departed'),
      internalUser('u-2', '재직자가', 'active'),
      internalUser('u-3', '정지자', 'suspended'),
      internalUser('u-4', '나중퇴사', 'departed'),
      internalUser('u-5', '재직자나', 'active'),
    ];
  });

  /** 상태 머리글 버튼 — 표 아래 줄 버튼과 이름이 같아 머리글 안에서 찾는다. */
  function statusHeader(name: string) {
    const thead = screen.getAllByRole('rowgroup')[0]!;
    return within(thead).getByRole('button', { name });
  }

  function rowNames() {
    return screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByText(/./)[1]?.textContent);
  }

  it('처음에는 퇴사자가 보이지 않고, 나머지는 발급순 그대로다', () => {
    render(<UserManagementView />);
    expect(rowNames()).toEqual(['재직자가', '정지자', '재직자나']);
    expect(screen.queryByText('먼저퇴사')).toBeNull();
  });

  it('상태 머리글을 누르면 퇴사자가 재직자 뒤에 붙고, 다시 누르면 접힌다', async () => {
    const user = userEvent.setup();
    render(<UserManagementView />);
    const header = statusHeader('퇴사자 2명 보기');
    expect(header).toHaveAttribute('aria-expanded', 'false');

    await user.click(header);
    expect(rowNames()).toEqual(['재직자가', '정지자', '재직자나', '먼저퇴사', '나중퇴사']);

    await user.click(statusHeader('퇴사자 2명 숨기기'));
    expect(screen.queryByText('먼저퇴사')).toBeNull();
  });

  it('표 아래 줄로도 펼칠 수 있다', async () => {
    const user = userEvent.setup();
    render(<UserManagementView />);
    await user.click(screen.getByText('퇴사자 2명 보기'));
    expect(screen.getByText('나중퇴사')).toBeInTheDocument();
  });

  it('상태 필터로 퇴사를 고르면 접지 않는다', async () => {
    const user = userEvent.setup();
    render(<UserManagementView />);
    await user.selectOptions(screen.getByLabelText('상태 필터'), 'departed');
    expect(screen.getByText('먼저퇴사')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /퇴사자 \d+명/ })).toBeNull();
  });

  it('퇴사자만 있어도 「사용자가 없다」고 하지 않는다', () => {
    mockItems = [internalUser('u-1', '먼저퇴사', 'departed')];
    render(<UserManagementView />);
    expect(screen.queryByText('조건에 맞는 사용자가 없습니다.')).toBeNull();
    expect(statusHeader('퇴사자 1명 보기')).toBeInTheDocument();
  });
});
