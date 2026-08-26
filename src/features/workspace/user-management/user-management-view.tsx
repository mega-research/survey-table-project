'use client';

import { useState } from 'react';

import Link from 'next/link';

import { ArrowLeft, Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { UserStatus, UserType } from '@/shared/contracts/auth';
import {
  selectableUserStatusValues,
  type UserListItem,
  type UserStatusFilter,
  type UserTypeFilter,
} from '@/shared/contracts/auth-io';

import { useUsers } from './queries/use-users';
import { UserCreateModal } from './user-create-modal';

/** 유형 칩 — .pen FLOW 1-1 의 전체/내부/게스트/실사 순서. */
const TYPE_TABS: { value: UserTypeFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'internal', label: '내부' },
  { value: 'guest', label: '게스트' },
  { value: 'fieldwork', label: '실사' },
];

const TYPE_LABEL: Record<UserType, string> = {
  internal: '내부',
  guest: '게스트',
  fieldwork: '실사',
};

const TYPE_PILL: Record<UserType, string> = {
  internal: 'bg-[#DBEAFE] text-[#1D4ED8]',
  guest: 'bg-[#FEF3C7] text-[#D97706]',
  fieldwork: 'bg-[#F3F4F6] text-[#6E6E73]',
};

/**
 * 상태 표시 어휘. pending/rejected 는 도달 불가지만(ADR-0018) 과거 데이터가 실려 있어도
 * 빈 배지로 보이지 않게 라벨을 함께 둔다 — 필터 선택지에는 없다.
 */
const STATUS_LABEL: Record<UserStatus, string> = {
  pending: '승인 대기',
  active: '재직 중',
  rejected: '승인 거절',
  suspended: '일시 정지',
  departed: '퇴사',
};

const STATUS_PILL: Record<UserStatus, string> = {
  pending: 'bg-[#FEF3C7] text-[#D97706]',
  active: 'bg-[#DCFCE7] text-[#15803D]',
  rejected: 'bg-[#F5F5F7] text-[#6E6E73]',
  suspended: 'bg-[#FEF3C7] text-[#D97706]',
  departed: 'bg-[#F5F5F7] text-[#6E6E73]',
};

/** 아바타 이니셜 — 이름 첫 글자. 게스트만 유형색을 달리 준다(.pen). */
function avatarTone(userType: UserType): string {
  return userType === 'guest' ? 'bg-[#FEF3C7] text-[#D97706]' : 'bg-[#E0E7FF] text-[#2743AE]';
}

/**
 * 「소속」 열 — 유형마다 출처가 다르다. 지금 채울 수 있는 것은 게스트의 소속 기관뿐이고
 * 내부(팀)·실사(업체)는 각각 티켓 06·24 에서 붙는다.
 */
function affiliationText(user: UserListItem): string {
  return user.organization ?? '—';
}

/** 「직책·역할」 열 — 내부는 직책. 팀 역할·실사 역할은 뒤 티켓에서 합쳐진다. */
function roleText(user: UserListItem): string {
  return user.jobTitle ?? '—';
}

export function UserManagementView() {
  const [userType, setUserType] = useState<UserTypeFilter>('all');
  const [status, setStatus] = useState<UserStatusFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, error } = useUsers(userType, status);

  const items = data?.items ?? [];
  const typeCounts = data?.typeCounts;

  return (
    <div className="min-h-screen bg-[#F9FAFB] px-4 py-8">
      <div className="mx-auto max-w-[1048px] space-y-6">
        <Link
          href="/admin/surveys"
          className="inline-flex items-center gap-1 text-[13px] text-[#6E6E73] hover:text-[#1C1C1E]"
        >
          <ArrowLeft className="h-4 w-4" />
          설문 목록
        </Link>

        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h1 className="text-[22px] font-semibold text-[#1C1C1E]">사용자 관리</h1>
            <p className="text-[13px] text-[#6E6E73]">
              계정을 직접 발급하고 상태를 관리합니다. 가입 신청은 없습니다.
            </p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-[38px] rounded-[9px] bg-[#2E4FCE] px-4 text-[13px] font-semibold text-white hover:bg-[#2743AE]"
          >
            <Plus className="mr-1 h-4 w-4" />
            사용자 생성
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {TYPE_TABS.map((tab) => {
            const selected = tab.value === userType;
            const count = typeCounts?.[tab.value];
            return (
              <button
                key={tab.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setUserType(tab.value)}
                className={`h-[30px] rounded-lg px-3 text-[12.5px] transition-colors ${
                  selected
                    ? 'bg-[#EEF2FF] font-semibold text-[#2743AE]'
                    : 'border border-[#E5E5EA] bg-white text-[#6E6E73] hover:text-[#3A3A3C]'
                }`}
              >
                {tab.label}
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
            onChange={(e) => setStatus(e.target.value as UserStatusFilter)}
            className="h-8 rounded-lg border border-[#D1D5DB] bg-white px-2 text-[12.5px] text-[#3A3A3C]"
          >
            <option value="all">상태 · 전체</option>
            {selectableUserStatusValues.map((value) => (
              <option key={value} value={value}>
                상태 · {STATUS_LABEL[value]}
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
                <th className="px-3 py-3 font-medium">상태</th>
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
                      {TYPE_LABEL[user.userType]}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-[#6E6E73]">
                    {affiliationText(user)}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-[#6E6E73]">{roleText(user)}</td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-[3px] text-[11px] font-semibold ${STATUS_PILL[user.status]}`}
                    >
                      {STATUS_LABEL[user.status]}
                    </span>
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
      </div>

      <UserCreateModal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
