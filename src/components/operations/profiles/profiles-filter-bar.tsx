'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useSearchParamsMutator } from '@/hooks/use-search-params-mutator';

interface Props {
  initialQ: string;
  initialQField: string;
  initialStatus: string;
}

const QFIELD_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'idx', label: '순번' },
  { value: 'ip', label: '접속IP' },
  { value: 'browser', label: '브라우저' },
];

const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'all', label: '전체 상태' },
  { value: 'completed', label: '완료만' },
  { value: 'in_progress', label: '진행중만' },
  { value: 'drop', label: '이탈만' },
  { value: 'screened_out', label: '자격 미달' },
  { value: 'quotaful_out', label: '쿼터마감' },
  { value: 'bad', label: '불량' },
];

/**
 * 응답자 목록 페이지 필터바.
 *
 * - form submit 기반 → 적용 버튼 누르거나 Enter 시 URL 갱신
 * - 검색어가 비면 q 키 자체를 제거 (URL 깔끔)
 * - status='all' / qfield='all' 도 키 제거 (기본값)
 * - 페이지는 1로 reset (필터 변경 시 마지막 페이지에 머무는 거 방지)
 */
export function ProfilesFilterBar({ initialQ, initialQField, initialStatus }: Props) {
  const [q, setQ] = useState(initialQ);
  const [qfield, setQField] = useState(initialQField);
  const [status, setStatus] = useState(initialStatus);
  const pushParams = useSearchParamsMutator();
  const searchParams = useSearchParams();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    pushParams((p) => {
      const trimmed = q.trim();
      if (trimmed) p.set('q', trimmed);
      else p.delete('q');

      if (qfield !== 'all') p.set('qfield', qfield);
      else p.delete('qfield');

      if (status !== 'all') p.set('status', status);
      else p.delete('status');

      p.delete('page'); // 페이지 리셋
    });
  };

  const handleReset = () => {
    setQ('');
    setQField('all');
    setStatus('all');
    pushParams((p) => {
      p.delete('q');
      p.delete('qfield');
      p.delete('status');
      p.delete('page');
    });
  };

  const hasFilters =
    (searchParams?.get('q') ?? '') !== '' ||
    (searchParams?.get('qfield') ?? 'all') !== 'all' ||
    (searchParams?.get('status') ?? 'all') !== 'all';

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="🔍 순번 · 접속IP · 브라우저 검색"
        className="h-9 max-w-[300px] flex-1 rounded border border-slate-200 px-3 text-sm focus:border-blue-400 focus:outline-none"
      />
      <select
        value={qfield}
        onChange={(e) => setQField(e.target.value)}
        className="h-9 rounded border border-slate-200 px-2 text-sm"
        aria-label="검색 항목"
      >
        {QFIELD_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="h-9 rounded border border-slate-200 px-2 text-sm"
        aria-label="상태 필터"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="h-9 rounded bg-blue-600 px-3.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        적용
      </button>
      {hasFilters && (
        <button
          type="button"
          onClick={handleReset}
          className="h-9 rounded border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50"
        >
          필터 초기화
        </button>
      )}
    </form>
  );
}
