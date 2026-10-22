import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserListItem } from '@/shared/contracts/auth-io';

import { UserManagementView } from './user-management-view';

const FIELDWORK_USER: UserListItem = {
  id: '00000000-0000-4000-8000-000000000001',
  name: '박실사',
  email: 'fw@example.com',
  userType: 'fieldwork',
  status: 'active',
  isSuperadmin: false,
  jobTitle: null,
  organization: null,
  fieldworkOrgId: '00000000-0000-4000-8000-0000000000aa',
  fieldworkOrgName: '그린리서치',
  fieldworkRole: 'worker',
  teamNames: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};

function staff(
  name: string,
  status: UserListItem['status'],
  teamNames: string[] = [],
): UserListItem {
  return {
    ...FIELDWORK_USER,
    id: crypto.randomUUID(),
    name,
    email: `${encodeURIComponent(name)}@example.com`,
    userType: 'internal',
    status,
    fieldworkOrgId: null,
    fieldworkOrgName: null,
    fieldworkRole: null,
    teamNames,
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

beforeEach(() => {
  mockItems = [FIELDWORK_USER];
});

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

/** 표 본문 행의 이름 — 첫 칸의 이름·이메일 묶음 중 윗줄. */
function rowNames(): string[] {
  const body = screen.getAllByRole('rowgroup')[1]!;
  return within(body)
    .getAllByRole('row')
    .map((row) => row.querySelector('td span.flex-col > span:first-child')?.textContent ?? '');
}

/**
 * 서버는 발급순으로 준다 — 테스트하다 퇴사 처리한 계정이 앞에 몰려 지금 일하는 사람이
 * 밀려나 있었다. 기본 보기는 퇴사자를 빼고, 상태 머리글을 누르면 상태순으로 정렬한다.
 */
describe('UserManagementView — 상태 머리글 정렬', () => {
  beforeEach(() => {
    mockItems = [
      staff('먼저퇴사', 'departed'),
      staff('재직가', 'active'),
      staff('정지자', 'suspended'),
      staff('나중퇴사', 'departed'),
      staff('재직나', 'active'),
    ];
  });

  it('기본 보기에는 퇴사자가 없고 숫자도 드러내지 않는다', () => {
    render(<UserManagementView />);
    expect(rowNames()).toEqual(['재직가', '정지자', '재직나']);
    expect(within(screen.getByRole('table')).queryByText(/퇴사/)).toBeNull();
  });

  it('누를 때마다 상태 오름차순 → 내림차순 → 기본으로 돈다', async () => {
    const user = userEvent.setup();
    render(<UserManagementView />);
    const header = screen.getByRole('button', { name: '상태' });

    await user.click(header);
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    expect(rowNames()).toEqual(['재직가', '재직나', '정지자', '먼저퇴사', '나중퇴사']);

    await user.click(header);
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'descending');
    expect(rowNames()).toEqual(['먼저퇴사', '나중퇴사', '정지자', '재직가', '재직나']);

    await user.click(header);
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'none');
    expect(rowNames()).toEqual(['재직가', '정지자', '재직나']);
  });

  it('상태 필터로 퇴사를 고르면 정렬 없이도 퇴사자가 보인다', async () => {
    const user = userEvent.setup();
    mockItems = mockItems.filter((item) => item.status === 'departed');
    render(<UserManagementView />);
    await user.selectOptions(screen.getByLabelText('상태 필터'), 'departed');
    expect(rowNames()).toEqual(['먼저퇴사', '나중퇴사']);
  });
});

describe('UserManagementView — 페이지네이션', () => {
  it('20명씩 끊고 다음 쪽으로 넘긴다', async () => {
    const user = userEvent.setup();
    mockItems = Array.from({ length: 25 }, (_, i) => staff(`직원${i + 1}`, 'active'));
    render(<UserManagementView />);
    expect(rowNames()).toHaveLength(20);
    expect(rowNames()[0]).toBe('직원1');

    await user.click(screen.getByRole('button', { name: '다음 페이지' }));
    expect(rowNames()).toEqual(['직원21', '직원22', '직원23', '직원24', '직원25']);
  });

  it('정렬을 바꾸면 첫 쪽으로 돌아간다', async () => {
    const user = userEvent.setup();
    mockItems = Array.from({ length: 25 }, (_, i) => staff(`직원${i + 1}`, 'active'));
    render(<UserManagementView />);
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: '상태' }));
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('UserManagementView — 소속 칸', () => {
  it('직원은 소속 팀을 보여 주고, 겸직이면 팀마다 한 줄이다', () => {
    mockItems = [
      staff('팀원', 'active', ['연구3본부 5팀']),
      staff('본부장', 'active', ['연구3본부 5팀', '연구3본부 6팀']),
      staff('미배치', 'active'),
    ];
    render(<UserManagementView />);
    const body = screen.getAllByRole('rowgroup')[1]!;
    const [member, head, unassigned] = within(body).getAllByRole('row');
    expect(within(member!).getByText('연구3본부 5팀')).toBeInTheDocument();
    expect(within(head!).getByText('연구3본부 5팀')).toBeInTheDocument();
    expect(within(head!).getByText('연구3본부 6팀')).toBeInTheDocument();
    expect(within(unassigned!).getAllByText('—').length).toBeGreaterThan(0);
  });
});
