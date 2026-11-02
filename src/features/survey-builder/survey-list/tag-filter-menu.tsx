'use client';

import { useId, useRef, useState } from 'react';

import { ChevronDown, Hash, Search } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { SURVEY_LIST_TAG_FILTER_MAX } from '@/shared/contracts/survey-builder-io';
import type { PersonalTagItem } from '@/shared/contracts/workspace-io';

import { PERSONAL_TAG_DOT_CLASS, type TagFilterSort, resolveTagFilterList } from './personal-tags';
import { TagEditMenu } from './tag-edit-panel';

interface TagFilterMenuProps {
  /** 내 태그 전부(`workspace.personalMarks.mine`) — 붙은 설문이 0개인 태그도 나온다. */
  tags: readonly PersonalTagItem[];
  /** 걸린 검색 칩(주소의 `tag`) — 체크 상태의 정본. */
  selectedIds: readonly string[];
  /** 체크를 바꿨다 — 칩 더하기/빼기. */
  onToggle: (tagId: string, on: boolean) => void;
  /** 「선택 해제」 — 걸린 칩을 모두 푼다(글자 검색은 그대로). */
  onClearSelection: () => void;
}

const SORT_LABEL: Record<TagFilterSort, string> = { usage: '많이 쓴 순', name: '가나다순' };

/**
 * 툴바의 「# 태그 ▾」와 내 태그 전체 목록 (설문 즐겨찾기·태그 티켓 09, 시안 F8-d).
 *
 * 태그 찾기 칸 · 「내 태그 N개 · 나에게만 보입니다」 · 많이 쓴 순/가나다순 · 줄마다 체크박스·색 점·이름·
 * 붙은 설문 수 · 마우스를 올리면 「⋯」. **체크가 곧 검색창 칩이다** — 이 컴포넌트는 체크 상태를 따로
 * 들지 않고 `selectedIds`(주소)만 그린다. 체크해도 창은 닫히지 않는다(여러 개를 연달아 건다).
 *
 * 「⋯」는 태그 편집 패널(이름·색·삭제, 티켓 08)을 연다 — 한 번에 한 태그만(`editingTagId`).
 */
export function TagFilterMenu({
  tags,
  selectedIds,
  onToggle,
  onClearSelection,
}: TagFilterMenuProps) {
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<TagFilterSort>('usage');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  // 편집 패널은 이 목록 전체의 옆에 선다 — 오른쪽 자리가 없어 뒤집혀도 목록을 덮지 않게.
  const panelRef = useRef<HTMLDivElement>(null);

  const selected = new Set(selectedIds);
  const rows = resolveTagFilterList(tags, query, sort);
  const full = selectedIds.length >= SURVEY_LIST_TAG_FILTER_MAX;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setEditingTagId(null);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              'flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border px-3.5 text-[13.5px] transition-colors',
              open || selectedIds.length > 0
                ? 'border-[#2E4FCE] bg-[#EEF2FF] text-[#2743AE]'
                : 'border-[#E5E5EA] bg-white text-[#374151] hover:bg-[#F5F5F7]',
            )}
          />
        }
      >
        <Hash className="h-3.5 w-3.5" />
        {/* 좁은 폭에서는 아이콘만 남긴다 — 글자·숫자는 화면에서만 숨기고 읽기에는 남긴다. */}
        <span className="max-lg:sr-only">태그</span>
        {selectedIds.length > 0 && (
          <>
            {' '}
            <span className="tabular-nums max-lg:sr-only">{selectedIds.length}</span>
          </>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-[#9CA3AF] max-lg:hidden" />
      </PopoverTrigger>
      <PopoverContent
        ref={panelRef}
        align="end"
        aria-label="내 태그로 거르기"
        className="flex w-[340px] flex-col overflow-hidden p-0"
      >
        <div className="p-2.5 pb-0">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              type="text"
              aria-label="태그 찾기"
              placeholder="태그 찾기"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              className="h-8 w-full rounded-md bg-[#F2F2F7] pr-2 pl-8 text-[13px] text-[#1C1C1E] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-b border-[#F0F0F3] px-3.5 py-2 text-[12px]">
          <span className="text-[#8E8E93]">내 태그 {tags.length}개 · 나에게만 보입니다</span>
          <div className="flex items-center gap-1">
            {(Object.keys(SORT_LABEL) as TagFilterSort[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={sort === key}
                onClick={() => setSort(key)}
                className={cn(
                  'rounded px-1 py-0.5',
                  sort === key
                    ? 'font-semibold text-[#1C1C1E]'
                    : 'text-[#8E8E93] hover:text-[#1C1C1E]',
                )}
              >
                {SORT_LABEL[key]}
              </button>
            ))}
          </div>
        </div>

        <ul aria-label="내 태그" className="flex max-h-[320px] flex-col overflow-y-auto p-1.5">
          {rows.map((tag) => {
            const checkboxId = `${baseId}-tag-${tag.id}`;
            const checked = selected.has(tag.id);
            const editing = editingTagId === tag.id;
            return (
              <li
                key={tag.id}
                className={cn(
                  'group/row flex min-h-9 items-center gap-2.5 rounded-md px-2 hover:bg-[#F5F5F7]',
                  editing && 'bg-[#F5F5F7]',
                )}
              >
                <Checkbox
                  id={checkboxId}
                  aria-label={tag.name}
                  checked={checked}
                  disabled={!checked && full}
                  onCheckedChange={(next) => onToggle(tag.id, next === true)}
                  className="border-[#C7C7CC] data-[checked]:border-[#2E4FCE] data-[checked]:bg-[#2E4FCE] [&_svg]:h-3 [&_svg]:w-3"
                />
                <label
                  htmlFor={checkboxId}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 text-[13.5px] text-[#1C1C1E]"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      PERSONAL_TAG_DOT_CLASS[tag.color],
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  <span className="shrink-0 text-[12px] text-[#9CA3AF] tabular-nums">
                    {tag.linkCount}
                  </span>
                </label>
                {/* 「⋯」 — 태그 창과 같은 편집 패널(이름·색·삭제, 티켓 08). 한 번에 한 태그만. */}
                <TagEditMenu
                  tag={tag}
                  open={editing}
                  onOpenChange={(next) =>
                    setEditingTagId((cur) => (next ? tag.id : cur === tag.id ? null : cur))
                  }
                  className="opacity-0 group-hover/row:opacity-100"
                  besideRef={panelRef}
                />
              </li>
            );
          })}
          {rows.length === 0 && (
            <li className="px-2 py-3 text-center text-[12.5px] text-[#8E8E93]">
              {tags.length === 0
                ? '아직 태그가 없습니다. 카드의 「+ 태그」로 만드세요.'
                : `「${query.trim()}」와 같은 태그가 없습니다`}
            </li>
          )}
        </ul>

        <div className="flex items-center justify-between gap-2 border-t border-[#F0F0F3] px-3.5 py-2.5 text-[12px]">
          <span className="text-[#8E8E93]">
            {full
              ? `검색 칩은 ${SURVEY_LIST_TAG_FILTER_MAX}개까지 걸 수 있습니다`
              : '체크하면 검색창에 필터로 더해집니다'}
          </span>
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={onClearSelection}
              className="shrink-0 font-medium text-[#2E4FCE] hover:underline"
            >
              선택 해제
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
