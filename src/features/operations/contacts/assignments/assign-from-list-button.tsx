'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getErrorMessage } from '@/lib/get-error-message';
import type { ContactAssignmentOption } from '@/shared/contracts/contacts-io';
import { client } from '@/shared/lib/rpc';

const NONE_VALUE = '__none__';
const fmt = (n: number) => n.toLocaleString('ko-KR');

type Summary = Awaited<ReturnType<typeof client.contacts.assignments.previewFromList>>;

interface Props {
  surveyId: string;
  /** 지금 걸린 검색 결과 인원 — 버튼 문구 */
  total: number;
  /** 검색바·열 머리 필터 중 하나라도 걸려 있는가 */
  filtered: boolean;
  options: ContactAssignmentOption[];
}

/** 주소의 필터 파라미터 — 서버가 목록 페이지와 같은 해석으로 다시 평가한다. */
function filterFromParams(p: URLSearchParams) {
  return {
    col: p.getAll('col'),
    q: p.getAll('q'),
    op: p.getAll('op'),
    hcol: p.getAll('hcol'),
    hm: p.getAll('hm'),
    hv: p.getAll('hv'),
  };
}

/**
 * 목록에서 배정 (CONTEXT.md 「목록에서 배정」) — 지금 걸린 검색 결과를 컨택원 하나에 얹는다.
 * 고른 컨택원의 기존 배정은 건드리지 않고, 「(배정 없음)」을 고르면 결과의 배정을 푼다.
 * 서버는 적용 시점에 같은 조건을 다시 평가한다.
 */
export function AssignFromListButton({ surveyId, total, filtered, options }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>('');
  const [isPending, startTransition] = useTransition();

  const filter = filterFromParams(new URLSearchParams(searchParams.toString()));
  const assignmentId = target === NONE_VALUE ? null : target;
  const previewQuery = useQuery({
    queryKey: ['contact-assign-from-list', surveyId, target, filter],
    queryFn: () =>
      client.contacts.assignments.previewFromList({ surveyId, assignmentId, filter }),
    enabled: open && target !== '',
  });
  const summary = previewQuery.data;
  const targetName = options.find((o) => o.id === target)?.name ?? '';

  const runApply = () => {
    startTransition(async () => {
      try {
        const result = await client.contacts.assignments.assignFromList({
          surveyId,
          assignmentId,
          filter,
        });
        setOpen(false);
        setTarget('');
        toast.success(
          assignmentId === null
            ? `${fmt(changedCount(result, null))}명의 배정을 풀었습니다.`
            : `${fmt(changedCount(result, assignmentId))}명을 ${targetName}에 배정했습니다.`,
        );
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err, '배정하지 못했습니다.'));
      }
    });
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={total === 0}>
        검색 결과 {fmt(total)}명을 컨택원에 배정
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTarget('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>검색 결과를 컨택원에 배정</DialogTitle>
            <DialogDescription>
              {filtered
                ? `지금 걸린 검색 결과 ${fmt(total)}명을 옮깁니다. 고른 컨택원의 기존 배정은 그대로입니다.`
                : '검색 조건이 없습니다 — 조사 대상 전체가 대상입니다.'}
            </DialogDescription>
          </DialogHeader>
          {!filtered && (
            <p className="rounded bg-amber-50 px-3 py-2 text-center text-lg font-semibold text-amber-800">
              전체 {fmt(total)}명
            </p>
          )}
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger aria-label="배정할 컨택원" className="h-10">
              <SelectValue placeholder="컨택원 고르기" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
              <SelectItem value={NONE_VALUE} className="text-slate-500">
                (배정 없음) — 배정 풀기
              </SelectItem>
            </SelectContent>
          </Select>
          {target !== '' && (
            <div className="min-h-12 text-sm text-slate-700" aria-live="polite">
              {previewQuery.isPending ? (
                <span className="text-slate-400">계산 중…</span>
              ) : summary ? (
                <ListAssignSummaryText
                  summary={summary}
                  assignmentId={assignmentId}
                  targetName={targetName}
                />
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button
              onClick={runApply}
              disabled={target === '' || !summary || isPending || summary.matched === 0}
            >
              {assignmentId === null && target !== '' ? '배정 풀기' : '배정'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 실제로 바뀌는 인원 — 이미 그 컨택원(풀기면 배정 없음)인 대상은 바뀌지 않는다. */
function changedCount(summary: Summary, assignmentId: string | null): number {
  return summary.groups.filter((g) => g.id !== assignmentId).reduce((n, g) => n + g.count, 0);
}

function ListAssignSummaryText({
  summary,
  assignmentId,
  targetName,
}: {
  summary: Summary;
  assignmentId: string | null;
  targetName: string;
}) {
  if (assignmentId === null) {
    const assigned = summary.groups.filter((g) => g.id !== null);
    if (assigned.length === 0) return <p>검색 결과에 배정된 대상이 없습니다.</p>;
    return (
      <p>
        {assigned.map((g) => `${g.name} ${fmt(g.count)}명`).join(' · ')}이 배정 없음이 됩니다.
      </p>
    );
  }
  const moving = changedCount(summary, assignmentId);
  const fromOthers = summary.groups.filter((g) => g.id !== null && g.id !== assignmentId);
  const current = summary.targetCurrent ?? 0;
  return (
    <div className="space-y-1">
      <p className="font-medium">
        {targetName} {fmt(current)}명 → {fmt(current + moving)}명
      </p>
      {fromOthers.length > 0 && (
        <p className="text-slate-600">
          다른 컨택원에서 옮겨 옴 {fmt(fromOthers.reduce((n, g) => n + g.count, 0))}명 (
          {fromOthers.map((g) => `${g.name} ${fmt(g.count)}`).join(' · ')})
        </p>
      )}
    </div>
  );
}
