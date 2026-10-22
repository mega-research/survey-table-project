import { describe, expect, it } from 'vitest';

import type { UserListItem } from '@/shared/contracts/auth-io';

import { type UserSort, arrangeUsers, nextUserSort } from './user-list-arrange';

function user(name: string, overrides: Partial<UserListItem> = {}): UserListItem {
  return {
    id: crypto.randomUUID(),
    name,
    email: `${name}@example.com`,
    userType: 'internal',
    status: 'active',
    isSuperadmin: false,
    jobTitle: null,
    organization: null,
    fieldworkOrgId: null,
    fieldworkOrgName: null,
    fieldworkRole: null,
    teamNames: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const names = (rows: UserListItem[]) => rows.map((row) => row.name);

function arrange(items: UserListItem[], sort: UserSort, query = '') {
  return names(arrangeUsers(items, { sort, statusFilter: 'all', query }));
}

describe('nextUserSort', () => {
  it('같은 열은 오름차순 → 내림차순 → 정렬 없음으로 돈다', () => {
    const asc = nextUserSort(null, 'type');
    expect(asc).toEqual({ key: 'type', direction: 'asc' });
    const desc = nextUserSort(asc, 'type');
    expect(desc).toEqual({ key: 'type', direction: 'desc' });
    expect(nextUserSort(desc, 'type')).toBeNull();
  });

  it('다른 열을 누르면 그 열의 오름차순부터 시작한다', () => {
    expect(nextUserSort({ key: 'type', direction: 'desc' }, 'status')).toEqual({
      key: 'status',
      direction: 'asc',
    });
  });
});

describe('arrangeUsers — 직책 정렬', () => {
  const items = [
    user('대리A', { jobTitle: '대리' }),
    user('빈칸', { jobTitle: null }),
    user('사장A', { jobTitle: '사장' }),
    user('모름', { jobTitle: '선임연구원' }),
    user('과장A', { jobTitle: '과장' }),
    user('부장A', { jobTitle: '부장' }),
  ];

  it('오름차순은 높은 직급부터이고, 모르는 직책은 아는 직급 뒤, 빈 칸은 끝이다', () => {
    expect(arrange(items, { key: 'jobTitle', direction: 'asc' })).toEqual([
      '사장A',
      '부장A',
      '과장A',
      '대리A',
      '모름',
      '빈칸',
    ]);
  });

  it('내림차순에서도 빈 칸은 끝이다', () => {
    expect(arrange(items, { key: 'jobTitle', direction: 'desc' })).toEqual([
      '모름',
      '대리A',
      '과장A',
      '부장A',
      '사장A',
      '빈칸',
    ]);
  });

  it('실사는 업체 내 역할 글자로 선다', () => {
    const rows = [
      user('실사원', { userType: 'fieldwork', fieldworkRole: 'worker' }),
      user('대리B', { jobTitle: '대리' }),
    ];
    expect(arrange(rows, { key: 'jobTitle', direction: 'asc' })).toEqual(['대리B', '실사원']);
  });
});

describe('arrangeUsers — 유형 정렬', () => {
  it('직원 → 게스트 → 실사 순이고 같은 유형 안은 발급순이다', () => {
    const items = [
      user('실사1', { userType: 'fieldwork' }),
      user('직원1'),
      user('게스트1', { userType: 'guest' }),
      user('직원2'),
    ];
    expect(arrange(items, { key: 'type', direction: 'asc' })).toEqual([
      '직원1',
      '직원2',
      '게스트1',
      '실사1',
    ]);
  });
});

describe('arrangeUsers — 퇴사자', () => {
  const items = [user('퇴사자', { status: 'departed' }), user('재직자')];

  it('기본 보기와 유형·직책 정렬에는 퇴사자가 없다', () => {
    expect(arrange(items, null)).toEqual(['재직자']);
    expect(arrange(items, { key: 'type', direction: 'asc' })).toEqual(['재직자']);
    expect(arrange(items, { key: 'jobTitle', direction: 'desc' })).toEqual(['재직자']);
  });

  it('상태 정렬과 상태 필터에는 퇴사자가 나온다', () => {
    expect(arrange(items, { key: 'status', direction: 'asc' })).toEqual(['재직자', '퇴사자']);
    expect(names(arrangeUsers(items, { sort: null, statusFilter: 'departed', query: '' }))).toEqual(
      ['퇴사자', '재직자'],
    );
  });
});

describe('arrangeUsers — 검색', () => {
  const items = [
    user('김현아', { email: 'kim.hyuna@megaresearch.co.kr' }),
    user('이정운', { email: 'ljw@megaresearch.co.kr' }),
  ];

  it('이름 부분 일치로 거른다', () => {
    expect(arrange(items, null, '현아')).toEqual(['김현아']);
  });

  it('이메일도 대소문자 없이 찾는다', () => {
    expect(arrange(items, null, '  LJW ')).toEqual(['이정운']);
  });

  it('빈 검색어는 전부 통과다', () => {
    expect(arrange(items, null, '   ')).toEqual(['김현아', '이정운']);
  });
});
