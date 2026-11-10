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
  const facetable = isFacetableSource(source);
  const facetsQuery = useQuery({
    queryKey: ['contact-assignment-facets', surveyId, source],
    queryFn: () => client.contacts.assignments.facets({ surveyId, source }),
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
  assignment,
  focused,
  clauses,
  columnCandidates,
  displayColumn,
  otherOwnerNames,
}: Props) {
  const [page, setPage] = useClauseMatchesPage(clauses);

  const query = useQuery({
    queryKey: ['contact-assignment-matches', surveyId, clauses, page],
    queryFn: () => client.contacts.assignments.matches({ surveyId, clauses: clauses ?? [], page }),
    enabled: clauses != null && clauses.length > 0,
    placeholderData: keepPreviousData,
  });

  const focusColumn = matchesFocusColumn(focused, displayColumn, columnCandidates);

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
