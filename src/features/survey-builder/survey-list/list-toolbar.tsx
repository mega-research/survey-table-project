'use client';

import type { ReactNode } from 'react';

import { SlidersHorizontal, Trash2 } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type {
  SurveyListLifecycleFilter,
  SurveyListOwner,
  SurveyListSortBy,
} from '@/shared/contracts/survey-builder-io';

import { LifecycleSegment } from './lifecycle-segment';
import { SearchCombobox } from './search-combobox';

// 문의 칩(.pen FLOW 6 「칩 문의」)은 Plan 3 게이트로 미노출 — 어휘 자체를 뺐다(티켓 08).

const SORT_OPTIONS: { key: SurveyListSortBy; label: string }[] = [
  { key: 'updatedAt', label: '최신 수정순' },
  { key: 'createdAt', label: '생성일순' },
  { key: 'title', label: '이름 가나다순' },
  { key: 'responses', label: '응답 많은 순' },
];

interface ListToolbarProps {
  /** 목록 상태별 숫자 — 범위·그룹·팀 좁힘까지만 적용해 센다(검색·상세 검색과 무관). */
  counts: Record<SurveyListLifecycleFilter, number>;
  lifecycle: SurveyListLifecycleFilter;
  onLifecycleChange: (next: SurveyListLifecycleFilter) => void;
  /** 모든 조건을 적용한 결과 수 — 둘째 줄 오른쪽 「N개」. */
  resultCount: number;
  /** 주소에 걸린 검색어. */
  searchQuery: string;
  /**
   * 검색어를 목록에 적용할 때 한 번 부른다 — Enter·자동완성의 「검색 결과 모두 보기」, 그리고
   * 입력칸을 다 비웠을 때. 치는 동안에는 부르지 않는다(후보 창이 미리 보여 준다).
   */
  onSearchQueryChange: (query: string) => void;
  /** 자동완성 설문 후보를 찾을 작업 범위 — 목록 조회와 같은 값. */
  suggestScope: string | null;
  /** 범위 안 소유자 — 자동완성 「소유자」 칸의 재료(목록 페이지 응답). */
  owners: readonly SurveyListOwner[];
  /** 자동완성에서 소유자를 골랐다 — 상세 검색 소유자 조건 + 남은 검색어로 목록을 바꾼다. */
  onPickOwner: (ownerId: string, remainingQuery: string) => void;
  /** 자동완성에서 설문을 골랐다 — 그 설문 편집으로 간다. */
  onPickSurvey: (surveyId: string) => void;
  sortBy: SurveyListSortBy;
  onSortByChange: (sortBy: SurveyListSortBy) => void;
  /** 그룹 화면은 검색이 그 그룹 안에서만 좁혀진다 — 문구가 동작을 반대로 안내하면 안 된다. */
  searchPlaceholder: string;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
  /** 상세 검색 패널 — 첫 줄 아래(상세 검색 단추 밑)에 뜨도록 첫 줄 안에 꽂는다. */
  advancedPanel?: ReactNode;
  /**
   * 삭제된 설문 건수 — **null 이면 휴지통 칩 자체를 그리지 않는다**(티켓 17).
   *
   * 0 과 null 을 가르는 이유는 서버 계약과 같다: 「비어 있는 휴지통」과 「휴지통을 볼 수 없는
   * 사람」은 다른 화면이어야 한다. 채워지는 것은 슈퍼어드민의 시스템 전체 보기뿐이다.
   */
  deletedCount: number | null;
  showDeleted: boolean;
  onToggleDeleted: (next: boolean) => void;
}

/**
 * 목록 툴바 (시안 F8-a).
 *
 * 첫 줄 — 검색창(넓게, 자동완성 F8-b) · 상세 검색. 둘째 줄 — 왼쪽 목록 상태 세그먼트(+ 휴지통), 오른쪽
 * 「N개 · 정렬 ▾」. 즐겨찾기·태그 단추는 후속 티켓이 첫 줄의 검색창 오른쪽에 더한다.
 */
export function ListToolbar({
  counts,
  lifecycle,
  onLifecycleChange,
  resultCount,
  searchQuery,
  onSearchQueryChange,
  suggestScope,
  owners,
  onPickOwner,
  onPickSurvey,
  sortBy,
  onSortByChange,
  searchPlaceholder,
  advancedOpen,
  onToggleAdvanced,
  advancedPanel,
  deletedCount,
  showDeleted,
  onToggleDeleted,
}: ListToolbarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex items-center gap-2">
        <SearchCombobox
          value={searchQuery}
          onCommit={onSearchQueryChange}
          placeholder={searchPlaceholder}
          suggestScope={suggestScope}
          // 휴지통에서는 후보 창을 열지 않는다 — 후보는 삭제되지 않은 설문에서만 찾는다.
          suggestEnabled={!showDeleted}
          owners={owners}
          onPickOwner={onPickOwner}
          onPickSurvey={onPickSurvey}
        />

        <button
          type="button"
          onClick={onToggleAdvanced}
          aria-expanded={advancedOpen}
          className={cn(
            'flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border px-3.5 text-[13.5px] transition-colors',
            advancedOpen
              ? 'border-[#2E4FCE] bg-[#EEF2FF] text-[#2743AE]'
              : 'border-[#E5E5EA] bg-white text-[#374151] hover:bg-[#F5F5F7]',
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          상세 검색
        </button>
        {advancedPanel}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <LifecycleSegment value={lifecycle} counts={counts} onChange={onLifecycleChange} />

        {/* 휴지통은 세그먼트와 나란히 서지만 성격이 다르다 — 세그먼트는 지금 목록 안의 거르기이고
            이쪽은 목록의 원천을 삭제된 설문으로 바꾼다(티켓 17). 구분선으로 그 경계를 보이게 둔다. */}
        {deletedCount !== null && (
          <>
            <span className="h-4 w-px bg-[#E5E5EA]" aria-hidden />
            <button
              type="button"
              aria-pressed={showDeleted}
              onClick={() => onToggleDeleted(!showDeleted)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors',
                showDeleted
                  ? 'bg-[#B91C1C] font-semibold text-white'
                  : 'border border-[#E5E5EA] bg-white text-[#374151] hover:bg-[#F5F5F7]',
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
              삭제됨 {deletedCount}
            </button>
          </>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-1 text-[13px] text-[#6E6E73]">
          <span className="tabular-nums">{resultCount}개</span>
          <Select value={sortBy} onValueChange={(v) => onSortByChange(v as SurveyListSortBy)}>
            <SelectTrigger
              aria-label="정렬"
              className="h-8 w-auto shrink-0 gap-1 border-0 bg-transparent px-2 text-[13px] text-[#1C1C1E] shadow-none hover:bg-[#F5F5F7] focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.key} value={opt.key}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
