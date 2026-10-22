import type { UserStatus, UserType } from '@/shared/contracts/auth';
import { FIELDWORK_ROLE_LABEL } from '@/shared/contracts/auth';
import type { UserListItem, UserStatusFilter } from '@/shared/contracts/auth-io';

/** 사용자 표에서 정렬할 수 있는 열. */
export type UserSortKey = 'type' | 'jobTitle' | 'status';

/** 정렬 상태 — null 이면 서버가 준 발급순. */
export type UserSort = { key: UserSortKey; direction: 'asc' | 'desc' } | null;

/**
 * 머리글을 눌렀을 때의 다음 정렬.
 *
 * 같은 열은 오름차순 → 내림차순 → 정렬 없음으로 돌고, 다른 열을 누르면 그 열의 오름차순부터
 * 시작한다.
 */
export function nextUserSort(current: UserSort, key: UserSortKey): UserSort {
  if (current?.key !== key) return { key, direction: 'asc' };
  return current.direction === 'asc' ? { key, direction: 'desc' } : null;
}

/** 유형 순서 — 유형 칩과 같은 순서(직원 → 게스트 → 실사). */
const TYPE_RANK: Record<UserType, number> = { internal: 0, guest: 1, fieldwork: 2 };

/** 상태 순서 — 지금 일하는 사람이 앞, 퇴사가 끝. pending·rejected 는 v2 에서 도달 불가 어휘다. */
const STATUS_RANK: Record<UserStatus, number> = {
  active: 0,
  suspended: 1,
  pending: 2,
  rejected: 3,
  departed: 4,
};

/**
 * 직책 순서 — 오름차순이 높은 직급부터다.
 *
 * 직책은 자유 입력이라 가나다순으로 세우면 「과장 · 대리 · 부장 · 사장」처럼 위계가 뒤섞인다.
 * 아는 직급은 이 표의 순서로, 모르는 값은 그 뒤에 가나다순으로 선다.
 */
const JOB_TITLE_ORDER = [
  '대표',
  '사장',
  '부사장',
  '전무',
  '상무',
  '이사',
  '본부장',
  '실장',
  '팀장',
  '부장',
  '차장',
  '과장',
  '대리',
  '주임',
  '연구원',
  '사원',
  '인턴',
];

/** 「직책·역할」 칸에 보이는 글자 — 실사는 업체 내 역할, 나머지는 직책. 정렬도 이 글자를 본다. */
export function userRoleLabel(user: UserListItem): string | null {
  return user.fieldworkRole ? FIELDWORK_ROLE_LABEL[user.fieldworkRole] : user.jobTitle;
}

function compareJobTitle(a: string, b: string): number {
  const rankA = JOB_TITLE_ORDER.indexOf(a);
  const rankB = JOB_TITLE_ORDER.indexOf(b);
  if (rankA !== -1 && rankB !== -1) return rankA - rankB;
  if (rankA !== -1) return -1;
  if (rankB !== -1) return 1;
  return a.localeCompare(b, 'ko');
}

function compareUsers(a: UserListItem, b: UserListItem, key: UserSortKey): number {
  if (key === 'type') return TYPE_RANK[a.userType] - TYPE_RANK[b.userType];
  if (key === 'status') return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  return compareJobTitle(userRoleLabel(a) ?? '', userRoleLabel(b) ?? '');
}

/**
 * 이름·이메일·소속 팀 부분 일치 — 대소문자와 앞뒤 공백을 무시한다. 빈 검색어는 전부 통과다.
 * 팀 이름까지 보는 것은 「연구3본부」처럼 본부 단위로 묶어 보려는 것이다(필터는 팀 하나만 고른다).
 */
function matchesQuery(user: UserListItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [user.name, user.email, ...user.teamNames].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

/**
 * 소속 필터 — 팀 하나, 또는 팀이 없는 직원(미배치).
 *
 * 팀은 이름으로 고른다. 목록 행이 들고 오는 것이 팀 이름이고, 활성 팀 이름은 DB 가 유일을
 * 강제한다(`teams_active_name_uq`). 겸직자는 자기가 속한 어느 팀을 골라도 나온다.
 * 미배치는 직원만이다 — 게스트·실사는 애초에 팀에 들 수 없어 「팀 없음」이 빈칸이 아니다.
 */
export type UserTeamFilter =
  { kind: 'all' } | { kind: 'unassigned' } | { kind: 'team'; name: string };

function matchesTeam(user: UserListItem, team: UserTeamFilter): boolean {
  if (team.kind === 'all') return true;
  if (team.kind === 'unassigned')
    return user.userType === 'internal' && user.teamNames.length === 0;
  return user.teamNames.includes(team.name);
}

/**
 * 표에 실을 행 — 검색·소속 필터 → 퇴사자 제외 → 정렬.
 *
 * 기본 보기는 퇴사자를 뺀다. 서버가 발급순으로 주는데 테스트하다 퇴사 처리한 계정이 앞쪽에
 * 몰려 지금 일하는 사람이 밀려났기 때문이다. 퇴사자가 나오는 경우는 둘이다 — 상태 필터로
 * 상태를 고른 화면, 그리고 상태 열로 정렬한 화면. 유형·직책 정렬은 지금 사람들을 다시 세우는
 * 일이라 퇴사자를 들이지 않는다.
 *
 * 정렬은 안정 정렬이라 같은 값끼리는 발급순 그대로다. 직책이 빈 행은 방향과 무관하게 끝에
 * 선다 — 내림차순에서 빈 칸이 맨 위로 올라오면 정렬한 보람이 없다.
 */
export function arrangeUsers(
  items: readonly UserListItem[],
  options: {
    sort: UserSort;
    statusFilter: UserStatusFilter;
    query: string;
    team?: UserTeamFilter;
  },
): UserListItem[] {
  const { sort, statusFilter, query, team = { kind: 'all' } } = options;
  const showDeparted = statusFilter !== 'all' || sort?.key === 'status';
  const rows = items.filter(
    (user) =>
      matchesQuery(user, query) &&
      matchesTeam(user, team) &&
      (showDeparted || user.status !== 'departed'),
  );
  if (!sort) return rows;

  const sign = sort.direction === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    if (sort.key === 'jobTitle') {
      const emptyA = !userRoleLabel(a);
      const emptyB = !userRoleLabel(b);
      if (emptyA !== emptyB) return emptyA ? 1 : -1;
    }
    return compareUsers(a, b, sort.key) * sign;
  });
}
