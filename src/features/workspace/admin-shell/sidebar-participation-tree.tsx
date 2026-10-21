'use client';

import { useMemo, useState } from 'react';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Folder, Inbox, Users } from 'lucide-react';

import { cn } from '@/lib/utils';
import { surveyGroupListQueryOptions } from '@/shared/lib/survey-group-queries';
import { surveyListQueryOptions } from '@/shared/lib/survey-list-queries';

import { buildParticipationTree } from './participation-tree';

/** 팀 배지 색 — 팀 id 로 고정 팔레트에서 뽑아 같은 팀은 어디서든 같은 색이다. */
const TEAM_COLORS = ['#F59E0B', '#22C55E', '#A78BFA', '#38BDF8', '#F472B6', '#FB923C'];

function teamColor(teamId: string): string {
  let hash = 0;
  for (const ch of teamId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TEAM_COLORS[hash % TEAM_COLORS.length]!;
}

/** 배지 글자 — 팀 이름의 마지막 낱말(「연구3본부 5팀」→「5팀」). 길면 앞 두 글자. */
function teamShortLabel(teamName: string): string {
  const last = teamName.trim().split(/\s+/).pop() ?? teamName;
  return last.length > 3 ? last.slice(0, 2) : last;
}

/**
 * 실사팀 범위의 사이드바 본체 (0139, .pen 사이드바_협업그룹_시안 「방식 A'」).
 *
 * 실사팀은 일감 대부분이 다른 팀 설문이라 「설문 목록」 + 협업 폴더 나열이 남의 폴더로만
 * 채워진다. 그래서 「참여 중」을 최상위로 두고 소유 팀 → 폴더로 접는다. 수치는 본문 목록과
 * **같은 응답**(read.list — 같은 쿼리 키라 왕복도 하나)에서 센다.
 *
 * 펼침은 화면 상태다. 지금 보고 있는 팀(`?team=` 또는 열린 그룹의 소유 팀)은 펼친 채로 서고,
 * 사용자가 누른 화살표가 그 위를 덮는다.
 */
export function SidebarParticipationTree({ teamId }: { teamId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: list } = useQuery(surveyListQueryOptions(teamId));
  const { data: groups } = useQuery(surveyGroupListQueryOptions(teamId));
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const surveys = useMemo(() => list?.surveys ?? [], [list]);
  const tree = useMemo(() => buildParticipationTree(surveys, groups ?? []), [surveys, groups]);

  const onListPage = pathname === '/surveys';
  const activeGroupId = onListPage ? searchParams.get('group') : null;
  const activeTeamParam = onListPage ? searchParams.get('team') : null;
  const ungroupedActive = activeTeamParam !== null && searchParams.get('ungrouped') === '1';
  const activeTeamId =
    activeTeamParam ??
    (activeGroupId
      ? (surveys.find((s) => s.surveyGroupId === activeGroupId)?.teamId ?? null)
      : null);
  const allActive = onListPage && !activeGroupId && !activeTeamParam;

  return (
    <div className="flex flex-col gap-[3px]">
      <Link
        href="/surveys"
        className={cn(
          'flex items-center gap-2 rounded-lg px-2.5 py-[8px] text-[13.5px] font-semibold text-white transition-colors',
          allActive ? 'bg-white/16' : 'hover:bg-white/10',
        )}
      >
        <Users className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">참여 중</span>
        <span className="rounded-full bg-white/15 px-2 py-px text-[11px] font-semibold">
          {surveys.length}
        </span>
      </Link>

      {tree.map((team) => {
        const color = teamColor(team.teamId);
        const open = toggled[team.teamId] ?? team.teamId === activeTeamId;
        const teamActive = activeTeamParam === team.teamId && !ungroupedActive;
        return (
          <div key={team.teamId} className="flex flex-col">
            <div
              className={cn(
                'flex items-center rounded-lg transition-colors',
                teamActive ? 'bg-white/16' : open ? 'bg-white/[0.06]' : 'hover:bg-white/10',
              )}
            >
              <Link
                href={`/surveys?team=${team.teamId}`}
                title={team.teamName}
                className="flex min-w-0 flex-1 items-center gap-2 py-[7px] pr-1 pl-2.5"
              >
                <span
                  className="flex h-[19px] min-w-[26px] shrink-0 items-center justify-center rounded-[5px] px-1 text-[10px] font-bold"
                  style={{ backgroundColor: `${color}33`, color }}
                >
                  {teamShortLabel(team.teamName)}
                </span>
                <span className="flex-1 truncate text-[13px] font-semibold text-white">
                  {team.teamName}
                </span>
                <span className="shrink-0 text-[11px] text-white/60">{team.surveyCount}</span>
              </Link>
              <button
                type="button"
                aria-label={`${team.teamName} ${open ? '접기' : '펼치기'}`}
                aria-expanded={open}
                onClick={() => setToggled((prev) => ({ ...prev, [team.teamId]: !open }))}
                className="flex h-7 w-7 shrink-0 items-center justify-center text-white/55 hover:text-white"
              >
                {open ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            {open && (
              <div
                className="mt-0.5 mb-1 ml-[22px] flex flex-col gap-[1px] border-l-2 pl-1.5"
                style={{ borderColor: `${color}59` }}
              >
                {team.folders.map((folder) => (
                  <FolderLink
                    key={folder.groupId}
                    href={`/surveys?group=${folder.groupId}`}
                    label={folder.name}
                    count={folder.surveyCount}
                    active={activeGroupId === folder.groupId}
                    icon={<Folder className="h-[13px] w-[13px] shrink-0" />}
                  />
                ))}
                {team.ungroupedCount > 0 && (
                  <FolderLink
                    href={`/surveys?team=${team.teamId}&ungrouped=1`}
                    label="미분류"
                    count={team.ungroupedCount}
                    active={ungroupedActive && activeTeamParam === team.teamId}
                    icon={<Inbox className="h-[13px] w-[13px] shrink-0" />}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FolderLink({
  href,
  label,
  count,
  active,
  icon,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={label}
      className={cn(
        'flex items-center gap-[7px] rounded-[7px] py-[6px] pr-2.5 pl-2 text-[12.5px] transition-colors',
        active
          ? 'bg-white/16 font-semibold text-white'
          : 'font-normal text-white/75 hover:bg-white/10 hover:text-white',
      )}
    >
      <span className={cn(!active && 'text-white/60')}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[11px] text-white/45">{count}</span>
    </Link>
  );
}
