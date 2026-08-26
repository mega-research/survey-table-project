'use client';

import Link from 'next/link';

import { FileText, Plus, Search, UsersRound } from 'lucide-react';

/**
 * 팀 미배치 빈 상태 (.pen FLOW 9-1) — 조회 자체를 하지 않는다.
 *
 * 초대받은 설문까지 전부 차단되는 상태라는 것을 문구로 알린다(CONTEXT 「팀 미배치 사용자」).
 * 액션은 프로필뿐이다 — 사이드바 제한 메뉴와 같은 어휘.
 */
export function NoTeamEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#EEF2FF]">
        <UsersRound className="h-6 w-6 text-[#2E4FCE]" />
      </span>
      <h3 className="text-[17px] font-semibold text-[#1C1C1E]">소속 팀이 없습니다</h3>
      <p className="max-w-[420px] text-[13.5px] leading-relaxed text-[#6E6E73]">
        관리자에게 팀 배정을 요청하세요. 팀이 배정되기 전에는 초대받은 설문을 포함해 어떤
        설문도 볼 수 없습니다.
      </p>
      <Link
        href="/admin/profile"
        className="mt-1 h-9 rounded-[9px] border border-[#E5E5EA] bg-white px-4 leading-9 text-[13px] font-medium text-[#374151] hover:bg-[#F5F5F7]"
      >
        프로필 보기
      </Link>
    </div>
  );
}

/** 검색/필터 결과 없음 — 초기화 버튼으로 전체 상태를 되돌린다. */
export function NoResultsEmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#F5F5F7]">
        <Search className="h-6 w-6 text-[#9CA3AF]" />
      </span>
      <h3 className="text-[16px] font-semibold text-[#1C1C1E]">검색 결과가 없습니다</h3>
      <p className="text-[13.5px] text-[#6E6E73]">다른 검색어나 필터 조건으로 시도해 보세요.</p>
      <button
        type="button"
        onClick={onReset}
        className="mt-1 h-9 rounded-[9px] border border-[#E5E5EA] bg-white px-4 text-[13px] font-medium text-[#374151] hover:bg-[#F5F5F7]"
      >
        초기화
      </button>
    </div>
  );
}

/** 설문 0건(필터 없이 진짜 빈 목록) — 팀 범위만 생성 CTA 노출. */
export function NoSurveysEmptyState({ canCreate }: { canCreate: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#F5F5F7]">
        <FileText className="h-6 w-6 text-[#9CA3AF]" />
      </span>
      <h3 className="text-[16px] font-semibold text-[#1C1C1E]">아직 설문이 없습니다</h3>
      <p className="text-[13.5px] text-[#6E6E73]">첫 번째 설문을 만들어 보세요.</p>
      {canCreate && (
        <Link
          href="/admin/surveys/create"
          className="mt-1 flex h-9 items-center gap-1.5 rounded-[9px] bg-[#2E4FCE] px-4 text-[13px] font-semibold text-white hover:bg-[#2743AE]"
        >
          <Plus className="h-4 w-4" />
          새 설문 만들기
        </Link>
      )}
    </div>
  );
}
