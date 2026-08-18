'use client';

import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { STATUS_FILTERS, type StatusFilter } from '@/lib/operations/profiles';
import {
  placeholderFor as sharedPlaceholderFor,
  type ColumnCandidate,
} from '@/lib/operations/filter-shared';

import {
  FilterBarCore,
  type ClientFilterClause,
} from '@/components/operations/filters/filter-bar-core';

interface Props {
  initialClauses: ClientFilterClause[];
  initialStatus: StatusFilter;
  columnCandidates: ColumnCandidate[];
}

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '전체 상태' },
  { value: 'completed', label: '완료만' },
  { value: 'in_progress', label: '진행중만' },
  { value: 'drop', label: '이탈만' },
  { value: 'screened_out', label: '자격 미달' },
  { value: 'quotaful_out', label: '쿼터마감' },
  { value: 'bad', label: '불량' },
];

/** idx/browser 는 응답 전용 placeholder, 그 외는 공유 헬퍼('부분일치'). */
function placeholderFor(source: string): string {
  if (source === 'idx') return '예: 5';
  if (source === 'browser') return '예: Chrome';
  return sharedPlaceholderFor(source || null, '부분일치');
}

/**
 * 응답 내역 필터 — 공용 FilterBarCore(다중 절 AND/OR + 전체 검색)의 응답 전용 wrapper.
 * 상태 select 만 이 페이지 특화 컨트롤로 붙는다 (검색 submit 시 status 파라미터 반영).
 */
export function ProfilesFilterBar({ initialClauses, initialStatus, columnCandidates }: Props) {
  const [status, setStatus] = useState<StatusFilter>(initialStatus);

  // 브라우저 뒤로/앞으로 가기 시 server 가 새 initial 을 내려주면 로컬 state 동기화.
  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  return (
    <FilterBarCore
      initialClauses={initialClauses}
      columnCandidates={columnCandidates}
      ariaLabel="응답 내역 필터"
      renderValueWidget={({ source, value, onChange, inputId }) => (
        <Input
          {...(inputId !== undefined ? { id: inputId } : {})}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholderFor(source)}
          className="w-[260px] h-10"
        />
      )}
      trailing={
        <>
          <label htmlFor="profiles-status-filter" className="sr-only">
            상태 필터
          </label>
          <Select
            value={status}
            onValueChange={(v) => {
              if ((STATUS_FILTERS as readonly string[]).includes(v)) {
                setStatus(v as StatusFilter);
              }
            }}
          >
            <SelectTrigger id="profiles-status-filter" className="h-10 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value="deleted">삭제됨</SelectItem>
            </SelectContent>
          </Select>
        </>
      }
      onSubmitParams={(p) => {
        if (status !== 'all') p.set('status', status);
        else p.delete('status');
      }}
    />
  );
}
