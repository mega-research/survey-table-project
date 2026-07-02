'use client';

import { useEffect, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSearchParamsMutator } from '@/hooks/use-search-params-mutator';
import { hasActiveFilters, type StatusFilter, type TestFilter } from '@/lib/operations/profiles';
import {
  placeholderFor as sharedPlaceholderFor,
  type ColumnCandidate,
} from '@/lib/operations/filter-shared';

import { PiiExactMarker } from '@/components/operations/filter-pii-marker';

interface Props {
  initialSource: string;
  initialValue: string;
  initialStatus: StatusFilter;
  initialTest: TestFilter;
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

const TEST_OPTIONS: ReadonlyArray<{ value: TestFilter; label: string }> = [
  { value: 'all', label: '테스트 포함' },
  { value: 'exclude', label: '테스트 제외' },
  { value: 'only', label: '테스트만' },
];

/** idx/browser 는 응답 전용 placeholder, 그 외는 공유 헬퍼('부분일치'). */
function placeholderFor(source: string): string {
  if (source === 'idx') return '예: 5';
  if (source === 'browser') return '예: Chrome';
  return sharedPlaceholderFor(source || null, '부분일치');
}

/**
 * 응답 내역 필터바 (진척률 스타일).
 *
 * - 컬럼 select + 값 input + 상태 select + [적용] 한 줄
 * - form submit 으로만 URL 갱신 (적용 버튼 또는 Enter)
 * - URL ?col=&q=&status= 직렬화. 빈 값/기본값은 키 삭제. 필터 변경 시 page 리셋.
 * - 컬럼 미선택 + 검색어 입력 시 [적용] 비활성.
 */
export function ProfilesFilterBar({
  initialSource,
  initialValue,
  initialStatus,
  initialTest,
  columnCandidates,
}: Props) {
  const [source, setSource] = useState(initialSource);
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [test, setTest] = useState<TestFilter>(initialTest);
  const [, startTransition] = useTransition();
  const pushParams = useSearchParamsMutator();
  const searchParams = useSearchParams();

  // 뒤로/앞으로 가기 시 server 가 새 initial 을 내려주면 로컬 state 동기화.
  useEffect(() => {
    queueMicrotask(() => {
      setSource(initialSource);
      setValue(initialValue);
      setStatus(initialStatus);
      setTest(initialTest);
    });
  }, [initialSource, initialValue, initialStatus, initialTest]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    startTransition(() => {
      pushParams((p) => {
        if (!source || trimmed.length === 0) {
          p.delete('col');
          p.delete('q');
        } else {
          p.set('col', source);
          p.set('q', trimmed);
        }
        if (status !== 'all') p.set('status', status);
        else p.delete('status');
        if (test !== 'all') p.set('test', test);
        else p.delete('test');
        p.delete('page');
      });
    });
  };

  const handleReset = () => {
    setSource('');
    setValue('');
    setStatus('all');
    setTest('all');
    startTransition(() => {
      pushParams((p) => {
        p.delete('col');
        p.delete('q');
        p.delete('status');
        p.delete('test');
        p.delete('page');
      });
    });
  };

  const _q = searchParams?.get('q') ?? undefined;
  const _col = searchParams?.get('col') ?? undefined;
  const _status = searchParams?.get('status') ?? undefined;
  const _test = searchParams?.get('test') ?? undefined;
  const showReset = hasActiveFilters({
    ...(_q !== undefined ? { q: _q } : {}),
    ...(_col !== undefined ? { col: _col } : {}),
    ...(_status !== undefined ? { status: _status } : {}),
    ...(_test !== undefined ? { test: _test } : {}),
  });

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-center gap-2"
      role="search"
      aria-label="응답 내역 필터"
    >
      <label htmlFor="profiles-filter-column" className="sr-only">검색 컬럼</label>
      <Select value={source || ''} onValueChange={(v) => setSource(v || '')}>
        <SelectTrigger id="profiles-filter-column" className="w-[160px] shrink-0">
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

      <label htmlFor="profiles-filter-value" className="sr-only">검색어</label>
      <Input
        id="profiles-filter-value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholderFor(source)}
        className="h-10 w-[240px] shrink-0"
      />

      <label htmlFor="profiles-filter-status" className="sr-only">상태 필터</label>
      <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
        <SelectTrigger id="profiles-filter-status" className="w-[140px] shrink-0">
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

      <label htmlFor="profiles-filter-test" className="sr-only">테스트 응답 필터</label>
      <Select value={test} onValueChange={(v) => setTest(v as TestFilter)}>
        <SelectTrigger id="profiles-filter-test" className="w-[140px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TEST_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="submit"
        className="h-10"
        disabled={columnCandidates.length === 0 || (!source && value.trim().length > 0)}
      >
        적용
      </Button>
      {showReset && (
        <Button type="button" variant="outline" className="h-10" onClick={handleReset}>
          필터 초기화
        </Button>
      )}
    </form>
  );
}
