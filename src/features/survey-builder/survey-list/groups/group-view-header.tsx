'use client';

import Link from 'next/link';

import { Folder } from 'lucide-react';

/**
 * 그룹 화면 머리 (.pen FLOW 1-5 「그룹보기」) — 브레드크럼 + 폴더 제목.
 *
 * 그룹 화면은 목록의 다른 상태가 아니라 `?group=<id>` 라는 별개의 주소다. 브레드크럼이
 * 있어야 어디에 있는지 알고 뒤로 나갈 수 있으며, 링크를 공유하면 같은 그룹이 열린다.
 *
 * **협업 그룹(타 팀 폴더)이면 소유 팀을 함께 적는다** — 사이드바 트리와 같은 계약이다.
 * 밝히지 않으면 내 팀 폴더와 구별되지 않아, 이름을 고칠 수 없고 담긴 설문도 일부만 보이는
 * 폴더가 내 것처럼 보인다.
 */
export function GroupViewHeader({
  groupName,
  foreignTeamName,
}: {
  groupName: string;
  foreignTeamName?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] text-[#6E6E73]">
        <Link href="/admin/surveys" className="hover:text-[#1C1C1E] hover:underline">
          설문 목록
        </Link>
        <span className="px-1">/</span>
        <span>{groupName}</span>
      </p>
      <span className="flex items-center gap-2.5">
        <Folder className="h-[22px] w-[22px] text-[#2743AE]" />
        <h1 className="text-2xl font-semibold text-[#1C1C1E]">{groupName}</h1>
        {foreignTeamName && (
          <span className="rounded-full bg-[#F5F5F7] px-[11px] py-1 text-[13px] text-[#6E6E73]">
            {foreignTeamName} 소유
          </span>
        )}
      </span>
    </div>
  );
}

/** 그룹 화면 하단 안내 — 그룹이 권한이 아니라는 사실을 화면에서 한 번 더 못 박는다. */
export function GroupViewFooterNote() {
  return (
    <p className="pt-1 text-[12.5px] text-[#9CA3AF]">
      그룹은 팀원이 함께 사용하는 공용 폴더입니다. 모든 active 팀원이 구조를 편집할 수 있고, 설문
      이동은 해당 설문의 편집 권한이 있어야 합니다.
    </p>
  );
}
