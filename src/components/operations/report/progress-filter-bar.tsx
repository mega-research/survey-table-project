'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSearchParamsMutator } from '@/hooks/use-search-params-mutator';

interface ColumnCandidate {
  source: string;
  label: string;
}

interface Props {
  surveyId: string;
  initialSource: string | null;
  initialValue: string;
  columnCandidates: ColumnCandidate[];
}

function placeholderFor(source: string | null): string {
  if (!source) return '검색어';
  if (source === 'system.resid') return '예: 1-30, 45';
  if (source.startsWith('pii.')) return '정확한 값 입력 (부분 검색 불가)';
  return '부분일치';
}

/**
 * 진척 보고 단일 검색바.
 *
 * - 컬럼 select + 값 input + [검색] + [컬럼 설정] 한 줄
 * - 한 번에 한 컬럼만 검색 (다중 AND 없음)
 * - URL ?col=&q= 두 파라미터 직렬화
 * - 빈 input + [검색] = 필터 해제 (URL 키 둘 다 삭제)
 * - source 에 따라 input placeholder 자동 변경
 *
 * pii.* 컬럼은 백엔드에서 blindIndex 정확 일치 매칭 — 사용자에게는 "(정확 일치)" 마커.
 *
 * 높이는 SelectTrigger 기준 h-10 으로 통일.
 */
export function ProgressFilterBar({
  surveyId,
  initialSource,
  initialValue,
  columnCandidates,
}: Props) {
  const [source, setSource] = useState<string | null>(initialSource);
  const [value, setValue] = useState<string>(initialValue);
  const [, startTransition] = useTransition();
  const pushParams = useSearchParamsMutator();

  // 브라우저 뒤로/앞으로 가기 시 URL 의 col/q 가 바뀌면 Server Component 가 새 initial 을
  // 내려준다. 로컬 state 를 동기화. initialSource/initialValue 는 원시값이라 identity 비교로 충분.
  useEffect(() => {
    setSource(initialSource);
    setValue(initialValue);
  }, [initialSource, initialValue]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    startTransition(() => {
      pushParams((p) => {
        if (!source || trimmed.length === 0) {
          // source 미선택 또는 빈 값 → 필터 해제
          p.delete('col');
          p.delete('q');
        } else {
          p.set('col', source);
          p.set('q', trimmed);
        }
        p.delete('page');
      });
    });
  };

  return (
    <form
      onSubmit={handleSearch}
      className="mb-3 flex items-center gap-2"
      role="search"
      aria-label="진척 보고 필터"
    >
      <label htmlFor="filter-column" className="sr-only">검색 컬럼</label>
      <Select
        value={source ?? ''}
        onValueChange={(v) => setSource(v || null)}
      >
        <SelectTrigger id="filter-column" className="w-[180px] shrink-0">
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

      <label htmlFor="filter-value" className="sr-only">검색어</label>
      <Input
        id="filter-value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholderFor(source)}
        className="h-10 w-[260px] shrink-0"
      />

      <Button
        type="submit"
        className="h-10"
        disabled={
          columnCandidates.length === 0 ||
          (!source && value.trim().length > 0)
        }
      >
        검색
      </Button>
      <Button asChild variant="outline" className="ml-auto h-10">
        <Link href={`/admin/surveys/${surveyId}/operations/report/columns`}>컬럼 설정</Link>
      </Button>
    </form>
  );
}
