'use client';

import { useState } from 'react';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
import { client } from '@/shared/lib/rpc';

const PAGE_SIZE = 10;
const fmt = (n: number) => n.toLocaleString('ko-KR');

/** 값 목록을 고정 선택지로 그리는 열 — 조사 대상 열 머리 필터가 체크박스로 그리는 열과 같다. */
const FIXED_CHECKBOX_SOURCES: ReadonlySet<string> = new Set([
  FILTER_SOURCE.CONTACT_RESULT,
  FILTER_SOURCE.WEB,
  FILTER_SOURCE.EMAIL,
  FILTER_SOURCE.CONTACT_OWNER,
]);

interface Props {
  surveyId: string;
  assignment: { id: string; name: string };
  /** 지금 고른(포커스된) 조건 줄. 없으면 대상 목록. */
  focused: { source: string; value: string } | null;
  onFocusedValueChange: (value: string) => void;
  /** 서버로 보낼 수 있게 준비된 조건 (준비 전·오류면 null). */
  clauses: ContactAssignmentClause[] | null;
  columnCandidates: ColumnCandidate[];
  /** 대상 목록 두 번째 열 — 스킴의 표시 첫 attrs 열 (예: 기업명). */
  displayColumn: { source: string; label: string } | null;
  /** 미리보기가 알려 준 다른 컨택원 — 강조 안내 문구용. */
  otherOwnerNames: string[];
}

/**
 * 컨택원 수정 화면 오른쪽 (시안 C · C-2) — 지금 고른 조건 줄을 따라 바뀐다.
 * - 체크박스형 열(값 종류가 적은 attrs · 결과코드 · 응답 상태 · 메일 · 현재 컨택원): 값 목록
 *   (명단 전체 기준 인원). 체크하면 그 줄의 값이 된다(칩).
 * - 그 밖(시스템ID · 개인정보 · 값이 많은 attrs): 조건에 맞는 대상 목록 10명씩. 지금 다른
 *   컨택원에 있는 대상은 강조한다 — 교체하면 이 컨택원으로 옮겨진다.
 */
export function AssignmentSidePanel(props: Props) {
  const { surveyId, focused } = props;
  const source = focused?.source ?? '';
  const facetable =
    FIXED_CHECKBOX_SOURCES.has(source) || source.startsWith(FILTER_SOURCE.ATTRS_PREFIX);
  const facetsQuery = useQuery({
    queryKey: ['contact-assignment-facets', surveyId, source],
    queryFn: () => client.contacts.assignments.facets({ surveyId, source }),
    enabled: facetable,
    staleTime: 60_000,
  });

  if (facetable && facetsQuery.data?.kind === 'values') {
    return (
      <ValuesPanel
        key={source}
        label={props.columnCandidates.find((c) => c.source === source)?.label ?? source}
        values={facetsQuery.data.values}
        total={facetsQuery.data.total}
        value={focused?.value ?? ''}
        onChange={props.onFocusedValueChange}
      />
    );
  }
  if (facetable && facetsQuery.isPending) {
    return <PanelShell title="값 목록" subtitle="불러오는 중…" />;
  }
  return <MatchesPanel {...props} />;
}

function PanelShell({
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

function ValuesPanel({
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

function MatchesPanel({
  surveyId,
  assignment,
  focused,
  clauses,
  columnCandidates,
  displayColumn,
  otherOwnerNames,
}: Props) {
  const [page, setPage] = useState(1);
  const clausesKey = JSON.stringify(clauses);
  const [prevKey, setPrevKey] = useState(clausesKey);
  if (prevKey !== clausesKey) {
    setPrevKey(clausesKey);
    setPage(1);
  }

  const query = useQuery({
    queryKey: ['contact-assignment-matches', surveyId, clauses, page],
    queryFn: () => client.contacts.assignments.matches({ surveyId, clauses: clauses ?? [], page }),
    enabled: clauses != null && clauses.length > 0,
    placeholderData: keepPreviousData,
  });

  // 포커스 열이 시스템ID·표시 첫 열과 겹치지 않을 때만 한 열 더 보인다.
  const focusColumn =
    focused &&
    focused.source !== FILTER_SOURCE.RESID &&
    focused.source !== displayColumn?.source &&
    (focused.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX) ||
      focused.source.startsWith(FILTER_SOURCE.PII_PREFIX))
      ? {
          source: focused.source,
          label: columnCandidates.find((c) => c.source === focused.source)?.label ?? focused.source,
        }
      : null;

  const data = clauses && clauses.length > 0 ? query.data : undefined;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <PanelShell
      title={data ? `조건에 맞는 대상 ${fmt(data.total)}명` : '조건에 맞는 대상'}
      subtitle="이 줄은 값 목록 대신 지금 조건에 걸리는 대상을 보여 줍니다"
    >
      <div className="mt-3 overflow-x-auto rounded border">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">시스템ID</th>
              {displayColumn && (
                <th className="px-2 py-1.5 text-left font-medium">{displayColumn.label}</th>
              )}
              {focusColumn && (
                <th className="px-2 py-1.5 text-left font-medium">{focusColumn.label}</th>
              )}
              <th className="px-2 py-1.5 text-left font-medium">현재 컨택원</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {!data && (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-center text-slate-400">
                  {clauses == null || clauses.length === 0
                    ? '조건을 넣으면 보입니다'
                    : '불러오는 중…'}
                </td>
              </tr>
            )}
            {data?.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-center text-slate-400">
                  조건에 맞는 대상이 없습니다
                </td>
              </tr>
            )}
            {data?.rows.map((r) => (
              <tr key={r.id}>
                <td className="px-2 py-1.5 tabular-nums">{r.resid}</td>
                {displayColumn && (
                  <td className="max-w-[140px] truncate px-2 py-1.5">
                    {cellValue(r, displayColumn.source)}
                  </td>
                )}
                {focusColumn && (
                  <td className="max-w-[120px] truncate px-2 py-1.5">
                    {cellValue(r, focusColumn.source)}
                  </td>
                )}
                <td
                  className={cn(
                    'px-2 py-1.5',
                    r.assignment == null
                      ? 'text-slate-400'
                      : r.assignment.id === assignment.id
                        ? 'text-blue-700'
                        : 'font-medium text-orange-600',
                  )}
                >
                  {r.assignment?.name ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && (
        <Pager
          summary={`${fmt(data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1)}–${fmt(
            Math.min(data.page * data.pageSize, data.total),
          )} / ${fmt(data.total)}`}
          page={data.page}
          pageCount={pageCount}
          onPage={setPage}
        />
      )}
      {otherOwnerNames.length > 0 && (
        <p className="mt-2 text-xs text-orange-600">
          다른 컨택원({otherOwnerNames.join('·')})에 있던 대상은 교체하면 {assignment.name}(으)로
          옮겨집니다.
        </p>
      )}
    </PanelShell>
  );
}

/** 대상 목록 칸 값 — 개인정보 열은 목록 화면과 같은 마스킹 힌트만 (평문은 오지 않는다). */
function cellValue(row: ContactAssignmentMatchRow, source: string): string {
  const ak = attrsKeyOf(source);
  if (ak) return row.attrs[ak] || '—';
  const pk = piiKeyOf(source);
  if (pk) return row.piiMaskHints[pk]?.maskHint ?? '—';
  return '—';
}

function Pager({
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
