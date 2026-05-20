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

import { ClauseRow, type ClauseRowValue } from './clause-row';
import { ValueWidget } from './value-widget';

interface ColumnCandidate {
  source: string;
  label: string;
}

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
 * 조사 대상 다중 조건 필터.
 *
 * - 단순 검색바 = 첫 절 (op=null)
 * - [▼ 다중 조건] 클릭 시 두 번째 이후 절 패널 펼침
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
  const [firstSource, setFirstSource] = useState<string>(
    initialClauses[0]?.source ?? '',
  );
  const [firstValue, setFirstValue] = useState<string>(initialClauses[0]?.value ?? '');
  const [extraClauses, setExtraClauses] = useState<ClauseRowValue[]>(
    initialClauses.slice(1).map((c) => ({
      op: (c.op ?? 'AND') as 'AND' | 'OR',
      source: c.source,
      value: c.value,
    })),
  );
  const [advancedOpen, setAdvancedOpen] = useState(initialClauses.length >= 2);
  const [, startTransition] = useTransition();
  const pushParams = useSearchParamsMutator();

  // 브라우저 뒤로/앞으로 가기 시 동기화.
  useEffect(() => {
    setFirstSource(initialClauses[0]?.source ?? '');
    setFirstValue(initialClauses[0]?.value ?? '');
    setExtraClauses(
      initialClauses.slice(1).map((c) => ({
        op: (c.op ?? 'AND') as 'AND' | 'OR',
        source: c.source,
        value: c.value,
      })),
    );
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
    const firstCandidate = columnCandidates[0]?.source ?? '';
    setExtraClauses((cs) => [...cs, { op: 'AND', source: firstCandidate, value: '' }]);
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
        <Select value={firstSource} onValueChange={(v) => setFirstSource(v)}>
          <SelectTrigger id="contacts-first-source" className="h-10 w-[180px] shrink-0">
            <SelectValue placeholder="컬럼 선택" />
          </SelectTrigger>
          <SelectContent>
            {columnCandidates.map((c) => (
              <SelectItem key={c.source} value={c.source}>
                {c.label}
                {c.source.startsWith('pii.') && (
                  <span className="ml-1 text-xs text-muted-foreground">(정확 일치)</span>
                )}
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
          className="h-10"
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          {advancedOpen ? '▲' : '▼'} 다중 조건
          {extraClauses.length > 0 && (
            <Badge variant="secondary" className="ml-2">
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
              key={i}
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
