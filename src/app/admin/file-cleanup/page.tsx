'use client';

import { useState } from 'react';

import Link from 'next/link';

import { ArrowLeft, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  useCancelDeletion,
  useDeletionHistory,
  useDeletionPending,
  type FileCleanupHistoryStatus,
} from '@/hooks/queries';
import { formatLocalDateTime } from '@/lib/date-formatters';
import { cn } from '@/lib/utils';

/** 상태 한국어 라벨 + 톤. 미지의 상태는 raw 값으로 폴백. */
const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  pending: { label: '대기', tone: 'bg-amber-100 text-amber-700' },
  cancelled: { label: '취소됨', tone: 'bg-blue-100 text-blue-700' },
  kept: { label: '보존됨', tone: 'bg-emerald-100 text-emerald-700' },
  deleted: { label: '삭제됨', tone: 'bg-slate-100 text-slate-600' },
  failed: { label: '실패', tone: 'bg-rose-100 text-rose-700' },
};

/** 수집원 한국어 라벨. 미지의 수집원은 raw 값으로 폴백. */
const SOURCE_LABEL: Record<string, string> = {
  'survey-delete': '설문 삭제',
  'question-delete': '질문 삭제',
  'library-delete': '보관함 삭제',
  'template-delete': '템플릿 삭제',
  'save-diff': '저장 정리',
  'version-prune': '버전 정리',
};

const HISTORY_FILTERS: { value: FileCleanupHistoryStatus | undefined; label: string }[] = [
  { value: undefined, label: '전체' },
  { value: 'cancelled', label: '취소됨' },
  { value: 'kept', label: '보존됨' },
  { value: 'deleted', label: '삭제됨' },
  { value: 'failed', label: '실패' },
];

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, tone: 'bg-slate-100 text-slate-600' };
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        s.tone,
      )}
    >
      {s.label}
    </span>
  );
}

function KeyCell({ objectKey }: { objectKey: string }) {
  return (
    <span
      className="block max-w-[320px] truncate font-mono text-xs text-gray-700"
      title={objectKey}
    >
      {objectKey}
    </span>
  );
}

/** 테이블 공통 안내 행 (로딩·에러·빈 목록). */
function NoticeRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-gray-400">
        {children}
      </td>
    </tr>
  );
}

export default function FileCleanupPage() {
  const [historyStatus, setHistoryStatus] = useState<FileCleanupHistoryStatus | undefined>(
    undefined,
  );
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const pendingQuery = useDeletionPending();
  const historyQuery = useDeletionHistory(historyStatus);
  const { mutate: cancelCandidate } = useCancelDeletion();

  const pending = pendingQuery.data ?? [];
  const history = historyQuery.data ?? [];

  const handleCancel = (id: string) => {
    if (cancellingId !== null) return;
    setCancellingId(id);
    cancelCandidate(id, {
      onSuccess: (ok) => {
        if (ok) toast.success('삭제 예약을 취소했습니다');
        else toast.error('이미 처리된 후보라 취소할 수 없습니다');
      },
      onError: () => toast.error('취소 요청에 실패했습니다'),
      onSettled: () => setCancellingId(null),
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-4">
          <Link href="/admin/surveys">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              설문 관리
            </Button>
          </Link>
          <div className="h-6 w-px bg-gray-300" />
          <div className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-blue-500" />
            <h1 className="text-lg font-medium text-gray-900">파일 삭제 대기열</h1>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* 삭제 대기 */}
        <Card className="overflow-hidden">
          <header className="border-b border-gray-100 bg-gray-50/60 px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-base font-semibold text-gray-900">삭제 대기</h2>
                <span className="text-sm text-gray-500">
                  {pendingQuery.isLoading ? '' : `${pending.length}건`}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                등록 후 7일 유예를 거쳐 자동 집행됩니다. 유예 중에는 취소할 수 있습니다.
              </p>
            </div>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-white text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
                  <th className="px-3 py-2.5">키</th>
                  <th className="px-3 py-2.5">수집원</th>
                  <th className="px-3 py-2.5">사유</th>
                  <th className="px-3 py-2.5">등록일</th>
                  <th className="px-3 py-2.5">집행 예정일</th>
                  <th className="px-3 py-2.5 text-right">동작</th>
                </tr>
              </thead>
              <tbody>
                {pendingQuery.isLoading ? (
                  <NoticeRow colSpan={6}>
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-300" />
                  </NoticeRow>
                ) : pendingQuery.error ? (
                  <NoticeRow colSpan={6}>대기 목록을 불러올 수 없습니다.</NoticeRow>
                ) : pending.length === 0 ? (
                  <NoticeRow colSpan={6}>삭제 대기 중인 파일이 없습니다.</NoticeRow>
                ) : (
                  pending.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-gray-50 last:border-b-0 hover:bg-gray-50/40"
                    >
                      <td className="px-3 py-2.5">
                        <KeyCell objectKey={row.key} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                        {SOURCE_LABEL[row.source] ?? row.source}
                      </td>
                      <td className="max-w-[280px] truncate px-3 py-2.5 text-gray-600" title={row.reason ?? undefined}>
                        {row.reason ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-600">
                        {formatLocalDateTime(row.registeredAt)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-600">
                        {formatLocalDateTime(row.executeAfter)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={cancellingId !== null}
                          onClick={() => handleCancel(row.id)}
                        >
                          {cancellingId === row.id ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <X className="mr-1 h-3.5 w-3.5" />
                          )}
                          취소
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* 집행 이력 */}
        <Card className="overflow-hidden">
          <header className="border-b border-gray-100 bg-gray-50/60 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-base font-semibold text-gray-900">집행 이력</h2>
                <span className="text-sm text-gray-500">
                  {historyQuery.isLoading ? '' : `${history.length}건`}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {HISTORY_FILTERS.map((f) => (
                  <button
                    key={f.label}
                    type="button"
                    onClick={() => setHistoryStatus(f.value)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      historyStatus === f.value
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-white text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
                  <th className="px-3 py-2.5">키</th>
                  <th className="px-3 py-2.5">수집원</th>
                  <th className="px-3 py-2.5">상태</th>
                  <th className="px-3 py-2.5">결과 메모</th>
                  <th className="px-3 py-2.5">처리 시각</th>
                </tr>
              </thead>
              <tbody>
                {historyQuery.isLoading ? (
                  <NoticeRow colSpan={5}>
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-300" />
                  </NoticeRow>
                ) : historyQuery.error ? (
                  <NoticeRow colSpan={5}>이력을 불러올 수 없습니다.</NoticeRow>
                ) : history.length === 0 ? (
                  <NoticeRow colSpan={5}>표시할 이력이 없습니다.</NoticeRow>
                ) : (
                  history.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-gray-50 last:border-b-0 hover:bg-gray-50/40"
                    >
                      <td className="px-3 py-2.5">
                        <KeyCell objectKey={row.key} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                        {SOURCE_LABEL[row.source] ?? row.source}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="max-w-[320px] truncate px-3 py-2.5 text-gray-600" title={row.resultNote ?? undefined}>
                        {row.resultNote ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-600">
                        {formatLocalDateTime(row.resolvedAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </main>
    </div>
  );
}
