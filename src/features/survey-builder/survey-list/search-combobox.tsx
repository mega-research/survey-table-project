'use client';

import { type KeyboardEvent, useId, useState } from 'react';

import { FileText, Search, UserRound } from 'lucide-react';

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

import { useSurveySuggestions } from '../queries/use-survey-suggestions';
import { dropWordsMatching, matchOwnerSuggestions } from './search-suggest';

const LIFECYCLE_LABELS: Record<SurveyListLifecycle, string> = {
  draft: '작성중',
  running: '진행중',
  closed: '종료',
};

/**
 * 후보 한 줄 — 칸(section)마다 종류가 다르다. 키보드 이동은 칸을 가로질러 **한 줄로 편 목록**
 * 위에서 하고, 바닥의 「모두 보기」가 그 목록의 마지막 줄이다. 티켓 10 의 「내 태그」 칸은 이
 * 합집합에 `{ kind: 'tag' }` 를 더하고 `buildSections` 맨 앞에 칸을 끼우면 된다.
 */
type SuggestOption =
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

interface SearchComboboxProps {
  /** 주소에 걸린(목록에 적용된) 검색어. */
  value: string;
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
 * 치면 열린다. 후보 줄은 mousedown 을 막아 클릭해도 입력칸의 포커스가 빠지지 않는다.
 *
 * 상한(단어 8개·100자)을 넘기는 입력은 받지 않는다(티켓 04) — 서버 입력 스키마가 같은 기준으로
 * 거부한다.
 */
export function SearchCombobox({
  value,
  onCommit,
  placeholder,
  suggestScope,
  suggestEnabled,
  owners,
  onPickOwner,
  onPickSurvey,
}: SearchComboboxProps) {
  const [draft, setDraft] = useState(value);
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

  const sections = open ? buildSections(draft, owners, suggestions, isPending) : [];
  const allOption: SuggestOption = { kind: 'all', key: 'all' };
  const flat = open ? [...sections.flatMap((s) => s.options), allOption] : [];
  const activeIndex = flat.findIndex((o) => o.key === activeKey);
  const optionId = (key: string) => `${baseId}-opt-${key}`;

  function close() {
    setDismissed(true);
    setActiveKey(null);
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

  return (
    <div className="relative min-w-0 flex-1">
      <Search className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
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
        placeholder={placeholder}
        maxLength={SURVEY_LIST_SEARCH_MAX_LENGTH}
        autoComplete="off"
        className={cn(
          'h-10 w-full rounded-[10px] border border-[#E5E5EA] bg-white pr-3 pl-10 text-[13.5px] text-[#1C1C1E] placeholder:text-[#9CA3AF] focus:border-[#2E4FCE] focus:outline-none',
          open && 'border-[#2E4FCE]',
        )}
      />

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
              className="overflow-hidden rounded-[14px] border border-[#E5E5EA] bg-white py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
            >
              {sections.map((section) => (
                <SuggestSectionView
                  key={section.key}
                  section={section}
                  idPrefix={baseId}
                  optionId={optionId}
                  activeKey={activeIndex >= 0 ? activeKey : null}
                  onSelect={select}
                  onHover={setActiveKey}
                />
              ))}
              <div className="mt-1 flex items-center justify-between gap-3 border-t border-[#F0F0F3] px-2 pt-1.5">
                <div
                  id={optionId('all')}
                  role="option"
                  aria-selected={activeKey === 'all'}
                  onClick={() => select(allOption)}
                  onMouseEnter={() => setActiveKey('all')}
                  className={cn(
                    'min-w-0 cursor-pointer truncate rounded-lg px-2 py-1.5 text-[13px] font-medium text-[#2E4FCE]',
                    activeKey === 'all' && 'bg-[#EEF2FF]',
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

/** 칸 순서 — 「소유자」(맞을 때만) → 「설문」. 티켓 10 이 맨 앞에 「내 태그」를 더한다. */
function buildSections(
  draft: string,
  owners: readonly SurveyListOwner[],
  suggestions: SurveySuggestion[] | null,
  isPending: boolean,
): SuggestSection[] {
  const sections: SuggestSection[] = [];
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
  onHover: (key: string) => void;
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
            onMouseEnter={() => onHover(option.key)}
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
          <span className="min-w-0 flex-1 truncate">{survey.cardTitle}</span>
          <span className="shrink-0 text-[12px] text-[#9CA3AF]">{meta}</span>
        </>
      );
    }
    case 'all':
      return null;
  }
}
