'use client';

import { Search, SlidersHorizontal, Trash2 } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import type { SurveyListSortBy, SurveyListStatusChip } from './survey-list-pipeline';

// 문의 칩(.pen FLOW 6 「칩 문의」)은 Plan 3 게이트로 미노출 — 어휘 자체를 뺐다(티켓 08).
const STATUS_CHIPS: { key: SurveyListStatusChip; label: string; dot: string | null }[] = [
  { key: 'all', label: '전체', dot: null },
  { key: 'draft', label: '작성중', dot: '#9CA3AF' },
  { key: 'published', label: '진행중', dot: '#1D8A4E' },
  { key: 'closed', label: '완료', dot: '#2E4FCE' },
];

const SORT_OPTIONS: { key: SurveyListSortBy; label: string }[] = [
  { key: 'updatedAt', label: '최신 수정순' },
  { key: 'createdAt', label: '생성일순' },
  { key: 'title', label: '이름 가나다순' },
  { key: 'responses', label: '응답 많은 순' },
];

interface ListToolbarProps {
  counts: Record<SurveyListStatusChip, number>;
  statusChip: SurveyListStatusChip;
  onStatusChipChange: (chip: SurveyListStatusChip) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  sortBy: SurveyListSortBy;
  onSortByChange: (sortBy: SurveyListSortBy) => void;
  /** 그룹 화면은 검색이 그 그룹 안에서만 좁혀진다 — 문구가 동작을 반대로 안내하면 안 된다. */
  searchPlaceholder: string;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
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

/** 목록 툴바 (.pen FLOW 6) — 상태 칩 · 검색 · 정렬 · 상세 검색 토글. */
export function ListToolbar({
  counts,
  statusChip,
  onStatusChipChange,
  searchQuery,
  onSearchQueryChange,
  sortBy,
  onSortByChange,
  searchPlaceholder,
  advancedOpen,
  onToggleAdvanced,
  deletedCount,
  showDeleted,
  onToggleDeleted,
}: ListToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        {STATUS_CHIPS.map((chip) => {
          const active = statusChip === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => onStatusChipChange(chip.key)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors',
                active
                  ? 'bg-[#2E4FCE] font-semibold text-white'
                  : 'border border-[#E5E5EA] bg-white text-[#374151] hover:bg-[#F5F5F7]',
              )}
            >
              {chip.dot && !active && (
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: chip.dot }} />
              )}
              {chip.label} {counts[chip.key]}
            </button>
          );
        })}
      </div>

      {/* 휴지통은 칩과 나란히 서지만 성격이 다르다 — 칩은 받아온 목록을 접고 이쪽은 조회를
          바꾼다(티켓 17). 구분선으로 그 경계를 보이게 둔다. */}
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

      <div className="relative w-[280px]">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 w-full rounded-[9px] border border-[#E5E5EA] bg-white pl-9 pr-3 text-[13px] text-[#1C1C1E] placeholder:text-[#9CA3AF] focus:border-[#2E4FCE] focus:outline-none"
        />
      </div>

      <Select value={sortBy} onValueChange={(v) => onSortByChange(v as SurveyListSortBy)}>
        <SelectTrigger className="h-9 w-[152px] shrink-0 rounded-[9px] border-[#E5E5EA] text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.key} value={opt.key}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button
        type="button"
        onClick={onToggleAdvanced}
        className={cn(
          'flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] border px-3 text-[13px] transition-colors',
          advancedOpen
            ? 'border-[#2E4FCE] bg-[#EEF2FF] text-[#2743AE]'
            : 'border-[#E5E5EA] bg-white text-[#374151] hover:bg-[#F5F5F7]',
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        상세 검색
      </button>
    </div>
  );
}
