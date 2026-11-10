'use client';

import Link from 'next/link';

import { ChevronRight, FolderOpen } from 'lucide-react';

/** 브레드크럼 한 칸 — 그룹 목록의 줄이 이 모양을 만족한다. */
interface GroupPathStep {
  id: string;
  name: string;
}

/**
 * 그룹 화면 머리 (.pen FLOW 1-5 「그룹보기」 · 3단계 시안 G1·G2) — 브레드크럼 + 폴더 제목 + 건수.
 *
 * 그룹 화면은 목록의 다른 상태가 아니라 `?group=<id>` 라는 별개의 주소다. 브레드크럼이
 * 있어야 어디에 있는지 알고 뒤로 나갈 수 있으며, 링크를 공유하면 같은 그룹이 열린다.
 * 「설문 목록 › … › 지금 그룹」의 **단계마다 그 그룹 화면으로 가는 링크**이고 지금 그룹만 글자다.
 *
 * **협업 그룹(타 팀 폴더)이면 소유 팀을 함께 적는다** — 사이드바 트리와 같은 계약이다.
 * 밝히지 않으면 내 팀 폴더와 구별되지 않아, 이름을 고칠 수 없고 담긴 설문도 일부만 보이는
 * 폴더가 내 것처럼 보인다. 협업 그룹은 서버가 위쪽 그룹을 내지 않아 경로가 늘 「설문 목록 ›
 * 그룹 · 소유 팀」 두 칸이다.
 */
export function GroupViewHeader({
  path,
  foreignTeamName,
  surveyCount,
}: {
  /** 뿌리부터 지금 그룹까지(자기 포함). */
  path: readonly GroupPathStep[];
  foreignTeamName?: string | null;
  /**
   * 제목 옆 「설문 N」 — 그룹 목록이 준 건수 그대로다. 내 팀 그룹은 **하위 그룹까지 합친**, 내가 볼
   * 수 있는 설문 수이고 협업 그룹은 직접 담긴 수다. 아래 카드(이 그룹에 직접 담긴 설문)의 수와
   * 다를 수 있는 것은 의도다 — 그래서 본문이 「이 그룹에 직접 담긴 설문 N」을 따로 적는다.
   */
  surveyCount?: number;
}) {
  const current = path.at(-1);
  if (!current) return null;
  const ancestors = path.slice(0, -1);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <nav aria-label="그룹 위치">
        <ol className="flex min-w-0 items-center gap-1 text-[13px] text-[#6E6E73]">
          <li className="shrink-0">
            <Link href="/surveys" className="hover:text-[#1C1C1E] hover:underline">
              설문 목록
            </Link>
          </li>
          {ancestors.map((step) => (
            <li key={step.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-[#C7C7CC]" />
              <Link
                href={groupHref(step.id)}
                title={step.name}
                className="max-w-[220px] truncate hover:text-[#1C1C1E] hover:underline"
              >
                {step.name}
              </Link>
            </li>
          ))}
          <li className="flex min-w-0 items-center gap-1">
            <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-[#C7C7CC]" />
            <span aria-current="page" className="truncate font-semibold text-[#1C1C1E]">
              {foreignTeamName ? `${current.name} · ${foreignTeamName}` : current.name}
            </span>
          </li>
        </ol>
      </nav>
      <span className="flex min-w-0 items-center gap-2.5">
        <FolderOpen aria-hidden className="h-[22px] w-[22px] shrink-0 text-[#2743AE]" />
        <h1 title={current.name} className="truncate text-2xl font-semibold text-[#1C1C1E]">
          {current.name}
        </h1>
        {surveyCount !== undefined && (
          <span className="shrink-0 text-sm text-[#6E6E73] tabular-nums">설문 {surveyCount}</span>
        )}
        {foreignTeamName && (
          <span className="shrink-0 rounded-full bg-[#F5F5F7] px-[11px] py-1 text-[13px] text-[#6E6E73]">
            {foreignTeamName} 소유
          </span>
        )}
      </span>
    </div>
  );
}

/** 그룹 화면의 주소 — 사이드바 트리·폴더 줄과 같은 꼴이다(조건 없이 그 그룹을 연다). */
export function groupHref(groupId: string): string {
  return `/surveys?group=${groupId}`;
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
