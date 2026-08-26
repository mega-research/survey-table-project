'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSearchParamsMutator } from '@/hooks/use-search-params-mutator';
import { FILTER_SOURCE, type ColumnCandidate } from '@/lib/operations/filter-shared';
import {
  clearHeaderFilterParams,
  hasHeaderFilterParams,
} from '@/lib/operations/header-filter-url';

import { PiiExactMarker } from '@/components/operations/filter-pii-marker';

import { ClauseRow, type ClauseRowValue } from './clause-row';
import { FilterResetButton } from './filter-reset-button';

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

interface Props {
  initialClauses: ClientFilterClause[];
  columnCandidates: ColumnCandidate[];
  renderValueWidget: RenderValueWidget;
  /** source 변경/조건 추가 시 초기 value. 기본 빈 문자열. */
  defaultValueForSource?: (source: string) => string;
  ariaLabel: string;
  /** 있을 때만 "컬럼 설정" 버튼 노출. */
  columnsSettingsHref?: string;
  /** 검색 버튼 뒤에 붙는 페이지 전용 컨트롤 (예: 응답 내역 상태 select). */
  trailing?: React.ReactNode;
  /** 검색 실행 시 URL 파라미터 추가 조작 (예: status 반영). */
  onSubmitParams?: (p: URLSearchParams) => void;
  /** 초기화 버튼이 함께 지울 페이지 전용 필터 파라미터 (예: 응답 내역 status). */
  resetExtraParams?: string[];
}

/**
 * 다중 절(AND/OR) 필터 검색바 공용 코어 — 조사 대상·응답 내역이 wrapper 로 공유.
 *
 * - 단순 검색바 = 첫 절 (op=null). 첫 절 컬럼 기본값은 전체 컬럼.
 * - [▼ 필터] 클릭 시 두 번째 이후 절 패널 펼침 (활성 조건 2개 이상이면 자동 펼침)
 * - URL ?col[]=&q[]=&op[]= multi-value 직렬화. 빈 value 절은 [검색] 시 silent drop.
 * - 헤더 깔때기 필터와 상호배타 — 검색 시 헤더 필터는 경고 후 해제.
 */
export function FilterBarCore({
  initialClauses,
  columnCandidates,
  renderValueWidget,
  defaultValueForSource = () => '',
  ariaLabel,
  columnsSettingsHref,
  trailing,
  onSubmitParams,
  resetExtraParams = [],
}: Props) {
  // ClauseRowValue.id 는 React key 안정성을 위한 식별자 — URL 의 인덱스가 아니라 행 자체의
  // 생명주기를 따라간다. 매 mount/sync 시 새로 부여하므로 영속 ID 는 아님.
  const toExtraRow = (c: ClientFilterClause, idx: number): ClauseRowValue => ({
    id: `init-${idx}`,
    op: (c.op ?? 'AND') as 'AND' | 'OR',
    source: c.source,
    value: c.value,
  });

  // 첫 절 컬럼 기본값은 전체 컬럼 — 컬럼을 고르지 않고 바로 검색 가능.
  const [firstSource, setFirstSource] = useState<string>(
    initialClauses[0]?.source ?? FILTER_SOURCE.ALL,
  );
  const [firstValue, setFirstValue] = useState<string>(initialClauses[0]?.value ?? '');
  const [extraClauses, setExtraClauses] = useState<ClauseRowValue[]>(
    initialClauses.slice(1).map(toExtraRow),
  );
  const [advancedOpen, setAdvancedOpen] = useState(initialClauses.length >= 2);
  const [exclusionConfirmOpen, setExclusionConfirmOpen] = useState(false);
  const [, startTransition] = useTransition();
  const pushParams = useSearchParamsMutator();
  const searchParams = useSearchParams();

  // 브라우저 뒤로/앞으로 가기 시 동기화 — effect 대신 렌더 중 조정 패턴.
  // 참조가 아니라 직렬화 키로 비교해 매 렌더 새 배열 참조에도 reset 되지 않게 한다.
  const initialClausesKey = JSON.stringify(initialClauses);
  const [prevInitialClausesKey, setPrevInitialClausesKey] = useState(initialClausesKey);
  if (prevInitialClausesKey !== initialClausesKey) {
    setPrevInitialClausesKey(initialClausesKey);
    setFirstSource(initialClauses[0]?.source ?? FILTER_SOURCE.ALL);
    setFirstValue(initialClauses[0]?.value ?? '');
    setExtraClauses(initialClauses.slice(1).map(toExtraRow));
    setAdvancedOpen(initialClauses.length >= 2);
  }

  const runSearch = () => {
    const cols: string[] = [];
    const qs: string[] = [];
    const ops: string[] = [];
    if (firstSource && firstValue.trim().length > 0) {
      cols.push(firstSource);
      qs.push(firstValue.trim());
      ops.push('');
    }
    for (const c of extraClauses) {
      if (!c.source || c.value.trim().length === 0) continue;
      cols.push(c.source);
      qs.push(c.value.trim());
      ops.push(c.op);
    }
    startTransition(() => {
      pushParams((p) => {
        p.delete('col');
        p.delete('q');
        p.delete('op');
        cols.forEach((c) => p.append('col', c));
        qs.forEach((q) => p.append('q', q));
        ops.forEach((o) => p.append('op', o));
        // 필터 모드 상호배타 — 빌더 검색 시 헤더 필터는 항상 해제.
        clearHeaderFilterParams(p);
        p.delete('page');
        onSubmitParams?.(p);
      });
    });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // 헤더 필터가 활성이면 경고 후 진행 (확인 시 헤더 필터 폐기).
    if (hasHeaderFilterParams(new URLSearchParams(searchParams.toString()))) {
      setExclusionConfirmOpen(true);
      return;
    }
    runSearch();
  };

  const addClause = () => {
    if (columnCandidates.length === 0) return;
    const firstItem = columnCandidates[0];
    if (!firstItem) return;
    const firstCandidate = firstItem.source;
    const id = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setExtraClauses((cs) => [
      ...cs,
      { id, op: 'AND', source: firstCandidate, value: defaultValueForSource(firstCandidate) },
    ]);
    setAdvancedOpen(true);
  };

  const updateExtraAt = (i: number, next: ClauseRowValue) => {
    setExtraClauses((cs) => cs.map((c, idx) => (idx === i ? next : c)));
  };

  const removeExtraAt = (i: number) => {
    setExtraClauses((cs) => cs.filter((_, idx) => idx !== i));
  };

  return (
    <form
      onSubmit={handleSearch}
      className="mb-3"
      role="search"
      aria-label={ariaLabel}
    >
      <div className="flex items-center gap-2">
        <label htmlFor="contacts-first-source" className="sr-only">
          검색 컬럼
        </label>
        <Select
          value={firstSource}
          onValueChange={(v) => {
            setFirstSource(v);
            // source 변경 시 이전 mode 의 value 는 의미 없음 — 페이지별 기본값으로 초기화.
            setFirstValue(defaultValueForSource(v));
          }}
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
          source: firstSource,
          value: firstValue,
          onChange: setFirstValue,
          inputId: 'contacts-first-value',
        })}

        <Button
          type="submit"
          className="h-10"
          disabled={columnCandidates.length === 0}
        >
          검색
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10"
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          {advancedOpen ? '▲' : '▼'} 필터
          {extraClauses.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 px-1.5">
              {extraClauses.length}
            </Badge>
          )}
        </Button>
        {trailing}
        {/* 페이지 전용 컨트롤(응답 내역 상태 select 등) 오른쪽에 배치 */}
        <FilterResetButton
          className="h-10"
          clearParams={['col', 'q', 'op', 'hcol', 'hm', 'hv', 'page', ...resetExtraParams]}
          activeParams={['col', 'q', 'op', 'hcol', 'hm', 'hv', ...resetExtraParams]}
          onReset={() => {
            // URL 변화가 서버 initial 로 되돌아와 동기화되지만, 검색 전 입력값은
            // URL 에 없어 남는다 — 로컬 state 도 즉시 비운다.
            setFirstSource(FILTER_SOURCE.ALL);
            setFirstValue('');
            setExtraClauses([]);
            setAdvancedOpen(false);
          }}
        />
        {columnsSettingsHref && (
          <Button asChild variant="outline" className="ml-auto h-10">
            <Link href={columnsSettingsHref}>컬럼 설정</Link>
          </Button>
        )}
      </div>

      {advancedOpen && (
        <div className="mt-2 rounded border border-dashed border-slate-300 bg-white p-3">
          {extraClauses.map((c, i) => (
            <ClauseRow
              key={c.id}
              clause={c}
              columnCandidates={columnCandidates}
              renderValueWidget={renderValueWidget}
              defaultValueForSource={defaultValueForSource}
              onChange={(next) => updateExtraAt(i, next)}
              onRemove={() => removeExtraAt(i)}
              index={i}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            className="border-dashed text-slate-600"
            onClick={addClause}
          >
            + 조건 추가
          </Button>
        </div>
      )}

      <AlertDialog open={exclusionConfirmOpen} onOpenChange={setExclusionConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>헤더 필터가 해제됩니다</AlertDialogTitle>
            <AlertDialogDescription>
              컬럼 헤더에 걸어둔 필터와 검색 조건은 동시에 사용할 수 없습니다. 계속하면
              헤더 필터가 해제되고 검색 조건만 적용됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setExclusionConfirmOpen(false);
                runSearch();
              }}
            >
              검색 실행
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
