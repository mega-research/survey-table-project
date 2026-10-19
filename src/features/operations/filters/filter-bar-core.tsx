'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { FILTER_SOURCE, type ColumnCandidate } from '@/lib/operations/filter-shared';

import { PiiExactMarker } from '@/features/operations/filter-pii-marker';

import { ClauseRow, type ClauseRowValue } from './clause-row';

// 서버 FilterClause 와 형상 같지만 client 모듈이라 서버 import 못 함 - 인라인.
export interface ClientFilterClause {
  op: 'AND' | 'OR' | null;
  source: string;
  value: string;
}

/** 페이지별 값 입력 위젯 렌더러 — 조사 대상은 결과코드/web select, 응답 내역은 text input. */
export type RenderValueWidget = (args: {
  source: string;
  value: string;
  onChange: (v: string) => void;
  inputId?: string;
}) => React.ReactNode;

/** 조건 줄 편집 상태 — 첫 줄의 op 는 무시된다. */
export type FilterDraftRow = ClauseRowValue;

/**
 * 조건 줄 → 편집 상태. id 는 React key 안정성을 위한 식별자라 영속 ID 가 아니다 —
 * 매 mount/sync 시 새로 부여한다.
 */
export function clausesToDraftRows(clauses: ClientFilterClause[]): FilterDraftRow[] {
  return clauses.map((c, idx) => ({
    id: `init-${idx}`,
    op: (c.op ?? 'AND') as 'AND' | 'OR',
    source: c.source,
    value: c.value,
  }));
}

/**
 * 편집 상태 → 값이 있는 조건 줄. 빈 value 줄은 silent drop, 첫 줄의 op 는 빈 문자열.
 * URL 직렬화(col/q/op)와 서버 배열 입력이 같은 모양을 쓴다.
 */
export function draftRowsToClauses(
  rows: FilterDraftRow[],
): Array<{ source: string; value: string; op: '' | 'AND' | 'OR' }> {
  const out: Array<{ source: string; value: string; op: '' | 'AND' | 'OR' }> = [];
  for (const r of rows) {
    if (!r.source || r.value.trim().length === 0) continue;
    out.push({ source: r.source, value: r.value.trim(), op: out.length === 0 ? '' : r.op });
  }
  return out;
}

export function newDraftRowId(): string {
  return `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface Props {
  /** 조건 줄 편집 상태 — rows[0] 이 첫 절이다. */
  rows: FilterDraftRow[];
  onRowsChange: (rows: FilterDraftRow[]) => void;
  /** 검색 실행 — bar 의 [검색] 버튼·Enter. 없으면 검색 버튼을 그리지 않는다. */
  onSubmit?: () => void;
  /**
   * 바깥 컨테이너. 다른 폼 안에 들어가는 화면(컨택원 수정)은 'div' — 폼 중첩 금지.
   * 'div' 면 검색 버튼이 type=button 으로 onSubmit 을 직접 부른다.
   */
  as?: 'form' | 'div';
  /**
   * bar: 검색바 한 줄 + [▼ 필터] 로 펼치는 추가 조건 (조사 대상·응답 내역).
   * stack: 조건 줄을 전부 펼쳐 세로로 쌓는다 (컨택원 수정 — 검색 버튼 없음).
   */
  variant?: 'bar' | 'stack';
  columnCandidates: ColumnCandidate[];
  renderValueWidget: RenderValueWidget;
  /** source 변경/조건 추가 시 초기 value. 기본 빈 문자열. */
  defaultValueForSource?: (source: string) => string;
  ariaLabel: string;
  /** 있을 때만 "컬럼 설정" 버튼 노출. */
  columnsSettingsHref?: string;
  /** 검색 버튼 뒤에 붙는 페이지 전용 컨트롤 (예: 응답 내역 상태 select). */
  trailing?: React.ReactNode;
  /** trailing 뒤 초기화 버튼 자리 — URL 을 아는 래퍼가 채운다. */
  resetControl?: React.ReactNode;
  /** 검색 버튼 비활성 (예: 검색 직전 값 변환 중). */
  submitDisabled?: boolean;
  /** stack 의 [+ 조건 추가] 오른쪽 자리 (예: 조건에 맞는 대상 인원). */
  stackFooter?: React.ReactNode;
  /** stack 에서 조건 줄 안으로 포커스가 들어올 때 — 오른쪽 패널이 따라간다. */
  onRowFocus?: (rowId: string) => void;
}

/**
 * 다중 절(AND/OR) 조건 편집기 공용 코어 — 제어형. URL·router 를 모른다.
 *
 * - 조건 상태(rows)를 받아 그리고, 바뀐 조건을 onRowsChange 로 돌려준다.
 * - 검색바 동작(URL 직렬화·헤더 필터 상호배타·페이지 초기화)은 UrlFilterBar 래퍼 몫이다.
 * - bar: 단순 검색바 = 첫 절 (첫 절 컬럼 기본값은 전체 컬럼). [▼ 필터] 클릭 시 두 번째
 *   이후 절 패널 펼침 (활성 조건 2개 이상이면 처음부터 펼침).
 */
export function FilterBarCore({
  rows,
  onRowsChange,
  onSubmit,
  as = 'form',
  variant = 'bar',
  columnCandidates,
  renderValueWidget,
  defaultValueForSource = () => '',
  ariaLabel,
  columnsSettingsHref,
  trailing,
  resetControl,
  submitDisabled = false,
  stackFooter,
  onRowFocus,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(rows.length >= 2);

  const addRow = () => {
    const firstItem = columnCandidates[0];
    if (!firstItem) return;
    const source = firstItem.source;
    // bar 의 첫 줄은 비어 있어도 화면에 있다 — 상태에도 자리를 채워 둬야 추가 줄이 두 번째가 된다.
    const base =
      variant === 'bar' && rows.length === 0
        ? [{ id: newDraftRowId(), op: 'AND' as const, source: FILTER_SOURCE.ALL, value: '' }]
        : rows;
    onRowsChange([
      ...base,
      { id: newDraftRowId(), op: 'AND', source, value: defaultValueForSource(source) },
    ]);
    setAdvancedOpen(true);
  };

  const updateAt = (i: number, next: FilterDraftRow) => {
    onRowsChange(rows.map((r, idx) => (idx === i ? next : r)));
  };

  const removeAt = (i: number) => {
    onRowsChange(rows.filter((_, idx) => idx !== i));
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };

  const Container = as;
  const containerProps =
    as === 'form'
      ? { onSubmit: handleFormSubmit, role: 'search' as const, 'aria-label': ariaLabel }
      : { role: 'search' as const, 'aria-label': ariaLabel };

  if (variant === 'stack') {
    return (
      <Container {...containerProps}>
        {rows.map((r, i) => (
          <div
            key={r.id}
            onFocusCapture={onRowFocus ? () => onRowFocus(r.id) : undefined}
          >
            <ClauseRow
              clause={r}
              columnCandidates={columnCandidates}
              renderValueWidget={renderValueWidget}
              defaultValueForSource={defaultValueForSource}
              onChange={(next) => updateAt(i, next)}
              onRemove={() => removeAt(i)}
              index={i - 1}
              first={i === 0}
            />
          </div>
        ))}
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-0 text-blue-600 hover:bg-transparent hover:text-blue-700"
            onClick={addRow}
            disabled={columnCandidates.length === 0}
          >
            + 조건 추가
          </Button>
          {stackFooter}
        </div>
      </Container>
    );
  }

  const first = rows[0] ?? { id: 'first', op: 'AND' as const, source: FILTER_SOURCE.ALL, value: '' };
  const extras = rows.slice(1);
  const setFirst = (next: { source: string; value: string }) => {
    const row = { ...first, ...next };
    onRowsChange(rows.length === 0 ? [row] : [row, ...extras]);
  };

  return (
    <Container {...containerProps} className="mb-3">
      <div className="flex items-center gap-2">
        <label htmlFor="contacts-first-source" className="sr-only">
          검색 컬럼
        </label>
        <Select
          value={first.source}
          onValueChange={(v) =>
            // source 변경 시 이전 mode 의 value 는 의미 없음 — 페이지별 기본값으로 초기화.
            setFirst({ source: v, value: defaultValueForSource(v) })
          }
        >
          <SelectTrigger id="contacts-first-source" className="h-10 w-[180px] shrink-0">
            <SelectValue placeholder="컬럼 선택" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {columnCandidates.map((c) => (
              <SelectItem key={c.source} value={c.source}>
                {c.label}
                <PiiExactMarker source={c.source} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label htmlFor="contacts-first-value" className="sr-only">
          검색어
        </label>
        {renderValueWidget({
          source: first.source,
          value: first.value,
          onChange: (v) => setFirst({ source: first.source, value: v }),
          inputId: 'contacts-first-value',
        })}

        {onSubmit && (
          <Button
            type={as === 'form' ? 'submit' : 'button'}
            {...(as === 'form' ? {} : { onClick: onSubmit })}
            className="h-10"
            disabled={columnCandidates.length === 0 || submitDisabled}
          >
            검색
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10"
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          {advancedOpen ? '▲' : '▼'} 필터
          {extras.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 px-1.5">
              {extras.length}
            </Badge>
          )}
        </Button>
        {/* 페이지 전용 컨트롤(응답 내역 상태 select 등) 오른쪽에 배치 */}
        {trailing}
        {resetControl}
        {columnsSettingsHref && (
          <Button asChild variant="outline" className="ml-auto h-10">
            <Link href={columnsSettingsHref}>컬럼 설정</Link>
          </Button>
        )}
      </div>

      {advancedOpen && (
        <div className="mt-2 rounded border border-dashed border-slate-300 bg-white p-3">
          {extras.map((c, i) => (
            <ClauseRow
              key={c.id}
              clause={c}
              columnCandidates={columnCandidates}
              renderValueWidget={renderValueWidget}
              defaultValueForSource={defaultValueForSource}
              onChange={(next) => updateAt(i + 1, next)}
              onRemove={() => removeAt(i + 1)}
              index={i}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            className="border-dashed text-slate-600"
            onClick={addRow}
          >
            + 조건 추가
          </Button>
        </div>
      )}
    </Container>
  );
}
