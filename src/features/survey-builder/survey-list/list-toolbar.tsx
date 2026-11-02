'use client';

import { type ReactNode, useEffect, useEffectEvent, useState } from 'react';

import { Search, SlidersHorizontal, Star, Trash2 } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  SURVEY_LIST_SEARCH_MAX_LENGTH,
  type SurveyListLifecycleFilter,
  type SurveyListSortBy,
} from '@/shared/contracts/survey-builder-io';

import { LifecycleSegment } from './lifecycle-segment';

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
  /** 치기를 멈추면(250ms) 한 번 부른다 — 글자마다 서버 조회가 돌지 않게. */
  onSearchQueryChange: (query: string) => void;
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
  /**
   * 즐겨찾기만 보기(티켓 06) — 켜짐 · 내 별 개수(범위·그룹·팀 좁힘 기준) · 바꾸기.
   * **null 이면 단추를 그리지 않는다** — 휴지통에는 즐겨찾기 조건이 없다.
   */
  favorites: { on: boolean; count: number; onToggle: (next: boolean) => void } | null;
}

/**
 * 목록 툴바 (시안 F8-a).
 *
 * 첫 줄 — 검색창(넓게) · 즐겨찾기 · 상세 검색. 둘째 줄 — 왼쪽 목록 상태 세그먼트(+ 휴지통), 오른쪽
 * 「N개 · 정렬 ▾」. 「# 태그」 단추는 후속 티켓이 즐겨찾기와 상세 검색 사이에 더한다.
 */
export function ListToolbar({
  counts,
  lifecycle,
  onLifecycleChange,
  resultCount,
  searchQuery,
  onSearchQueryChange,
  sortBy,
  onSortByChange,
  searchPlaceholder,
  advancedOpen,
  onToggleAdvanced,
  advancedPanel,
  deletedCount,
  showDeleted,
  onToggleDeleted,
  favorites,
}: ListToolbarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex items-center gap-2">
        <SearchInput
          value={searchQuery}
          onCommit={onSearchQueryChange}
          placeholder={searchPlaceholder}
        />

        {favorites && (
          <button
            type="button"
            aria-pressed={favorites.on}
            onClick={() => favorites.onToggle(!favorites.on)}
            className={cn(
              'flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border px-3.5 text-[13.5px] transition-colors',
              favorites.on
                ? 'border-[#F5A524] bg-[#FFF8E6] font-medium text-[#1C1C1E]'
                : 'border-[#E5E5EA] bg-white text-[#374151] hover:bg-[#F5F5F7]',
            )}
          >
            <Star
              className={cn(
                'h-3.5 w-3.5',
                favorites.on ? 'fill-[#F5A524] text-[#F5A524]' : 'text-[#6E6E73]',
              )}
            />
            {/* 좁은 폭에서는 별만 남긴다 — 글자·숫자는 화면에서만 숨기고 읽기에는 남긴다. */}
            <span className="max-lg:sr-only">즐겨찾기</span>{' '}
            <span className="text-[#6E6E73] tabular-nums max-lg:sr-only">{favorites.count}</span>
          </button>
        )}

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

const SEARCH_DEBOUNCE_MS = 250;

/**
 * 검색창 — 치는 글자는 여기 머물고, 멈추면 한 번 올린다(목록이 서버 조회라 글자마다 왕복하지 않게).
 *
 * 바깥 값(주소)이 바뀌면 따라간다 — 뒤로 가기·「조건 풀기」가 검색어를 바꾼 경우. 단 내가 방금
 * 올린 값이 돌아온 것이면 건드리지 않는다: 그 사이 더 친 글자를 덮어 지우게 된다.
 */
function SearchInput({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [sent, setSent] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== sent) {
      setSent(value);
      setDraft(value);
    }
  }

  const commit = useEffectEvent((next: string) => {
    setSent(next);
    onCommit(next);
  });
  useEffect(() => {
    if (draft === sent) return;
    const timer = setTimeout(() => commit(draft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, sent]);

  return (
    <div className="relative min-w-0 flex-1">
      <Search className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label="설문 검색"
        maxLength={SURVEY_LIST_SEARCH_MAX_LENGTH}
        className="h-10 w-full rounded-[10px] border border-[#E5E5EA] bg-white pr-3 pl-10 text-[13.5px] text-[#1C1C1E] placeholder:text-[#9CA3AF] focus:border-[#2E4FCE] focus:outline-none"
      />
    </div>
  );
}
