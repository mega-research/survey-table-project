'use client';

import { useState } from 'react';

import Link from 'next/link';

import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ListPagination } from '@/components/ui/list-pagination';
import type { UserStatus, UserType } from '@/shared/contracts/auth';
import { FIELDWORK_ROLE_LABEL } from '@/shared/contracts/auth';
import {
  type UserListItem,
  type UserStatusFilter,
  type UserTypeFilter,
  selectableUserStatusValues,
} from '@/shared/contracts/auth-io';

import { USER_STATUS_LABEL, USER_STATUS_PILL, USER_TYPE_LABEL } from '../account-vocabulary';
import { PRIMARY_BUTTON } from '../field-styles';
import { useUsers } from './queries/use-users';
import { UserCreateModal } from './user-create-modal';
import { UserDepartModal } from './user-depart-modal';
import { UserEditModal } from './user-edit-modal';
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

/** 아바타 이니셜 — 이름 첫 글자. 게스트만 유형색을 달리 준다(.pen). */
function avatarTone(userType: UserType): string {
  return userType === 'guest' ? 'bg-[#FEF3C7] text-[#D97706]' : 'bg-[#E0E7FF] text-[#2743AE]';
}

const PAGE_SIZE = 20;

/** 상태 머리글 정렬 — 누를 때마다 기본 → 오름차순 → 내림차순 → 기본으로 돈다. */
type StatusSort = 'default' | 'asc' | 'desc';

const NEXT_STATUS_SORT: Record<StatusSort, StatusSort> = {
  default: 'asc',
  asc: 'desc',
  desc: 'default',
};

/** 상태 정렬 순서 — 지금 일하는 사람이 앞, 퇴사가 끝. pending·rejected 는 v2 에서 도달 불가 어휘다. */
const STATUS_RANK: Record<UserStatus, number> = {
  active: 0,
  suspended: 1,
  pending: 2,
  rejected: 3,
  departed: 4,
};

/**
 * 표에 실을 행.
 *
 * 기본 보기는 퇴사자를 뺀다 — 서버가 발급순으로 주는데, 테스트하다 퇴사 처리한 계정이 앞쪽에
 * 몰려 지금 일하는 사람이 밀려났다. 퇴사자는 상태 머리글로 정렬하거나 상태 필터로 「퇴사」를
 * 고르면 나온다. 정렬은 안정 정렬이라 같은 상태 안은 발급순 그대로다.
 */
function arrangeUsers(
  items: readonly UserListItem[],
  sort: StatusSort,
  statusFilter: UserStatusFilter,
): UserListItem[] {
  if (sort === 'default') {
    return statusFilter === 'all' ? items.filter((user) => user.status !== 'departed') : [...items];
  }
  const direction = sort === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * direction);
}

const ARIA_SORT: Record<StatusSort, 'none' | 'ascending' | 'descending'> = {
  default: 'none',
  asc: 'ascending',
  desc: 'descending',
};

function StatusSortIcon({ sort }: { sort: StatusSort }) {
  if (sort === 'asc') return <ArrowUp className="h-3 w-3" />;
  if (sort === 'desc') return <ArrowDown className="h-3 w-3" />;
  return <ArrowUpDown className="h-3 w-3 opacity-60" />;
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

export function UserManagementView() {
  const [userType, setUserType] = useState<UserTypeFilter>('all');
  const [status, setStatus] = useState<UserStatusFilter>('all');
  const [statusSort, setStatusSort] = useState<StatusSort>('default');
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
  const rows = arrangeUsers(data?.items ?? [], statusSort, status);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // 상태가 바뀌어 행이 줄면 보고 있던 쪽이 사라질 수 있다 — 마지막 쪽으로 접는다.
  const currentPage = Math.min(page, totalPages);
  const items = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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
                  <th className="px-3 py-3 font-medium">유형</th>
                  <th className="px-3 py-3 font-medium">소속 (팀·기관·업체)</th>
                  <th className="px-3 py-3 font-medium">직책·역할</th>
                  <th className="px-3 py-3 font-medium" aria-sort={ARIA_SORT[statusSort]}>
                    <button
                      type="button"
                      onClick={() => {
                        setStatusSort((current) => NEXT_STATUS_SORT[current]);
                        setPage(1);
                      }}
                      className={`inline-flex items-center gap-1 hover:text-[#3A3A3C] ${
                        statusSort === 'default' ? '' : 'text-[#3A3A3C]'
                      }`}
                    >
                      상태
                      <StatusSortIcon sort={statusSort} />
                    </button>
                  </th>
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
                        className={`inline-flex rounded-full px-2 py-[3px] text-[11px] font-semibold ${TYPE_PILL[user.userType]}`}
                      >
                        {USER_TYPE_LABEL[user.userType]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[12.5px] text-[#6E6E73]">
                      <Affiliation user={user} />
                    </td>
                    <td className="px-3 py-3 text-[12.5px] text-[#6E6E73]">
                      {user.fieldworkRole
                        ? FIELDWORK_ROLE_LABEL[user.fieldworkRole]
                        : (user.jobTitle ?? '—')}
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
