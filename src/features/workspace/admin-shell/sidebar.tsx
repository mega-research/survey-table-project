'use client';

import type { ReactNode } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Building2, FileText, Menu, UserRound, Users } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { TeamRole } from '@/shared/contracts/workspace';
import { useWorkScope } from '@/shared/lib/work-scope-context';

import { SidebarGroupTree } from './sidebar-group-tree';
import { getSidebarMenuItemIds } from './sidebar-menu';
import { SidebarProfile } from './sidebar-profile';
import { TeamSwitcher } from './team-switcher';

const EXPANDED_WIDTH = 232;
const COLLAPSED_WIDTH = 64;

interface SidebarUser {
  name: string;
  isSuperadmin: boolean;
  image: string | null;
}

interface SidebarProps {
  user: SidebarUser;
  memberships: { teamId: string; role: TeamRole }[];
  collapsed: boolean;
  onToggle: () => void;
}

/** admin 좌측 사이드바 (.pen FLOW 6-1) — 로고 행 · 팀 스위처 · 메뉴 · 하단 프로필. */
export function Sidebar({ user, memberships, collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { scope } = useWorkScope();

  const menuItemIds = getSidebarMenuItemIds(scope.kind, user.isSuperadmin);

  return (
    <aside
      className="flex shrink-0 flex-col gap-2 bg-[#0D1B4C] p-4 pt-[18px]"
      style={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
    >
      <div className={cn('flex items-center', collapsed ? 'flex-col gap-2' : 'justify-between')}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-white">
            <FileText className="h-[17px] w-[17px] text-[#0D1B4C]" />
          </span>
          {!collapsed && (
            <span className="truncate text-base font-semibold text-white">설문 관리</span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
          className="flex h-6 w-6 shrink-0 items-center justify-center text-white/55 hover:text-white"
        >
          <Menu className="h-[18px] w-[18px]" />
        </button>
      </div>

      <TeamSwitcher memberships={memberships} collapsed={collapsed} />

      <nav className="flex flex-col gap-[3px]">
        {menuItemIds.includes('surveys') && (
          <>
            <SidebarMenuLink
              href="/admin/surveys"
              label="설문 목록"
              icon={<FileText className="h-4 w-4 shrink-0" />}
              active={pathname?.startsWith('/admin/surveys') ?? false}
              collapsed={collapsed}
            />
            {/* 그룹 트리는 접힌 사이드바에 넣지 않는다 — 이름 없는 폴더 아이콘 줄만 남는다. */}
            {!collapsed && (
              <SidebarGroupTree teamId={scope.kind === 'team' ? scope.teamId : null} />
            )}
          </>
        )}
        {menuItemIds.includes('users') && (
          <SidebarMenuLink
            href="/admin/users"
            label="사용자 관리"
            icon={<Users className="h-4 w-4 shrink-0" />}
            active={pathname?.startsWith('/admin/users') ?? false}
            collapsed={collapsed}
          />
        )}
        {menuItemIds.includes('teams') && (
          <SidebarMenuLink
            href="/admin/teams"
            label="팀 관리"
            icon={<Building2 className="h-4 w-4 shrink-0" />}
            active={pathname?.startsWith('/admin/teams') ?? false}
            collapsed={collapsed}
          />
        )}
        {menuItemIds.includes('profile') && (
          <SidebarMenuLink
            href="/admin/profile"
            label="프로필"
            icon={<UserRound className="h-4 w-4 shrink-0" />}
            active={pathname?.startsWith('/admin/profile') ?? false}
            collapsed={collapsed}
          />
        )}
      </nav>

      <div className="flex-1" />

      <SidebarProfile user={user} memberships={memberships} collapsed={collapsed} />
    </aside>
  );
}

function SidebarMenuLink({
  href,
  label,
  icon,
  active,
  collapsed,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      title={label}
      className={cn(
        'relative flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-white/16 font-semibold text-white'
          : 'font-normal text-white/65 hover:bg-white/10 hover:text-white/90',
      )}
    >
      {icon}
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
    </Link>
  );
}
