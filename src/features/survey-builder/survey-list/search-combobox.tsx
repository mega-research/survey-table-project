'use client';

import { type KeyboardEvent, type MouseEvent, useId, useRef, useState } from 'react';

import { FileText, Hash, Search, UserRound, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  SURVEY_LIST_SEARCH_MAX_LENGTH,
  SURVEY_LIST_SEARCH_MAX_WORDS,
  type SurveyListLifecycle,
  type SurveyListOwner,
  type SurveySuggestion,
  isSurveyListSearchWithinLimits,
  splitSurveyListSearchWords,
} from '@/shared/contracts/survey-builder-io';
import type { PersonalTagItem } from '@/shared/contracts/workspace-io';

import { useSurveySuggestions } from '../queries/use-survey-suggestions';
import { ACTIVE_TAG_LABEL_CLASS, PersonalTagLabel } from './personal-tag-label';
import { dropWordsMatching, matchOwnerSuggestions, matchTagSuggestions } from './search-suggest';

const LIFECYCLE_LABELS: Record<SurveyListLifecycle, string> = {
  draft: '작성중',
  running: '진행중',
  closed: '종료',
};

/**
 * 후보 한 줄 — 칸(section)마다 종류가 다르다. 키보드 이동은 칸을 가로질러 **한 줄로 편 목록**
 * 위에서 하고, 바닥의 「모두 보기」가 그 목록의 마지막 줄이다.
 */
type SuggestOption =
  | { kind: 'tag'; key: string; tag: PersonalTagItem }
  | { kind: 'owner'; key: string; owner: SurveyListOwner }
  | { kind: 'survey'; key: string; survey: SurveySuggestion }
  | { kind: 'all'; key: 'all' };

interface SuggestSection {
  key: string;
  label: string;
  options: SuggestOption[];
  /** 고를 수 있는 줄이 아직 없을 때 보이는 안내(찾는 중) — 낭독에서 뺀다. */
  placeholder?: string;
}

/**
 * 검색창 안 칩(티켓 09) — 걸린 태그 필터. 칩 순서는 주소의 `tag` 순서, 이름·색은 내 태그 목록에서
 * 찾은 것(지워진 태그는 화면이 미리 뺀다).
 */
export interface SearchChips {
  tags: readonly PersonalTagItem[];
  /** 칩 하나 빼기(×). */
  onRemove: (tagId: string) => void;
  /** 「모두 지우기」 — 칩과 글자만 지운다(즐겨찾기·목록 상태·상세 검색은 그대로). */
  onClearAll: () => void;
}

/**
 * 자동완성 「내 태그」 칸(티켓 10) — 후보 재료와 고르기. 고르면 검색 칩이 되고 그 태그에 맞던
 * 단어를 뺀 검색어가 함께 온다(「a사 실」 → [A사] + 「실」).
 */
export interface TagSuggestions {
  /** 내 태그 전부(`mine`) — 브라우저가 거른다. 이미 칩으로 걸린 것은 `chips.tags` 로 뺀다. */
  tags: readonly PersonalTagItem[];
  onPick: (tagId: string, remainingQuery: string) => void;
}

/** 넓은 화면(lg 이상)에서 펼쳐 두는 칩 수 — 넘치면 「+N」. 좁은 폭에서는 1개만 둔다. */
const CHIPS_VISIBLE_WIDE = 3;
const CHIPS_VISIBLE_NARROW = 1;

interface SearchComboboxProps {
  /** 주소에 걸린(목록에 적용된) 검색어. */
  value: string;
  /** 바깥 틀의 폭·배치 — 부르는 쪽이 줄 안에서 차지할 자리를 정한다(없으면 남는 폭 전부). */
  className?: string;
  /** 검색어를 목록에 적용한다 — Enter·「모두 보기」, 그리고 입력칸을 다 비웠을 때. */
  onCommit: (q: string) => void;
  placeholder: string;
  /** 설문 후보를 찾을 작업 범위 — 목록 조회와 같은 값. */
  suggestScope: string | null;
  /** false 면 후보 창을 열지 않는다(휴지통 — 후보는 삭제되지 않은 설문만 찾는다). */
  suggestEnabled: boolean;
  /** 범위 안 소유자(목록 페이지 응답) — 「소유자」 칸은 이것을 브라우저가 거른다. */
  owners: readonly SurveyListOwner[];
  /** 소유자 후보를 골랐다 — 그 이름에 맞던 단어를 뺀 검색어가 함께 온다. */
  onPickOwner: (ownerId: string, remainingQuery: string) => void;
  /** 설문 후보를 골랐다 — 그 설문 편집으로 간다. */
  onPickSurvey: (surveyId: string) => void;
  /** 검색창 안 칩 — 없으면 칩도 「모두 지우기」도 없다. */
  chips?: SearchChips;
  /** 「내 태그」 후보 — 없으면 그 칸이 없다. */
  tagSuggestions?: TagSuggestions;
}

/**
 * 검색창 + 자동완성 (시안 F8-b, 설문 즐겨찾기·태그 티켓 05).
 *
 * **치는 동안에는 목록에 적용하지 않는다.** 후보 창이 「설문」 5건을 바로 보여 주고, 목록은
 * Enter·「검색 결과 모두 보기」로 적용한다(시안의 뒤 목록은 치는 동안 그대로다). 입력칸을 다 비우면
 * 그 자리에서 전체 목록으로 되돌린다.
 *
 * 접근성은 combobox 패턴이다 — 포커스는 늘 입력칸에 있고, ↑↓ 가 `aria-activedescendant` 로 후보를
 * 가리키며, Enter 가 가리킨 후보를 고른다(가리킨 것이 없으면 검색 적용). Esc 는 창만 닫고, 다시
 * 치면 열린다. 후보 줄은 mousedown 을 막아 클릭해도 입력칸의 포커스가 빠지지 않는다. 「내 태그」
 * 후보가 있으면 열릴 때 첫 태그 줄을 가리켜 Enter 가 곧 태그 고르기다(티켓 10).
 *
 * 상한(단어 8개·100자)을 넘기는 입력은 받지 않는다(티켓 04) — 서버 입력 스키마가 같은 기준으로
 * 거부한다.
 */
export function SearchCombobox({
  value,
  className,
  onCommit,
  placeholder,
  suggestScope,
  suggestEnabled,
  owners,
  onPickOwner,
  onPickSurvey,
  chips,
  tagSuggestions,
}: SearchComboboxProps) {
  const [draft, setDraft] = useState(value);
  const [chipsExpanded, setChipsExpanded] = useState(false);
  const [limitHit, setLimitHit] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // 바깥 값(주소)이 바뀌면 따라간다 — 뒤로 가기·「조건 풀기」. 내가 방금 적용한 값이 돌아온
  // 것이면 건드리지 않는다(그 사이 친 글자를 덮지 않게).
  const [seen, setSeen] = useState(value);
  const [sent, setSent] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== sent) {
      setSent(value);
      setDraft(value);
    }
  }

  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const hasWords = splitSurveyListSearchWords(draft).length > 0;
  const open = suggestEnabled && focused && !dismissed && hasWords;

  const { suggestions, isPending } = useSurveySuggestions({
    scope: suggestScope,
    q: draft,
    enabled: open,
  });

  const chipTags = chips?.tags ?? [];
  const tagHits =
    open && tagSuggestions
      ? matchTagSuggestions(
          tagSuggestions.tags,
          draft,
          chipTags.map((t) => t.id),
        )
      : [];
  const sections = open ? buildSections(draft, tagHits, owners, suggestions, isPending) : [];
  const allOption: SuggestOption = { kind: 'all', key: 'all' };
  const flat = open ? [...sections.flatMap((s) => s.options), allOption] : [];
  // 가리킨 줄 — 고른 적이 없으면(또는 가리킨 줄이 사라졌으면) 첫 태그 줄(시안 F8-b 「Enter 로 필터
  // 추가」). 태그 후보는 브라우저가 바로 거르므로 맨 위 칸이 늦게 와 밀리는 일이 없다. 태그 후보가
  // 없으면 아무 줄도 가리키지 않는다 — Enter 가 지금 검색어 적용으로 남는다(설문 첫 줄을 미리 가리키면
  // Enter 가 그 설문 편집으로 가 버린다).
  const chosenIndex = flat.findIndex((o) => o.key === activeKey);
  const activeIndex = chosenIndex >= 0 ? chosenIndex : flat.findIndex((o) => o.kind === 'tag');
  const resolvedActiveKey = activeIndex >= 0 ? flat[activeIndex]!.key : null;
  const optionId = (key: string) => `${baseId}-opt-${key}`;

  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  function close() {
    setDismissed(true);
    setActiveKey(null);
    lastPointerRef.current = null;
  }

  // 마우스로 가리키기는 **커서가 실제로 움직였을 때만**이다. 창이 가만히 있는 커서 밑에 펼쳐지거나
  // 후보가 늦게 와 줄이 커서 밑으로 밀려 들어와도 브라우저는 mouseenter·mousemove 를 쏜다 — 그걸
  // 가리키기로 받으면 Enter 가 「검색 적용」이 아니라 커서 밑 설문의 화면으로 가 버렸다
  // (2026-11-02). 직전 좌표와 같으면 움직임이 아니다.
  function hover(key: string, event: MouseEvent) {
    const last = lastPointerRef.current;
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    if (last && (last.x !== event.clientX || last.y !== event.clientY)) setActiveKey(key);
  }

  function commit(next: string) {
    setSent(next);
    onCommit(next);
    close();
  }

  function select(option: SuggestOption) {
    switch (option.kind) {
      case 'all':
        commit(draft);
        return;
      case 'survey':
        close();
        onPickSurvey(option.survey.id);
        return;
      case 'tag': {
        const remaining = dropWordsMatching(draft, option.tag.name);
        setDraft(remaining);
        setSent(remaining);
        close();
        tagSuggestions?.onPick(option.tag.id, remaining);
        return;
      }
      case 'owner': {
        const remaining = dropWordsMatching(draft, option.owner.name);
        setDraft(remaining);
        setSent(remaining);
        close();
        onPickOwner(option.owner.id, remaining);
        return;
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (!suggestEnabled || !hasWords) return;
        e.preventDefault();
        if (!open) {
          setDismissed(false);
          return;
        }
        const size = flat.length;
        const next =
          e.key === 'ArrowDown'
            ? activeIndex + 1 >= size
              ? 0
              : activeIndex + 1
            : activeIndex <= 0
              ? size - 1
              : activeIndex - 1;
        setActiveKey(flat[next]?.key ?? null);
        return;
      }
      case 'Enter': {
        e.preventDefault();
        const active = activeIndex >= 0 ? flat[activeIndex] : undefined;
        if (active) select(active);
        else commit(draft);
        return;
      }
      case 'Escape':
        if (open) {
          e.preventDefault();
          close();
        }
        return;
    }
  }

  const showClearAll = chips !== undefined && (chipTags.length > 0 || draft !== '');

  function clearAll() {
    setDraft('');
    setSent('');
    setLimitHit(false);
    close();
    chips?.onClearAll();
  }

  return (
    <div className={cn('relative min-w-0', className ?? 'flex-1')}>
      {/* 테두리는 칩·입력칸·「모두 지우기」를 감싼 상자에 있다 — 칩이 검색창 안에 들어 있게 보인다.
          자리가 모자라면 상자 안에서 다음 줄로 접는다(좁은 폭에서 칩·「모두 지우기」가 상자 밖으로
          넘치지 않게). 넓은 화면에서는 접힌 칩이 「+N」으로 줄어 있어 한 줄에 든다. */}
      <div
        className={cn(
          'flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-[10px] border border-[#E5E5EA] bg-white py-1 pr-2 pl-10 focus-within:border-[#2E4FCE]',
          open && 'border-[#2E4FCE]',
        )}
      >
        <Search className="absolute top-5 left-3.5 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
        {chipTags.map((tag, index) => {
          if (!chipsExpanded && index >= CHIPS_VISIBLE_WIDE) return null;
          return (
            <PersonalTagLabel
              key={tag.id}
              tag={tag}
              className={cn(
                'max-w-[160px] shrink-0',
                ACTIVE_TAG_LABEL_CLASS,
                !chipsExpanded && index >= CHIPS_VISIBLE_NARROW && 'max-lg:hidden',
              )}
            >
              <button
                type="button"
                aria-label={`${tag.name} 필터 빼기`}
                onClick={() => chips?.onRemove(tag.id)}
                className="-mr-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[#2743AE]/70 hover:bg-[#D6E0FF] hover:text-[#1C1C1E]"
              >
                <X className="h-3 w-3" />
              </button>
            </PersonalTagLabel>
          );
        })}
        {!chipsExpanded && (
          <>
            {chipTags.length > CHIPS_VISIBLE_WIDE && (
              <ChipOverflowButton
                count={chipTags.length - CHIPS_VISIBLE_WIDE}
                className="max-lg:hidden"
                onClick={() => setChipsExpanded(true)}
              />
            )}
            {chipTags.length > CHIPS_VISIBLE_NARROW && (
              <ChipOverflowButton
                count={chipTags.length - CHIPS_VISIBLE_NARROW}
                className="lg:hidden"
                onClick={() => setChipsExpanded(true)}
              />
            )}
          </>
        )}
        {chipsExpanded && chipTags.length > CHIPS_VISIBLE_NARROW && (
          <button
            type="button"
            onClick={() => setChipsExpanded(false)}
            className="shrink-0 rounded-md px-1.5 text-[12.5px] leading-6 text-[#6E6E73] hover:bg-[#F5F5F7]"
          >
            접기
          </button>
        )}
        <input
          type="text"
          role="combobox"
          aria-label="설문 검색"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(flat[activeIndex]!.key) : undefined}
          value={draft}
          onChange={(e) => {
            const next = e.target.value;
            const fits = isSurveyListSearchWithinLimits(next);
            setLimitHit(!fits);
            if (!fits) return;
            setDraft(next);
            setDismissed(false);
            setActiveKey(null);
            // 치는 동안 줄이 커서 밑으로 바뀌어 들어온다 — 그 첫 신호도 움직임이 아니다.
            lastPointerRef.current = null;
            // 다 지우면 Enter 를 기다리지 않고 전체 목록으로 — 빈 검색어는 고를 후보도 없다.
            if (splitSurveyListSearchWords(next).length === 0 && sent !== '') commit('');
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setActiveKey(null);
            setLimitHit(false);
          }}
          placeholder={chipTags.length > 0 ? undefined : placeholder}
          maxLength={SURVEY_LIST_SEARCH_MAX_LENGTH}
          autoComplete="off"
          // 포커스 표시는 바깥 상자의 파란 테두리 하나다 — 전역 `*:focus-visible` 링(레이어 밖 규칙이라
          // important 로만 덮인다)이 입력칸에 한 겹 더 그려지지 않게 끈다.
          className="h-8 min-w-[80px] flex-1 bg-transparent text-[13.5px] text-[#1C1C1E] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:[box-shadow:none]!"
        />
        {showClearAll && (
          <button
            type="button"
            onClick={clearAll}
            className="shrink-0 rounded-md px-1.5 text-[12.5px] leading-6 text-[#6E6E73] hover:bg-[#F5F5F7] hover:text-[#1C1C1E]"
          >
            모두 지우기
          </button>
        )}
      </div>

      {(limitHit || open) && (
        <div className="absolute top-full left-0 z-20 mt-1.5 flex w-full max-w-[620px] flex-col gap-1">
          {limitHit && (
            <p
              role="status"
              className="self-start rounded-md border border-[#FECACA] bg-white px-2 py-1 text-[12px] text-[#B91C1C]"
            >
              검색어는 {SURVEY_LIST_SEARCH_MAX_WORDS}단어, {SURVEY_LIST_SEARCH_MAX_LENGTH}자까지 쓸
              수 있습니다
            </p>
          )}
          {open && (
            <div
              id={listboxId}
              role="listbox"
              aria-label="검색 후보"
              // 후보를 눌러도 입력칸이 포커스를 잃지 않게 — 잃으면 창이 닫혀 클릭이 닿지 않는다.
              onMouseDown={(e) => e.preventDefault()}
              // 창을 떠나면 좌표를 잊는다 — 다시 들어올 때(또는 다시 열린 창이 커서 밑에 펼쳐질 때)의
              // 첫 신호는 움직임으로 치지 않는다.
              onMouseLeave={() => {
                lastPointerRef.current = null;
              }}
              className="overflow-hidden rounded-[14px] border border-[#E5E5EA] bg-white py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
            >
              {sections.map((section) => (
                <SuggestSectionView
                  key={section.key}
                  section={section}
                  idPrefix={baseId}
                  optionId={optionId}
                  activeKey={resolvedActiveKey}
                  onSelect={select}
                  onHover={hover}
                />
              ))}
              <div className="mt-1 flex items-center justify-between gap-3 border-t border-[#F0F0F3] px-2 pt-1.5">
                <div
                  id={optionId('all')}
                  role="option"
                  aria-selected={resolvedActiveKey === 'all'}
                  onClick={() => select(allOption)}
                  onMouseMove={(e) => hover('all', e)}
                  className={cn(
                    'min-w-0 cursor-pointer truncate rounded-lg px-2 py-1.5 text-[13px] font-medium text-[#2E4FCE]',
                    resolvedActiveKey === 'all' && 'bg-[#EEF2FF]',
                  )}
                >
                  「{draft.trim()}」 검색 결과 모두 보기
                </div>
                <span aria-hidden className="shrink-0 pr-2 text-[12px] text-[#9CA3AF]">
                  ↑↓ 이동 · Enter 선택 · Esc 닫기
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 접힌 칩 수 — 누르면 칩을 모두 펼친다. */
function ChipOverflowButton({
  count,
  className,
  onClick,
}: {
  count: number;
  className: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`검색 칩 ${count}개 더 보기`}
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-md bg-[#EAF0FF] px-1.5 text-[12.5px] leading-6 text-[#2743AE] hover:bg-[#D6E0FF]',
        className,
      )}
    >
      +{count}
    </button>
  );
}

/** 칸 순서 — 「내 태그」 → 「소유자」 → 「설문」, 맞는 것이 없는 칸은 그리지 않는다(설문은 찾는 중이면 선다). */
function buildSections(
  draft: string,
  tagHits: readonly PersonalTagItem[],
  owners: readonly SurveyListOwner[],
  suggestions: SurveySuggestion[] | null,
  isPending: boolean,
): SuggestSection[] {
  const sections: SuggestSection[] = [];
  if (tagHits.length > 0) {
    sections.push({
      key: 'tags',
      label: '내 태그',
      options: tagHits.map((tag) => ({ kind: 'tag', key: `tag-${tag.id}`, tag })),
    });
  }
  const ownerHits = matchOwnerSuggestions(owners, draft);
  if (ownerHits.length > 0) {
    sections.push({
      key: 'owners',
      label: '소유자',
      options: ownerHits.map((owner) => ({ kind: 'owner', key: `owner-${owner.id}`, owner })),
    });
  }
  if (suggestions && suggestions.length > 0) {
    sections.push({
      key: 'surveys',
      label: '설문',
      options: suggestions.map((survey) => ({
        kind: 'survey',
        key: `survey-${survey.id}`,
        survey,
      })),
    });
  } else if (isPending) {
    sections.push({ key: 'surveys', label: '설문', options: [], placeholder: '찾는 중…' });
  }
  return sections;
}

function SuggestSectionView({
  section,
  idPrefix,
  optionId,
  activeKey,
  onSelect,
  onHover,
}: {
  section: SuggestSection;
  idPrefix: string;
  optionId: (key: string) => string;
  activeKey: string | null;
  onSelect: (option: SuggestOption) => void;
  onHover: (key: string, event: MouseEvent) => void;
}) {
  const labelId = `${idPrefix}-section-${section.key}`;
  return (
    <div role="group" aria-labelledby={labelId} className="px-2 pb-1">
      <div id={labelId} className="px-2 pt-2 pb-1 text-[12px] font-medium text-[#6E6E73]">
        {section.label}
      </div>
      {section.placeholder && section.options.length === 0 && (
        <div aria-hidden className="px-2 py-2 text-[13px] text-[#9CA3AF]">
          {section.placeholder}
        </div>
      )}
      {section.options.map((option) => {
        const active = option.key === activeKey;
        return (
          <div
            key={option.key}
            id={optionId(option.key)}
            role="option"
            aria-selected={active}
            onClick={() => onSelect(option)}
            onMouseMove={(e) => onHover(option.key, e)}
            className={cn(
              'flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13.5px] text-[#1C1C1E]',
              active && 'bg-[#EEF2FF]',
            )}
          >
            <OptionContent option={option} active={active} />
          </div>
        );
      })}
    </div>
  );
}

function OptionContent({ option, active }: { option: SuggestOption; active: boolean }) {
  switch (option.kind) {
    case 'tag':
      return (
        <>
          <Hash className="h-4 w-4 shrink-0 text-[#9CA3AF]" aria-hidden />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <PersonalTagLabel tag={option.tag} className="max-w-[240px] min-w-0" />
            <span className="shrink-0 text-[12px] text-[#9CA3AF]">
              설문 {option.tag.linkCount}개
            </span>
          </span>
          {active && (
            <span className="shrink-0 text-[12px] text-[#6E6E73]">Enter 로 필터 추가</span>
          )}
        </>
      );
    case 'owner':
      return (
        <>
          <UserRound className="h-4 w-4 shrink-0 text-[#9CA3AF]" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{option.owner.name}</span>
          {active && (
            <span className="shrink-0 text-[12px] text-[#6E6E73]">Enter 로 소유자 조건 걸기</span>
          )}
        </>
      );
    case 'survey': {
      const { survey } = option;
      const meta = [survey.ownerName, LIFECYCLE_LABELS[survey.lifecycle]]
        .filter(Boolean)
        .join(' · ');
      return (
        <>
          <FileText className="h-4 w-4 shrink-0 text-[#9CA3AF]" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{survey.displayTitle}</span>
          <span className="shrink-0 text-[12px] text-[#9CA3AF]">{meta}</span>
        </>
      );
    }
    case 'all':
      return null;
  }
}
