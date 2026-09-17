'use client';

import { useState } from 'react';

import Link from 'next/link';

import { Check, ChevronDown, ChevronRight, Globe, Lock, Users } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { SYSTEM_SCOPE, SYSTEM_SCOPE_LABEL } from '@/shared/contracts/workspace';
import { useWorkScope } from '@/shared/lib/work-scope-context';

interface Props {
  /** 내 소속(역할 포함) — 팀장 한정 「팀 상세」 링크 판정용. 스위처 후보는 컨텍스트의 teams. */
  memberships: { teamId: string; role: 'leader' | 'member' }[];
  collapsed: boolean;
}

/**
 * 사이드바 팀 스위처 (.pen FLOW 6-1 팀 스위처 팝오버).
 *
 * 트리거는 현재 범위(팀 이름 또는 「메가리서치」)를 보여주고, 팝오버에서 팀 전환 +
 * (슈퍼어드민) 시스템 전체 보기 + (그 팀 팀장) 「팀 상세」 링크를 제공한다.
 * 팀 미배치는 전환할 것이 없으므로 잠금 표시만 한다 (.pen FLOW 9-1 팀 없음 스위처).
 */
export function TeamSwitcher({ memberships, collapsed }: Props) {
  const { scope, teams, canSeeSystemScope, setScope } = useWorkScope();
  const [open, setOpen] = useState(false);

  if (scope.kind === 'none') {
    return (
      <div
        title="소속 팀 없음"
        className={cn(
          'flex items-center gap-2 rounded-[10px] border border-white/28 px-[13px] py-[10px] text-white/50',
          collapsed && 'justify-center px-0',
        )}
      >
        <Lock className="h-3.5 w-3.5 shrink-0" />
        {!collapsed && <span className="truncate text-[13.5px] font-medium">소속 팀 없음</span>}
      </div>
    );
  }

  const currentTeam = scope.kind === 'team' ? teams.find((t) => t.id === scope.teamId) : undefined;
  const label =
    scope.kind === 'system' ? SYSTEM_SCOPE_LABEL : (currentTeam?.name ?? '알 수 없는 팀');
  // 지금 보고 있는 팀에서 내가 팀장인 경우에만 「팀 상세」 지름길을 연다 — 상세 페이지의
  // 접근 판정은 페이지·procedure 가 다시 한다.
  const leaderTeamId =
    scope.kind === 'team' &&
    memberships.some((m) => m.teamId === scope.teamId && m.role === 'leader')
      ? scope.teamId
      : null;

  function choose(next: string) {
    setOpen(false);
    setScope(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={label}
          className={cn(
            'flex items-center gap-2 rounded-[10px] border border-white/28 px-[13px] py-[10px] text-[13.5px] font-medium text-white transition-colors hover:bg-white/10',
            collapsed ? 'justify-center px-0' : 'justify-between',
          )}
        >
          {!collapsed && <span className="truncate">{label}</span>}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 rounded-[10px] border-[#E0E2E8] p-1.5 shadow-[0_10px_28px_rgba(13,27,76,0.2)]"
      >
        <p className="px-2.5 py-1.5 text-[11px] font-semibold text-[#9CA3AF]">팀 전환</p>
        {teams.length === 0 && (
          <p className="px-2.5 py-2 text-[12.5px] text-[#6E6E73]">전환할 팀이 없습니다</p>
        )}
        <ul className="flex flex-col gap-0.5">
          {teams.map((team) => {
            const active = scope.kind === 'team' && scope.teamId === team.id;
            return (
              <li key={team.id}>
                <button
                  type="button"
                  onClick={() => choose(team.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-[12.5px]',
                    active
                      ? 'bg-[#EEF2FF] font-semibold text-[#2743AE]'
                      : 'font-normal text-[#374151] hover:bg-gray-50',
                  )}
                >
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate text-left">{team.name}</span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>

        {leaderTeamId && (
          <>
            <div className="my-1 h-px bg-[#E5E5EA]" />
            <Link
              href={`/admin/teams/${leaderTeamId}`}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between rounded-[7px] px-2.5 py-2 text-[13px] text-[#374151] hover:bg-gray-50"
            >
              <span>팀 상세</span>
              <ChevronRight className="h-3 w-3 text-[#9CA3AF]" />
            </Link>
          </>
        )}

        {canSeeSystemScope && (
          <>
            <div className="my-1 h-px bg-[#E5E5EA]" />
            <button
              type="button"
              onClick={() => choose(SYSTEM_SCOPE)}
              className="flex w-full flex-col items-start gap-0.5 rounded-[7px] px-2.5 py-2 text-left hover:bg-gray-50"
            >
              <span className="flex items-center gap-2 text-[12.5px] font-semibold text-[#2E4FCE]">
                <Globe className="h-3.5 w-3.5" />
                {SYSTEM_SCOPE_LABEL}
              </span>
              <span className="text-[10.5px] text-[#9CA3AF]">
                시스템 전체 보기 · 슈퍼어드민 전용
              </span>
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
