'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { useQuery } from '@tanstack/react-query';
import { Folder } from 'lucide-react';

import { cn } from '@/lib/utils';
import { surveyGroupListQueryOptions } from '@/shared/lib/survey-group-queries';

/**
 * 사이드바 「설문 목록」 하위의 그룹 트리 (.pen FLOW 1-4·2 배경).
 *
 * 그룹 화면으로 들어가는 유일한 입구다 — 그룹은 목록의 필터가 아니라 `?group=<id>` 라는
 * 주소라서, 여기가 없으면 만들어 놓은 그룹에 도달할 방법이 없다.
 *
 * .pen 은 활성 그룹 아래 하위 설문 2건 + 「… N개 더」까지 펼치고 미분류 설문도 최상위 항목으로
 * 늘어놓는다. 그 두 가지는 바로 옆 본문 목록과 같은 내용을 되풀이하는 것이라 넣지 않았다 —
 * 사이드바가 설문 목록 쿼리까지 들고 있게 되어 묶음 경계도 함께 넘는다.
 *
 * 팀 범위가 아니면(시스템 전체 보기·팀 미배치) 아무것도 그리지 않는다. 그룹은 팀 소유물이고
 * 시스템 전체 보기는 조회 범위일 뿐이라 그룹 개념 자체가 없다(.pen 6-2).
 *
 * **협업 그룹**(`foreignTeamName` 이 있는 행)은 타 팀 폴더다 — 내가 참여자로 초대됐거나 내
 * 팀원이 초대된 설문이 그 안에 있어서 보인다. 소유 팀을 함께 적는 것이 이 표시의 계약이다:
 * 밝히지 않으면 내 팀 폴더와 구별되지 않아, 이름을 고칠 수 없는 폴더가 내 것처럼 보인다
 * (설문 카드가 「… 소유」를 적는 것과 같은 이유).
 */
export function SidebarGroupTree({ teamId }: { teamId: string | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data } = useQuery(surveyGroupListQueryOptions(teamId));

  const groups = data ?? [];
  if (!teamId || groups.length === 0) return null;

  const onListPage = pathname === '/admin/surveys';
  const activeGroupId = onListPage ? searchParams.get('group') : null;

  return (
    <div className="flex flex-col gap-[1px] pt-0.5">
      {groups.map((group) => {
        const active = group.id === activeGroupId;
        return (
          <Link
            key={group.id}
            href={`/admin/surveys?group=${group.id}`}
            title={group.foreignTeamName ? `${group.name} · ${group.foreignTeamName}` : group.name}
            className={cn(
              'flex items-center gap-[7px] rounded-[7px] py-[7px] pr-2.5 pl-6 text-[12.5px] transition-colors',
              active
                ? 'bg-white/10 font-semibold text-white'
                : 'font-normal text-white/75 hover:bg-white/10 hover:text-white',
            )}
          >
            <Folder className={cn('h-[13px] w-[13px] shrink-0', !active && 'text-white/60')} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{group.name}</span>
              {group.foreignTeamName && (
                <span className="truncate text-[10.5px] font-normal text-white/45">
                  {group.foreignTeamName}
                </span>
              )}
            </span>
            <span className="shrink-0 text-[11px] text-white/45">{group.surveyCount}</span>
          </Link>
        );
      })}
    </div>
  );
}
