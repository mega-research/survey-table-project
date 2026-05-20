'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';

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
import type { ContactResultCode } from '@/db/schema/schema-types';
import { FILTER_SOURCE, type ColumnCandidate } from '@/lib/operations/filter-shared';

import { PiiExactMarker } from '@/components/operations/filter-pii-marker';

import { ClauseRow, type ClauseRowValue } from './clause-row';
import { ValueWidget } from './value-widget';

// page.tsx 의 FilterClause 와 형상 같지만 client 모듈이라 서버 import 못 함 - 인라인.
interface ClientFilterClause {
  op: 'AND' | 'OR' | null;
  source: string;
  value: string;
}

interface Props {
  surveyId: string;
  initialClauses: ClientFilterClause[];
  columnCandidates: ColumnCandidate[];
  resultCodeOptions: ContactResultCode[];
}

/**
 * 조사 대상 필터 (다중 절 AND/OR 결합).
 *
 * - 단순 검색바 = 첫 절 (op=null)
 * - [▼ 필터] 클릭 시 두 번째 이후 절 패널 펼침
 * - 활성 조건 2개 이상이면 자동 펼침
 * - URL ?col[]=&q[]=&op[]= multi-value 직렬화
 * - 빈 value 절은 [검색] 시 silent drop
 */
export function ContactsFilterBar({
  surveyId,
  initialClauses,
  columnCandidates,
  resultCodeOptions,
}: Props) {
  // ClauseRowValue.id 는 React key 안정성을 위한 식별자 — URL 의 인덱스가 아니라 행 자체의
  // 생명주기를 따라간다. 매 mount/sync 시 새로 부여하므로 영속 ID 는 아님.
  const toExtraRow = (c: ClientFilterClause, idx: number): ClauseRowValue => ({
    id: `init-${idx}`,
    op: (c.op ?? 'AND') as 'AND' | 'OR',
    source: c.source,
    value: c.value,
  });

  const [firstSource, setFirstSource] = useState<string>(
    initialClauses[0]?.source ?? '',
  );
  const [firstValue, setFirstValue] = useState<string>(initialClauses[0]?.value ?? '');
  const [extraClauses, setExtraClauses] = useState<ClauseRowValue[]>(
    initialClauses.slice(1).map(toExtraRow),
  );
  const [advancedOpen, setAdvancedOpen] = useState(initialClauses.length >= 2);
  const [, startTransition] = useTransition();
  const pushParams = useSearchParamsMutator();

  // 브라우저 뒤로/앞으로 가기 시 동기화.
  useEffect(() => {
    setFirstSource(initialClauses[0]?.source ?? '');
    setFirstValue(initialClauses[0]?.value ?? '');
    setExtraClauses(initialClauses.slice(1).map(toExtraRow));
    setAdvancedOpen(initialClauses.length >= 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialClauses)]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
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
        p.delete('page');
      });
    });
  };

  const addClause = () => {
    if (columnCandidates.length === 0) return;
    const firstCandidate = columnCandidates[0].source;
    // system.web 은 boolean dropdown 의 기본값 'true' 로 초기화 (빈 value 면 silent drop 함정).
    const initialValue = firstCandidate === FILTER_SOURCE.WEB ? 'true' : '';
    const id = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setExtraClauses((cs) => [...cs, { id, op: 'AND', source: firstCandidate, value: initialValue }]);
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
      aria-label="조사 대상 필터"
    >
      <div className="flex items-center gap-2">
        <label htmlFor="contacts-first-source" className="sr-only">
          검색 컬럼
        </label>
        <Select
          value={firstSource}
          onValueChange={(v) => {
            setFirstSource(v);
            // source 변경 시 이전 mode 의 value 는 의미 없음. system.web 은 boolean 기본값 'true'.
            setFirstValue(v === FILTER_SOURCE.WEB ? 'true' : '');
          }}
        >
          <SelectTrigger id="contacts-first-source" className="h-10 w-[180px] shrink-0">
            <SelectValue placeholder="컬럼 선택" />
          </SelectTrigger>
          <SelectContent>
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
        <ValueWidget
          source={firstSource}
          value={firstValue}
          onChange={setFirstValue}
          resultCodeOptions={resultCodeOptions}
          inputId="contacts-first-value"
        />

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
        <Button asChild variant="outline" className="ml-auto h-10">
          <Link href={`/admin/surveys/${surveyId}/operations/contacts/columns`}>
            컬럼 설정
          </Link>
        </Button>
      </div>

      {advancedOpen && (
        <div className="mt-2 rounded border border-dashed border-slate-300 bg-white p-3">
          {extraClauses.map((c, i) => (
            <ClauseRow
              key={c.id}
              clause={c}
              columnCandidates={columnCandidates}
              resultCodeOptions={resultCodeOptions}
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
    </form>
  );
}
