'use client';

import { useMemo, useState } from 'react';

import { ArrowUpDown, ChevronDown, ChevronRight, Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  applyDemandView,
  type DemandSortMode,
  type DemandSummaryRow,
} from '@/lib/operations/demand-summary';
import { cn } from '@/lib/utils';

/**
 * 문항 수요 집계표 — **문항 하나가 한 줄**이다.
 *
 * 그룹은 소계 행을 만들지 않는다. 구분면 · 접기 · 필터 축으로만 쓴다.
 * 의견은 행을 그 자리에서 펼쳐 읽는다 — 별도 의견 목록 화면을 만들지 않는다.
 * 응답자별 비교 화면·응답자별 열도 만들지 않는다. 집계 숫자만 본다.
 */
interface Props {
  surveyId: string;
  rows: DemandSummaryRow[];
}

export function DemandSummaryTable({ surveyId, rows }: Props) {
  const [sortMode, setSortMode] = useState<DemandSortMode>('sheet');
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(new Set());

  const groupOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      if (row.groupId && !seen.has(row.groupId)) seen.set(row.groupId, row.groupName ?? row.groupId);
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [rows]);

  // 엑셀 라우트와 같은 순수 함수를 태운다 — 화면과 파일이 갈리지 않는 유일한 방법이다.
  const visibleRows = useMemo(
    () => applyDemandView(rows, { sort: sortMode, groupId: groupFilter }),
    [rows, groupFilter, sortMode],
  );

  // 그룹 구분면·접기는 행이 그룹별로 붙어 있을 때만 성립한다. 필요율로 정렬하면
  // 그룹이 섞이므로 구분면을 그릴 자리가 없다 — 그때 그룹 축은 위 필터 칩이 맡는다.
  const showGroupDividers = sortMode === 'sheet' && !groupFilter;

  const toggle = (
    set: ReadonlySet<string>,
    update: (next: ReadonlySet<string>) => void,
    key: string,
  ) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update(next);
  };

  const exportHref = `/api/surveys/${surveyId}/demand-summary?sort=${sortMode}${
    groupFilter ? `&groupId=${encodeURIComponent(groupFilter)}` : ''
  }`;

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-10 text-center">
        <p className="text-sm text-gray-600">아직 집계할 것이 없습니다.</p>
        <p className="mt-1 text-xs text-gray-500">
          설문을 배포하고 완료된 응답이 들어오면 문항별 판단이 여기 모입니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <FilterChip active={groupFilter === null} onClick={() => setGroupFilter(null)}>
            전체
          </FilterChip>
          {groupOptions.map((group) => (
            <FilterChip
              key={group.id}
              active={groupFilter === group.id}
              onClick={() => setGroupFilter(group.id)}
            >
              {group.name}
            </FilterChip>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setSortMode((mode) =>
                mode === 'need-asc' ? 'need-desc' : mode === 'need-desc' ? 'sheet' : 'need-asc',
              )
            }
          >
            <ArrowUpDown className="mr-1 h-3 w-3" />
            {sortMode === 'sheet'
              ? '조사표 순서'
              : sortMode === 'need-asc'
                ? '필요율 낮은 순'
                : '필요율 높은 순'}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={exportHref}>
              <Download className="mr-1 h-3 w-3" />
              엑셀
            </a>
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="w-24 px-3 py-2 text-left font-medium">문항코드</th>
              <th className="px-3 py-2 text-left font-medium">문항</th>
              <th className="w-20 px-3 py-2 text-right font-medium">필요</th>
              <th className="w-24 px-3 py-2 text-right font-medium">불필요</th>
              <th className="w-24 px-3 py-2 text-right font-medium">필요율</th>
              <th className="w-24 px-3 py-2 text-right font-medium">의견</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => {
              const prev = visibleRows[index - 1];
              const startsGroup = showGroupDividers && prev?.groupId !== row.groupId;
              const collapsed = row.groupId ? collapsedGroups.has(row.groupId) : false;
              const expanded = expandedRows.has(row.questionId);
              return (
                <GroupedRow
                  key={row.questionId}
                  row={row}
                  startsGroup={startsGroup}
                  collapsed={collapsed}
                  expanded={expanded}
                  onToggleGroup={() =>
                    row.groupId &&
                    toggle(collapsedGroups, setCollapsedGroups, row.groupId)
                  }
                  onToggleRow={() => toggle(expandedRows, setExpandedRows, row.questionId)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupedRow({
  row,
  startsGroup,
  collapsed,
  expanded,
  onToggleGroup,
  onToggleRow,
}: {
  row: DemandSummaryRow;
  startsGroup: boolean;
  collapsed: boolean;
  expanded: boolean;
  onToggleGroup: () => void;
  onToggleRow: () => void;
}) {
  return (
    <>
      {startsGroup && row.groupName && (
        <tr className="border-b border-gray-100 bg-gray-50/70">
          <td colSpan={6} className="px-3 py-1.5">
            <button
              type="button"
              onClick={onToggleGroup}
              className="flex items-center gap-1 text-xs font-semibold text-gray-700"
            >
              {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {row.groupName}
            </button>
          </td>
        </tr>
      )}
      {!collapsed && (
        <>
          <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
            <td className="px-3 py-2 font-mono text-xs text-gray-500">{row.questionCode ?? '—'}</td>
            <td className="px-3 py-2 text-gray-900">
              {row.title}
              {/* 옛 배포판의 답인데 그 버전의 문항 모양을 찾지 못한 건수. 분자에도
                  분모에도 없으므로 숫자가 이상할 때 여기부터 본다 — 늘 0 인 값에
                  열을 하나 내주지는 않는다. */}
              {row.uncountedCount > 0 && (
                <span
                  className="ml-1.5 rounded bg-amber-50 px-1 py-0.5 text-[11px] text-amber-700"
                  title={`이전 배포판 응답 ${row.uncountedCount}건은 그 버전의 문항을 찾지 못해 집계에서 빠졌습니다.`}
                >
                  해석 불가 {row.uncountedCount}
                </span>
              )}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{row.needCount ?? ''}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.dropCount ?? ''}</td>
            <td
              className={cn(
                'px-3 py-2 text-right tabular-nums',
                row.needRate !== null && row.needRate < 50 && 'font-semibold text-amber-700',
              )}
            >
              {/* 계산되지 않는 값은 비운다 — 0 으로 채우면 "아무도 필요하다고 안 했다"로 오해한다 */}
              {row.needRate === null ? '' : `${row.needRate.toFixed(0)}%`}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {row.opinionCount > 0 ? (
                <button
                  type="button"
                  onClick={onToggleRow}
                  className="rounded px-1.5 py-0.5 text-blue-600 hover:bg-blue-50"
                >
                  {row.opinionCount}
                </button>
              ) : (
                <span className="text-gray-400">0</span>
              )}
            </td>
          </tr>
          {expanded && row.opinions.length > 0 && (
            <tr className="border-b border-gray-100 bg-blue-50/40">
              <td />
              <td colSpan={5} className="px-3 py-2">
                <ul className="space-y-1 text-xs text-gray-700">
                  {row.opinions.map((opinion, index) => (
                    <li key={index} className="border-l-2 border-blue-300 pl-2">
                      {opinion}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          )}
        </>
      )}
    </>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        active
          ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
          : 'border-gray-200 text-gray-600 hover:bg-gray-50',
      )}
    >
      {children}
    </button>
  );
}
