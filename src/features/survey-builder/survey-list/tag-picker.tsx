'use client';

import { useId, useState } from 'react';

import { Check, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  PERSONAL_TAG_MESSAGE,
  PERSONAL_TAG_NAME_MAX_LENGTH,
  pickPersonalTagColor,
} from '@/shared/contracts/workspace';
import type { PersonalTagItem } from '@/shared/contracts/workspace-io';

import { PersonalTagLabel } from './personal-tag-label';
import { resolveTagPicker } from './personal-tags';
import { TagEditMenu } from './tag-edit-panel';

interface TagPickerPanelProps {
  /** 이 설문에 붙은 내 태그 id — 붙인 순서. */
  attachedIds: readonly string[];
  /** 내 태그 전부(`workspace.personalMarks.mine`). */
  tags: readonly PersonalTagItem[];
  /** 바라는 상태를 올린다 — 낙관적 갱신·연타 처리는 `useSetTagLink` 가 진다. */
  onToggle: (tagId: string, on: boolean) => void;
  /** 만들고 이 설문에 붙인다. 만든(또는 같은 이름의 기존) 태그, 실패면 null. */
  onCreate: (name: string) => Promise<PersonalTagItem | null>;
}

/**
 * 태그 창 본문 (설문 즐겨찾기·태그 티켓 07, 시안 F6 ①②) — 카드의 태그 줄·「+N」·「+ 태그」·케밥
 * 「태그」가 여는 팝오버 안에 들어간다.
 *
 * 위: 붙은 태그 칩(× 로 뗀다) + 검색·새 이름 칸. 아래: 내 태그 목록 — 누르면 즉시 붙거나 떨어지고
 * 창은 닫히지 않는다. 글자를 치면 목록이 좁혀지고, 없는 이름이면 맨 아래 「만들기 [이름] · Enter」.
 *
 * 접근성은 combobox + listbox(다중 선택) 패턴이다 — 칸에 포커스가 머문 채 ↑↓ 로 줄을 고르고
 * Enter 로 누른다. 아무 줄도 고르지 않았으면 Enter 는 「만들기」(없으면 첫 줄)를 누른다.
 *
 * 줄마다 마우스를 올리면 「⋯」가 보이고, 누르면 옆에 편집 패널(티켓 08)이 열린다. 한 번에 한
 * 태그만 — `editingTagId` 하나가 쥐고, 다른 줄의 「⋯」를 누르면 패널이 그 태그로 옮겨 간다.
 * 「⋯」는 `role=option` 밖(줄 묶음 안의 형제)에 둔다 — 줄을 누르는 것(붙이기·떼기)과 갈리고,
 * 줄의 읽히는 이름이 태그 이름 그대로 남는다.
 */
export function TagPickerPanel({ attachedIds, tags, onToggle, onCreate }: TagPickerPanelProps) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [tooLong, setTooLong] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);

  const attached = new Set(attachedIds);
  const byId = new Map(tags.map((t) => [t.id, t]));
  const attachedTags = attachedIds.flatMap((id) => {
    const found = byId.get(id);
    return found ? [found] : [];
  });
  const view = resolveTagPicker(tags, query, tags.length);
  const optionCount = view.matches.length + (view.create ? 1 : 0);
  const defaultIndex = view.create ? view.matches.length : view.matches.length > 0 ? 0 : null;
  const effectiveIndex =
    activeIndex !== null && activeIndex < optionCount ? activeIndex : defaultIndex;
  const optionId = (index: number) => `${listId}-option-${index}`;

  function handleChange(next: string) {
    // 20자를 넘는 입력은 받지 않는다(붙여넣기 포함) — 칸 아래에 이유를 남긴다.
    if ([...next.trim()].length > PERSONAL_TAG_NAME_MAX_LENGTH) {
      setTooLong(true);
      return;
    }
    setTooLong(false);
    setQuery(next);
    setActiveIndex(null);
  }

  async function create(name: string) {
    if (creating) return;
    setCreating(true);
    const made = await onCreate(name);
    setCreating(false);
    if (made) {
      setQuery('');
      setActiveIndex(null);
    }
  }

  function press(index: number) {
    const target = view.matches[index];
    if (target) {
      onToggle(target.id, !attached.has(target.id));
      return;
    }
    if (view.create) void create(view.create);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (optionCount === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const from = activeIndex !== null && activeIndex < optionCount ? activeIndex : -1;
      const start = from === -1 && step === -1 ? optionCount : from;
      setActiveIndex((start + step + optionCount) % optionCount);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (effectiveIndex !== null) press(effectiveIndex);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 border-b border-[#E5E5EA] bg-[#FAFAFA] px-3 py-2.5">
        {attachedTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachedTags.map((t) => (
              <PersonalTagLabel key={t.id} tag={t}>
                <button
                  type="button"
                  aria-label={`${t.name} 태그 떼기`}
                  onClick={() => onToggle(t.id, false)}
                  className="-mr-0.5 flex h-4 w-4 items-center justify-center rounded text-[#8E8E93] hover:bg-[#E5E5EA] hover:text-[#1C1C1E]"
                >
                  <X className="h-3 w-3" />
                </button>
              </PersonalTagLabel>
            ))}
          </div>
        )}
        <input
          autoFocus
          role="combobox"
          aria-label="검색하거나 새 태그 이름 입력"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={effectiveIndex !== null ? optionId(effectiveIndex) : undefined}
          placeholder="검색하거나 새 태그 이름 입력"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-7 w-full bg-transparent text-[13.5px] text-[#1C1C1E] outline-none placeholder:text-[#9CA3AF]"
        />
        {tooLong && (
          <p role="status" className="text-[12px] text-[#D93025]">
            {PERSONAL_TAG_MESSAGE.too_long}
          </p>
        )}
      </div>

      <div className="flex max-h-[280px] flex-col overflow-y-auto p-1.5">
        {query.trim() === '' ? (
          <p className="px-2 pt-1 pb-1.5 text-[12px] text-[#8E8E93]">내 태그 · 나에게만 보입니다</p>
        ) : view.matches.length === 0 ? (
          <p className="px-2 pt-1 pb-1.5 text-[12px] text-[#8E8E93]">
            「{query.trim()}」와 같은 태그가 없습니다
          </p>
        ) : null}
        <div id={listId} role="listbox" aria-label="내 태그" aria-multiselectable>
          {view.matches.map((t, index) => {
            const editing = editingTagId === t.id;
            return (
              <div
                key={t.id}
                className={cn(
                  'group/row flex items-center gap-1 rounded-md pr-1',
                  editing && 'bg-[#F2F2F7]',
                )}
              >
                <TagPickerOption
                  id={optionId(index)}
                  active={effectiveIndex === index}
                  selected={attached.has(t.id)}
                  onPress={() => press(index)}
                  onHover={() => setActiveIndex(index)}
                >
                  <PersonalTagLabel tag={t} />
                  {attached.has(t.id) && (
                    <Check aria-hidden className="ml-auto h-4 w-4 shrink-0 text-[#2E4FCE]" />
                  )}
                </TagPickerOption>
                <TagEditMenu
                  tag={t}
                  open={editing}
                  onOpenChange={(open) =>
                    setEditingTagId((cur) => (open ? t.id : cur === t.id ? null : cur))
                  }
                  className="opacity-0 group-hover/row:opacity-100"
                />
              </div>
            );
          })}
          {view.create && (
            <TagPickerOption
              id={optionId(view.matches.length)}
              label={`만들기 ${view.create}`}
              active={effectiveIndex === view.matches.length}
              selected={false}
              onPress={() => press(view.matches.length)}
              onHover={() => setActiveIndex(view.matches.length)}
            >
              <span className="text-[13px] text-[#3A3A3C]">만들기</span>
              {/* 미리보기 색은 서버가 배정할 색 그대로 — 같은 규칙(가장 덜 쓴 색, 같으면 어휘 순서). */}
              <PersonalTagLabel
                tag={{ name: view.create, color: pickPersonalTagColor(tags.map((t) => t.color)) }}
              />
              <kbd className="ml-auto rounded border border-[#E5E5EA] bg-white px-1.5 text-[11px] text-[#6E6E73]">
                Enter
              </kbd>
            </TagPickerOption>
          )}
        </div>
        {view.limitReached && (
          <p className="px-2 py-1.5 text-[12.5px] text-[#6E6E73]">{PERSONAL_TAG_MESSAGE.limit}</p>
        )}
        {tags.length === 0 && query.trim() === '' && (
          <p className="px-2 py-1.5 text-[12.5px] text-[#8E8E93]">
            아직 태그가 없습니다. 이름을 입력해 만드세요.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * 목록의 한 줄 — 누르면 즉시 붙거나 떨어진다. 마우스로 눌러도 칸의 포커스를 빼앗지 않는다
 * (연달아 붙이고 바로 이어서 칠 수 있게).
 */
function TagPickerOption({
  id,
  label,
  active,
  selected,
  onPress,
  onHover,
  children,
}: {
  id: string;
  /** 읽히는 이름 — 없으면 줄의 글자 그대로. */
  label?: string;
  active: boolean;
  selected: boolean;
  onPress: () => void;
  onHover: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-label={label}
      aria-selected={selected}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      onMouseMove={onHover}
      className={cn(
        'flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1',
        active && 'bg-[#F2F4FB]',
      )}
    >
      {children}
    </div>
  );
}
