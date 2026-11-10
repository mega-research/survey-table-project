'use client';

import Link from 'next/link';

import { Ellipsis, Folder, Pencil } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { GroupScreenSubgroup } from './group-screen';
import { groupHref } from './group-view-header';

/**
 * 하위 그룹 폴더 줄 (3단계 시안 G1) — 그룹 화면에서 그 그룹 바로 밑의 그룹을 폴더로 보인다.
 *
 * 줄 전체가 그 그룹 화면으로 들어가는 링크다(컴퓨터 폴더처럼 눌러 들어간다). 하위 그룹 안의
 * 설문은 여기 섞지 않는다 — 아래 카드는 이 그룹에 **직접** 담긴 설문뿐이다.
 *
 * 하위 그룹이 없으면 영역 자체를 그리지 않는다 — 하위 그룹을 만들지 않은 팀의 그룹 화면은
 * 전과 같아야 한다.
 */
export function SubgroupSection({
  subgroups,
  onRename,
}: {
  subgroups: readonly GroupScreenSubgroup[];
  onRename: (group: { id: string; name: string }) => void;
}) {
  if (subgroups.length === 0) return null;

  return (
    <section aria-labelledby="subgroup-section-title" className="flex flex-col gap-3">
      <GroupScreenSectionTitle id="subgroup-section-title" count={subgroups.length}>
        하위 그룹
      </GroupScreenSectionTitle>
      {/* 아래 설문 카드와 같은 격자 — 폴더 줄과 카드의 세로 줄이 맞는다. */}
      <ul className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
        {subgroups.map(({ group, subgroupCount }) => (
          <li
            key={group.id}
            className="relative flex items-center gap-3 rounded-[14px] border border-[#E5E5EA] bg-white py-3.5 pr-3 pl-5 transition-colors hover:border-[#B9C4F0] hover:bg-[#FAFBFF] has-[a:focus-visible]:border-[#2E4FCE] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-[#2E4FCE]/25"
          >
            <Folder aria-hidden className="h-5 w-5 shrink-0 text-[#2743AE]" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {/* after 가 줄 전체를 덮어 어디를 눌러도 들어간다. ⋯ 단추만 그 위에 선다. */}
              <Link
                href={groupHref(group.id)}
                title={group.name}
                className="truncate text-[15px] font-semibold text-[#1C1C1E] outline-none after:absolute after:inset-0 after:rounded-[14px]"
              >
                {group.name}
              </Link>
              <p className="truncate text-[12.5px] text-[#6E6E73] tabular-nums">
                설문 {group.surveyCount}
                {subgroupCount > 0 && ` · 하위 그룹 ${subgroupCount}`}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={`${group.name} 더보기`}
                    className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#9CA3AF] hover:bg-[#EEF0F4] hover:text-[#1C1C1E] focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:outline-none"
                  />
                }
              >
                <Ellipsis className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onRename({ id: group.id, name: group.name })}>
                  <Pencil className="h-3.5 w-3.5" />
                  이름 바꾸기
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 그룹 화면의 구역 제목 — 「하위 그룹 3」「이 그룹에 직접 담긴 설문 3」. */
export function GroupScreenSectionTitle({
  id,
  count,
  children,
}: {
  id?: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <h2 id={id} className="text-[13.5px] font-semibold text-[#1C1C1E]">
      {children}
      <span className="pl-1.5 font-normal text-[#6E6E73] tabular-nums">{count}</span>
    </h2>
  );
}

/** 하위 그룹은 있는데 이 그룹에 직접 담긴 설문은 없을 때 — 큰 빈 화면 대신 한 줄. */
export function NoDirectSurveysNote() {
  return (
    <p className="rounded-[14px] border border-dashed border-[#D9DBE1] px-5 py-6 text-center text-[13px] leading-relaxed text-[#6E6E73]">
      이 그룹에 직접 담긴 설문이 없습니다. 하위 그룹의 설문은 폴더를 눌러 들어가면 보입니다.
    </p>
  );
}
