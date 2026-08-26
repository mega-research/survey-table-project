'use client';

import { useState } from 'react';

import Link from 'next/link';

import { ChevronUp, LogOut, User } from 'lucide-react';

import { signOutToLogin } from '@/components/auth/logout-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { TeamRole } from '@/shared/contracts/workspace';

const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  leader: '팀장',
  member: '팀원',
};

interface Props {
  user: { name: string; isSuperadmin: boolean; image: string | null };
  memberships: { teamId: string; role: TeamRole }[];
  collapsed: boolean;
}

/** 사이드바 하단 프로필 (.pen FLOW 6-1 프로필 + FLOW 3-2 진입점) — 프로필 수정·로그아웃 팝오버. */
export function SidebarProfile({ user, memberships, collapsed }: Props) {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // 슈퍼어드민 → "슈퍼어드민", 아니면 첫 소속 팀의 역할 표기. 팀 미배치는 계정 상태와 맞춰
  // "재직 중"(이 셸에 도달하는 사용자는 항상 active).
  const roleLabel = user.isSuperadmin
    ? '슈퍼어드민'
    : memberships[0]
      ? TEAM_ROLE_LABEL[memberships[0].role]
      : '재직 중';
  const initial = user.name.trim().charAt(0) || '?';

  async function handleLogout() {
    setLoggingOut(true);
    try {
      // 로그아웃 흐름의 단일 출처 — components/auth/logout-button.
      await signOutToLogin();
    } finally {
      // 실패해도 버튼이 영구 비활성으로 굳지 않게 잠금만 푼다.
      setLoggingOut(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${user.name} · ${roleLabel}`}
          className={cn(
            'flex items-center gap-2.5 border-t border-white/20 pt-3 text-left transition-opacity hover:opacity-90',
            collapsed ? 'justify-center' : 'justify-between',
          )}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- R2 아바타 URL, next/image 도메인 설정 밖.
              <img
                src={user.image}
                alt=""
                className="h-[30px] w-[30px] shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[#E0E7FF] text-[12px] font-semibold text-[#2743AE]">
                {initial}
              </span>
            )}
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-white/90">
                  {user.name}
                </span>
                <span className="block truncate text-[11px] font-normal text-white/50">
                  {roleLabel}
                </span>
              </span>
            )}
          </span>
          {!collapsed && <ChevronUp className="h-3.5 w-3.5 shrink-0 text-white/45" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[204px] rounded-[10px] border-[#E0E2E8] p-1.5 shadow-[0_10px_28px_rgba(13,27,76,0.2)]"
      >
        <Link
          href="/admin/profile"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-[13px] font-normal text-[#374151] hover:bg-[#F5F5F7]"
        >
          <User className="h-3.5 w-3.5" />
          프로필 수정
        </Link>
        <button
          type="button"
          disabled={loggingOut}
          onClick={handleLogout}
          className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-[13px] font-normal text-[#EF4444] hover:bg-red-50 disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" />
          로그아웃
        </button>
      </PopoverContent>
    </Popover>
  );
}
