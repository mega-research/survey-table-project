'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { type ColumnCandidate } from '@/lib/operations/filter-shared';
import { cn } from '@/lib/utils';
import type { ContactAssignmentClause } from '@/shared/contracts/contacts';
import { client } from '@/shared/lib/rpc';

import {
  ClauseSidePanel,
  Pager,
  PanelShell,
  cellValue,
  formatCount as fmt,
  isFacetableSource,
  matchesFocusColumn,
  useClauseMatchesPage,
} from '../clause-editor-parts';

interface Props {
  surveyId: string;
  link: { id: string; name: string };
  focused: { source: string; value: string } | null;
  onFocusedValueChange: (value: string) => void;
  /** 서버로 보낼 수 있게 준비된 조건 (준비 전·오류면 null). */
  clauses: ContactAssignmentClause[] | null;
  columnCandidates: ColumnCandidate[];
  displayColumn: { source: string; label: string } | null;
}

/**
 * 담당 범위 수정 화면 오른쪽 — 컨택원 수정 화면과 같은 손 모양이다(ADR-0035): 체크박스형 열이면 값 목록,
 * 그 밖이면 조건에 맞는 대상 10명씩. 다른 점은 마지막 열이 「현재 컨택원」이 아니라 **「현재 링크」**라는
 * 것 — 그 대상이 지금 속한 열린 외주 링크다. 다른 링크에 있는 대상은 강조한다(적용하면 이쪽으로 옮겨진다).
 */
export function ShareSidePanel(props: Props) {
  const { surveyId, focused } = props;
  const source = focused?.source ?? '';
  const facetable = isFacetableSource(source);
  const facetsQuery = useQuery({
    queryKey: ['fieldwork-share-facets', surveyId, source],
    queryFn: () => client.contacts.fieldworkShares.facets({ surveyId, source }),
    enabled: facetable,
    staleTime: 60_000,
  });
  return (
    <ClauseSidePanel
      source={source}
      facetable={facetable}
      facetsQuery={facetsQuery}
      columnCandidates={props.columnCandidates}
      value={focused?.value ?? ''}
      onChange={props.onFocusedValueChange}
      matches={<MatchesPanel {...props} />}
    />
  );
}

function MatchesPanel({
  surveyId,
  link,
  focused,
  clauses,
  columnCandidates,
  displayColumn,
}: Props) {
  const [page, setPage] = useClauseMatchesPage(clauses);

  const query = useQuery({
    queryKey: ['fieldwork-share-matches', surveyId, link.id, clauses, page],
    queryFn: () =>
      client.contacts.fieldworkShares.matches({
        surveyId,
        linkId: link.id,
        clauses: clauses ?? [],
        page,
      }),
    enabled: clauses != null && clauses.length > 0,
    placeholderData: keepPreviousData,
  });

  const focusColumn = matchesFocusColumn(focused, displayColumn, columnCandidates);

  const data = clauses && clauses.length > 0 ? query.data : undefined;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const othersOnPage = data?.rows.some((r) => r.links.some((n) => n !== link.name)) ?? false;

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
              <th className="px-2 py-1.5 text-left font-medium">현재 링크</th>
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
            {data?.rows.map((r) => {
              const others = r.links.filter((n) => n !== link.name);
              return (
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
                      r.links.length === 0
                        ? 'text-slate-400'
                        : others.length > 0
                          ? 'font-medium text-orange-600'
                          : 'text-blue-700',
                    )}
                  >
                    {r.links.length === 0 ? '—' : r.links.join(' · ')}
                  </td>
                </tr>
              );
            })}
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
      {othersOnPage && (
        <p className="mt-2 text-xs text-orange-600">
          다른 외주 링크에 있는 대상은 적용하면 {link.name}(으)로 옮겨집니다.
        </p>
      )}
    </PanelShell>
  );
}
