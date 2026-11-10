'use client';

import { useState } from 'react';

import { type UseQueryResult } from '@tanstack/react-query';
import { Search } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { attrsKeyOf, piiKeyOf } from '@/lib/operations/contacts-format';
import {
  type ColumnCandidate,
  FILTER_SOURCE,
  decodeMultiClauseValue,
  encodeMultiClauseValue,
} from '@/lib/operations/filter-shared';
import { cn } from '@/lib/utils';
import type { ContactAssignmentClause } from '@/shared/contracts/contacts';
import type { ContactAssignmentMatchRow } from '@/shared/contracts/contacts-io';

/**
 * 조건 편집 화면의 공용 조각 — 컨택원 수정(`assignments/`)과 외주 담당 범위 수정(`shares/`)이 같은 손 모양이라
 * 한 벌로 둔다(ADR-0035). 왼쪽 조건 줄 상태는 `use-clause-draft`, 여기는 화면 조각이다.
 *
 * 오른쪽 패널은 지금 고른 조건 줄을 따라 바뀐다: 체크박스형 열이면 값 목록(`ValuesPanel`), 그 밖이면 각 화면이
 * 그리는 조건에 맞는 대상 목록이다. 두 화면이 다른 것은 값 목록·대상 목록을 묻는 RPC 와 대상 목록의 마지막
 * 열(현재 컨택원 / 현재 링크), 그리고 미리보기 인원 옆의 안내뿐이다.
 */

const PAGE_SIZE = 10;
export const formatCount = (n: number) => n.toLocaleString('ko-KR');
const fmt = formatCount;

/** 왼쪽 조건 줄 아래 「조건에 맞는 대상 N명」 — `extra` 는 화면마다 덧붙이는 안내(다른 링크에 이미 있는 인원 등). */
export function ClauseMatchedCount({
  empty,
  settling,
  error,
  matched,
  extra,
}: {
  empty: boolean;
  settling: boolean;
  error: string | null;
  matched: number | undefined;
  extra?: React.ReactNode;
}) {
  if (empty) {
    return (
      <span className="text-sm text-slate-500">조건을 하나 이상 넣어야 적용할 수 있습니다</span>
    );
  }
  if (error) {
    return (
      <span role="alert" className="text-sm text-red-600">
        {error}
      </span>
    );
  }
  return (
    <span className="text-sm text-slate-600" aria-live="polite">
      조건에 맞는 대상{' '}
      <strong className={`text-base text-blue-600 ${settling ? 'opacity-50' : ''}`}>
        {matched === undefined ? '…' : `${fmt(matched)}명`}
      </strong>
      {extra}
    </span>
  );
}

/** 값 목록을 고정 선택지로 그리는 열 — 조사 대상 열 머리 필터가 체크박스로 그리는 열과 같다. */
export const FIXED_CHECKBOX_SOURCES: ReadonlySet<string> = new Set([
  FILTER_SOURCE.CONTACT_RESULT,
  FILTER_SOURCE.WEB,
  FILTER_SOURCE.EMAIL,
  FILTER_SOURCE.CONTACT_OWNER,
]);

/** 이 열은 값 목록으로 그리는가 — 고정 선택지 열이거나 attrs 열(값 종류는 서버가 본다). */
export function isFacetableSource(source: string): boolean {
  return FIXED_CHECKBOX_SOURCES.has(source) || source.startsWith(FILTER_SOURCE.ATTRS_PREFIX);
}

/** 값 목록 RPC 의 모양 — 두 화면의 facets 표면이 같은 모양을 돌려준다(값 종류가 많으면 `many`). */
type FacetsResult =
  | {
      kind: 'values';
      values: Array<{ value: string; label: string; count: number }>;
      total: number;
    }
  | { kind: 'many' };

/**
 * 오른쪽 패널의 갈래 — 값 목록이 서면 그것, 값 목록을 불러오는 중이면 빈 껍데기, 아니면 대상 목록(`matches`).
 * `facetsQuery` 는 화면이 자기 RPC 로 만든다(`enabled` 는 `isFacetableSource(source)`).
 */
export function ClauseSidePanel({
  source,
  facetable,
  facetsQuery,
  columnCandidates,
  value,
  onChange,
  matches,
}: {
  source: string;
  facetable: boolean;
  facetsQuery: Pick<UseQueryResult<FacetsResult>, 'data' | 'isPending'>;
  columnCandidates: ColumnCandidate[];
  value: string;
  onChange: (value: string) => void;
  matches: React.ReactNode;
}) {
  const data = facetsQuery.data;
  if (facetable && data?.kind === 'values') {
    return (
      <ValuesPanel
        key={source}
        label={columnCandidates.find((c) => c.source === source)?.label ?? source}
        values={data.values}
        total={data.total}
        value={value}
        onChange={onChange}
      />
    );
  }
  if (facetable && facetsQuery.isPending) {
    return <PanelShell title="값 목록" subtitle="불러오는 중…" />;
  }
  return <>{matches}</>;
}

/**
 * 대상 목록에 한 열 더 보일 포커스 열 — 포커스 열이 시스템ID·표시 첫 열과 겹치지 않는 attrs·개인정보 열일 때만.
 */
export function matchesFocusColumn(
  focused: { source: string } | null,
  displayColumn: { source: string } | null,
  columnCandidates: ColumnCandidate[],
): { source: string; label: string } | null {
  if (
    !focused ||
    focused.source === FILTER_SOURCE.RESID ||
    focused.source === displayColumn?.source ||
    !(
      focused.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX) ||
      focused.source.startsWith(FILTER_SOURCE.PII_PREFIX)
    )
  ) {
    return null;
  }
  return {
    source: focused.source,
    label: columnCandidates.find((c) => c.source === focused.source)?.label ?? focused.source,
  };
}

/** 대상 목록의 쪽 — 조건이 바뀌면 첫 쪽으로 돌아간다. */
export function useClauseMatchesPage(clauses: ContactAssignmentClause[] | null) {
  const [page, setPage] = useState(1);
  const clausesKey = JSON.stringify(clauses);
  const [prevKey, setPrevKey] = useState(clausesKey);
  if (prevKey !== clausesKey) {
    setPrevKey(clausesKey);
    setPage(1);
  }
  return [page, setPage] as const;
}

export function PanelShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <aside className="rounded-lg border bg-white p-4" aria-label={title}>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      {children}
    </aside>
  );
}

export function ValuesPanel({
  label,
  values,
  total,
  value,
  onChange,
}: {
  label: string;
  values: Array<{ value: string; label: string; count: number }>;
  total: number;
  value: string;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // 조건 줄 값 ↔ 체크 — 여러 값 형식이면 그 값들, 단일 값이면 그 값 하나가 목록에 있을 때만.
  const decoded = decodeMultiClauseValue(value);
  const selected = new Set(
    decoded ?? (values.some((v) => v.value === value.trim()) ? [value.trim()] : []),
  );
  const write = (next: Set<string>) =>
    // 목록 순서로 정렬해 같은 선택이면 같은 값이 되게 한다.
    onChange(encodeMultiClauseValue(values.map((v) => v.value).filter((v) => next.has(v))));

  const term = search.trim().toLowerCase();
  const filtered = term ? values.filter((v) => v.label.toLowerCase().includes(term)) : values;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const shown = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const selectedCount = values.filter((v) => selected.has(v.value)).length;
  const selectedPeople = values
    .filter((v) => selected.has(v.value))
    .reduce((n, v) => n + v.count, 0);

  return (
    <PanelShell title={label} subtitle="선택한 조건 줄의 열에 들어 있는 값 · 명단 전체 기준 인원">
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          aria-label="값 검색"
          placeholder="값 검색"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="h-9 pl-8"
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="space-x-1 text-blue-600">
          <button
            type="button"
            className="hover:underline"
            onClick={() => write(new Set([...selected, ...filtered.map((v) => v.value)]))}
          >
            전체 선택
          </button>
          <span className="text-slate-300">·</span>
          <button
            type="button"
            className="hover:underline"
            onClick={() => {
              const next = new Set(selected);
              for (const v of filtered) next.delete(v.value);
              write(next);
            }}
          >
            선택 해제
          </button>
        </span>
        <span className="font-medium text-blue-700">
          {fmt(selectedCount)}개 선택 · 명단 {fmt(selectedPeople)}명
        </span>
      </div>
      <ul className="mt-2 divide-y rounded border">
        {shown.length === 0 && (
          <li className="px-3 py-4 text-center text-xs text-slate-400">맞는 값이 없습니다</li>
        )}
        {shown.map((v) => {
          const checked = selected.has(v.value);
          return (
            <li key={v.value} className={cn(checked && 'bg-blue-50/60')}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) => {
                    const next = new Set(selected);
                    if (c === true) next.add(v.value);
                    else next.delete(v.value);
                    write(next);
                  }}
                />
                <span className="flex-1 truncate">{v.label}</span>
                <span className="text-xs text-slate-400 tabular-nums">{fmt(v.count)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <Pager
        summary={`값 ${fmt(shown.length)} / ${fmt(filtered.length)}개 · 명단 ${fmt(total)}명`}
        page={safePage}
        pageCount={pageCount}
        onPage={setPage}
      />
    </PanelShell>
  );
}

/** 대상 목록 칸 값 — 개인정보 열은 목록 화면과 같은 마스킹 힌트만 (평문은 오지 않는다). */
export function cellValue(
  row: Pick<ContactAssignmentMatchRow, 'attrs' | 'piiMaskHints'>,
  source: string,
): string {
  const ak = attrsKeyOf(source);
  if (ak) return row.attrs[ak] || '—';
  const pk = piiKeyOf(source);
  if (pk) return row.piiMaskHints[pk]?.maskHint ?? '—';
  return '—';
}

export function Pager({
  summary,
  page,
  pageCount,
  onPage,
}: {
  summary: string;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
      <span>{summary}</span>
      {pageCount > 1 && (
        <span className="flex items-center gap-1">
          <button
            type="button"
            className="px-1 disabled:opacity-30"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label="이전 쪽"
          >
            ‹
          </button>
          <span className="tabular-nums">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            className="px-1 disabled:opacity-30"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
            aria-label="다음 쪽"
          >
            ›
          </button>
        </span>
      )}
    </div>
  );
}
