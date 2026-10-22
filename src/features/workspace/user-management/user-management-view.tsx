'use client';

import { useState } from 'react';

import Link from 'next/link';

import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Loader2, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ListPagination } from '@/components/ui/list-pagination';
import type { UserType } from '@/shared/contracts/auth';
import {
  type UserListItem,
  type UserStatusFilter,
  type UserTypeFilter,
  selectableUserStatusValues,
} from '@/shared/contracts/auth-io';

import {
  SUPERADMIN_LABEL,
  USER_STATUS_LABEL,
  USER_STATUS_PILL,
  USER_TYPE_LABEL,
} from '../account-vocabulary';
import { PRIMARY_BUTTON } from '../field-styles';
import { useTeams } from '../team-management/queries/use-teams';
import { useUsers } from './queries/use-users';
import { UserCreateModal } from './user-create-modal';
import { UserDepartModal } from './user-depart-modal';
import { UserEditModal } from './user-edit-modal';
import {
  type UserSort,
  type UserSortKey,
  type UserTeamFilter,
  arrangeUsers,
  nextUserSort,
  userRoleLabel,
} from './user-list-arrange';
import { UserRehireModal } from './user-rehire-modal';
import { UserResetPasswordModal } from './user-reset-password-modal';
import { UserRowActions } from './user-row-actions';

/*
 * 「협력 업체」 탭은 없다 (.pen FLOW 10-4 와 다르게 간다, ADR-0029).
 *
 * 그 탭이 하던 일은 실사 업체 등록과 업체별 실사 계정 발급이었다. 외주 실사가 설문별 링크로
 * 바뀌면서(ADR-0026) 실사 계정을 설문에 초대하는 입구가 사라졌고, 발급만 남아 쓸 곳 없는
 * 계정이 쌓이고 있었다. 닫은 것은 입구다 — 업체 관리 화면(`../fieldwork-orgs`)과 그 RPC,
 * 옛 모델의 테이블·테스트는 남아 있고 철거는 링크 모델로 실제 조사 한 건을 프로덕션에서
 * 끝낸 뒤의 일이다. 이미 있는 실사 계정은 아래 유형 칩으로 걸러 보고 정리할 수 있다.
 */

/** 유형 칩 — .pen FLOW 1-1 의 전체/내부/게스트/실사 순서(화면 표기는 「직원」). 라벨은 유형 어휘에서 온다. */
const TYPE_TABS: UserTypeFilter[] = ['all', 'internal', 'guest', 'fieldwork'];

function typeTabLabel(filter: UserTypeFilter): string {
  return filter === 'all' ? '전체' : USER_TYPE_LABEL[filter];
}

const TYPE_PILL: Record<UserType, string> = {
  internal: 'bg-[#DBEAFE] text-[#1D4ED8]',
  guest: 'bg-[#FEF3C7] text-[#D97706]',
  fieldwork: 'bg-[#F3F4F6] text-[#6E6E73]',
};

/** 유형 칸 — 슈퍼어드민은 유형(직원) 대신 「총괄」로 보인다. 진한 남색으로 직원 배지와 가른다. */
function typeBadge(user: UserListItem): { label: string; tone: string } {
  if (user.isSuperadmin) return { label: SUPERADMIN_LABEL, tone: 'bg-[#2743AE] text-white' };
  return { label: USER_TYPE_LABEL[user.userType], tone: TYPE_PILL[user.userType] };
}

/** 아바타 이니셜 — 이름 첫 글자. 게스트만 유형색을 달리 준다(.pen). */
function avatarTone(userType: UserType): string {
  return userType === 'guest' ? 'bg-[#FEF3C7] text-[#D97706]' : 'bg-[#E0E7FF] text-[#2743AE]';
}

const PAGE_SIZE = 20;

function SortIcon({ direction }: { direction: 'asc' | 'desc' | null }) {
  if (direction === 'asc') return <ArrowUp className="h-3 w-3" />;
  if (direction === 'desc') return <ArrowDown className="h-3 w-3" />;
  return <ArrowUpDown className="h-3 w-3 opacity-60" />;
}

/** 정렬 머리글 — 누를 때마다 오름차순 → 내림차순 → 정렬 없음(`nextUserSort`). */
function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: UserSortKey;
  sort: UserSort;
  onSort: (key: UserSortKey) => void;
  className: string;
}) {
  const direction = sort?.key === sortKey ? sort.direction : null;
  const ariaSort = direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none';
  return (
    <th className={className} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-[#3A3A3C] ${
          direction ? 'text-[#3A3A3C]' : ''
        }`}
      >
        {label}
        <SortIcon direction={direction} />
      </button>
    </th>
  );
}

/**
 * 「소속」 칸 — 유형마다 출처가 다르다. 직원은 팀(겸직이면 줄마다 하나), 게스트는 기관 메모,
 * 실사는 업체 이름.
 */
function Affiliation({ user }: { user: UserListItem }) {
  if (user.userType === 'internal' && user.teamNames.length > 0) {
    return (
      <span className="flex flex-col gap-0.5">
        {user.teamNames.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </span>
    );
  }
  return <>{user.fieldworkOrgName ?? user.organization ?? '—'}</>;
}

/** 소속 필터의 select 값 — 팀은 이름 앞에 접두를 붙여 「미배치」·「전체」와 겹치지 않게 한다. */
const TEAM_ALL = 'all';
const TEAM_UNASSIGNED = 'unassigned';
const TEAM_PREFIX = 'team:';

function teamFilterFromValue(value: string): UserTeamFilter {
  if (value === TEAM_UNASSIGNED) return { kind: 'unassigned' };
  if (value.startsWith(TEAM_PREFIX)) return { kind: 'team', name: value.slice(TEAM_PREFIX.length) };
  return { kind: 'all' };
}

function teamFilterValue(filter: UserTeamFilter): string {
  if (filter.kind === 'unassigned') return TEAM_UNASSIGNED;
  if (filter.kind === 'team') return `${TEAM_PREFIX}${filter.name}`;
  return TEAM_ALL;
}

export function UserManagementView() {
  const [userType, setUserType] = useState<UserTypeFilter>('all');
  const [status, setStatus] = useState<UserStatusFilter>('all');
  const [sort, setSort] = useState<UserSort>(null);
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState<UserTeamFilter>({ kind: 'all' });
  // 선택지는 활성 팀 목록에서 온다 — 지금 보이는 행에서 뽑으면 유형 칩을 바꿀 때 고른 팀이
  // 선택지에서 사라진다. 순서는 팀 관리 화면과 같은 팀 순서다.
  const teamOptions = useTeams().data?.teams ?? [];
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  // 대상 사용자를 그대로 들고 연다 — 모달 안에서 목록을 다시 뒤지지 않아도 되고, 열려 있는
  // 사이 목록이 새로고침돼도 보고 있던 사람이 바뀌지 않는다.
  const [resetTarget, setResetTarget] = useState<UserListItem | null>(null);
  const [editTarget, setEditTarget] = useState<UserListItem | null>(null);
  const [rehireTarget, setRehireTarget] = useState<UserListItem | null>(null);
  const [departTarget, setDepartTarget] = useState<UserListItem | null>(null);
  const { data, isLoading, error } = useUsers(userType, status);

  const typeCounts = data?.typeCounts;
  const rows = arrangeUsers(data?.items ?? [], { sort, statusFilter: status, query, team });
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // 상태가 바뀌어 행이 줄면 보고 있던 쪽이 사라질 수 있다 — 마지막 쪽으로 접는다.
  const currentPage = Math.min(page, totalPages);
  const items = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleSort = (key: UserSortKey) => {
    setSort((current) => nextUserSort(current, key));
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] px-4 py-8">
      <div className="mx-auto max-w-[1048px] space-y-6">
        <Link
          href="/surveys"
          className="inline-flex items-center gap-1 text-[13px] text-[#6E6E73] hover:text-[#1C1C1E]"
        >
          <ArrowLeft className="h-4 w-4" />
          설문 목록
        </Link>

        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h1 className="text-[22px] font-semibold text-[#1C1C1E]">사용자 관리</h1>
            <p className="text-[13px] text-[#6E6E73]">
              계정 발급과 상태를 관리합니다. 가입 신청은 없습니다.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className={PRIMARY_BUTTON}>
            <Plus className="mr-1 h-4 w-4" />
            사용자 생성
          </Button>
        </div>

        <>
          <div className="flex items-center gap-2">
            {TYPE_TABS.map((typeFilter) => {
              const selected = typeFilter === userType;
              const count = typeCounts?.[typeFilter];
              return (
                <button
                  key={typeFilter}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setUserType(typeFilter);
                    setPage(1);
                  }}
                  className={`h-[30px] rounded-lg px-3 text-[12.5px] transition-colors ${
                    selected
                      ? 'bg-[#EEF2FF] font-semibold text-[#2743AE]'
                      : 'border border-[#E5E5EA] bg-white text-[#6E6E73] hover:text-[#3A3A3C]'
                  }`}
                >
                  {typeTabLabel(typeFilter)}
                  {count === undefined ? '' : ` ${count}`}
                </button>
              );
            })}

            <div className="flex-1" />

            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="이름·이메일·팀 검색"
                aria-label="사용자 검색"
                className="h-8 w-[200px] rounded-lg border border-[#D1D5DB] bg-white pr-2 pl-8 text-[12.5px] text-[#1C1C1E] outline-none placeholder:text-[#9CA3AF] focus:border-[#2E4FCE]"
              />
            </div>

            <label className="sr-only" htmlFor="team-filter">
              소속 필터
            </label>
            <select
              id="team-filter"
              value={teamFilterValue(team)}
              onChange={(e) => {
                setTeam(teamFilterFromValue(e.target.value));
                setPage(1);
              }}
              className="h-8 max-w-[180px] rounded-lg border border-[#D1D5DB] bg-white px-2 text-[12.5px] text-[#3A3A3C]"
            >
              <option value={TEAM_ALL}>소속 · 전체</option>
              {teamOptions.map((option) => (
                <option key={option.id} value={`${TEAM_PREFIX}${option.name}`}>
                  소속 · {option.name}
                </option>
              ))}
              <option value={TEAM_UNASSIGNED}>소속 · 미배치</option>
            </select>

            <label className="sr-only" htmlFor="status-filter">
              상태 필터
            </label>
            <select
              id="status-filter"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as UserStatusFilter);
                setPage(1);
              }}
              className="h-8 rounded-lg border border-[#D1D5DB] bg-white px-2 text-[12.5px] text-[#3A3A3C]"
            >
              <option value="all">상태 · 전체</option>
              {selectableUserStatusValues.map((value) => (
                <option key={value} value={value}>
                  상태 · {USER_STATUS_LABEL[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-hidden rounded-[11px] border border-[#E5E5EA] bg-white">
            <table className="w-full">
              <thead className="bg-[#F9FAFB]">
                <tr className="text-left text-[11.5px] font-medium text-[#9CA3AF]">
                  <th className="px-5 py-3 font-medium">사용자</th>
                  <SortableHeader
                    label="유형"
                    sortKey="type"
                    sort={sort}
                    onSort={handleSort}
                    className="px-3 py-3 font-medium"
                  />
                  <th className="px-3 py-3 font-medium">소속 (팀·기관·업체)</th>
                  <SortableHeader
                    label="직책·역할"
                    sortKey="jobTitle"
                    sort={sort}
                    onSort={handleSort}
                    className="px-3 py-3 font-medium"
                  />
                  <SortableHeader
                    label="상태"
                    sortKey="status"
                    sort={sort}
                    onSort={handleSort}
                    className="px-3 py-3 font-medium"
                  />
                  <th className="px-3 py-3 font-medium">
                    <span className="sr-only">액션</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((user) => (
                  <tr key={user.id} className="border-t border-[#E5E5EA]">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden
                          className={`flex h-[30px] w-[30px] items-center justify-center rounded-full text-[11.5px] font-semibold ${avatarTone(user.userType)}`}
                        >
                          {user.name.slice(0, 1)}
                        </span>
                        <span className="flex flex-col">
                          <span className="text-[13.5px] font-semibold text-[#1C1C1E]">
                            {user.name}
                          </span>
                          <span className="text-[11.5px] text-[#9CA3AF]">{user.email}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-[3px] text-[11px] font-semibold ${typeBadge(user).tone}`}
                      >
                        {typeBadge(user).label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[12.5px] text-[#6E6E73]">
                      <Affiliation user={user} />
                    </td>
                    <td className="px-3 py-3 text-[12.5px] text-[#6E6E73]">
                      {userRoleLabel(user) ?? '—'}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-[3px] text-[11px] font-semibold ${USER_STATUS_PILL[user.status]}`}
                      >
                        {USER_STATUS_LABEL[user.status]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <UserRowActions
                        user={user}
                        onRehire={setRehireTarget}
                        onDepart={setDepartTarget}
                        onResetPassword={setResetTarget}
                        onEdit={setEditTarget}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {isLoading && (
              <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[#6E6E73]">
                <Loader2 className="h-4 w-4 animate-spin" />
                사용자 목록을 불러오는 중...
              </div>
            )}
            {error && (
              <p className="py-10 text-center text-[13px] text-red-600">
                사용자 목록을 불러오지 못했습니다.
              </p>
            )}
            {!isLoading && !error && items.length === 0 && (
              <p className="py-10 text-center text-[13px] text-[#9CA3AF]">
                조건에 맞는 사용자가 없습니다.
              </p>
            )}
          </div>

          {rows.length > 0 && (
            <ListPagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
          )}
        </>
      </div>

      <UserCreateModal open={createOpen} onOpenChange={setCreateOpen} />
      {/* 열릴 때만 마운트한다 — 두 모달은 대상의 현재 값(직책 등)으로 초기 상태를 잡으므로
          띄워둔 채 대상만 갈아끼우면 앞사람의 입력이 남는다. */}
      {editTarget && <UserEditModal user={editTarget} onClose={() => setEditTarget(null)} />}
      {resetTarget && (
        <UserResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
      )}
      {departTarget && (
        <UserDepartModal user={departTarget} onClose={() => setDepartTarget(null)} />
      )}
      {rehireTarget && (
        <UserRehireModal user={rehireTarget} onClose={() => setRehireTarget(null)} />
      )}
    </div>
  );
}
