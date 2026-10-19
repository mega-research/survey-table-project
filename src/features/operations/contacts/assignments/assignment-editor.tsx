'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { prepareContactClauseValue } from '@/features/operations/contacts/contacts-filter-bar';
import { ValueWidget } from '@/features/operations/contacts/value-widget';
import {
  FilterBarCore,
  type FilterDraftRow,
  draftRowsToClauses,
  newDraftRowId,
} from '@/features/operations/filters/filter-bar-core';
import { getErrorMessage } from '@/lib/get-error-message';
import { type ColumnCandidate, FILTER_SOURCE } from '@/lib/operations/filter-shared';
import type { ContactAssignmentClause, ContactResultCode } from '@/shared/contracts/contacts';
import type { ContactAssignmentOption } from '@/shared/contracts/contacts-io';
import { client } from '@/shared/lib/rpc';

import { assignmentsHref } from './assignment-hrefs';
import { AssignmentSidePanel } from './assignment-side-panel';

interface Props {
  surveyId: string;
  assignment: { id: string; name: string; lastClauses: ContactAssignmentClause[] | null };
  columnCandidates: ColumnCandidate[];
  resultCodeOptions: ContactResultCode[];
  assignmentOptions: ContactAssignmentOption[];
  /** 오른쪽 대상 목록 두 번째 열 — 스킴의 표시 첫 attrs 열. */
  displayColumn: { source: string; label: string } | null;
}

type Summary = Awaited<ReturnType<typeof client.contacts.assignments.preview>>;

const fmt = (n: number) => n.toLocaleString('ko-KR');
const PREVIEW_DEBOUNCE_MS = 400;

function initialRows(
  lastClauses: ContactAssignmentClause[] | null,
  candidates: ColumnCandidate[],
): FilterDraftRow[] {
  if (lastClauses && lastClauses.length > 0) {
    return lastClauses.map((c, i) => ({
      id: `init-${i}`,
      op: c.op === 'OR' ? 'OR' : 'AND',
      source: c.source,
      value: c.value,
    }));
  }
  const source =
    candidates.find((c) => c.source === FILTER_SOURCE.RESID)?.source ?? candidates[0]?.source ?? '';
  return [{ id: newDraftRowId(), op: 'AND', source, value: '' }];
}

/**
 * 컨택원 수정 화면 왼쪽 (시안 C) — 이름과 「배정할 대상」 조건, 교체 적용.
 *
 * 조건 줄은 조사 대상 필터와 같은 부품(FilterBarCore stack)이라 같은 문법이 같은 결과를 낸다.
 * 조건이 바뀔 때마다(디바운스) 서버에 인원을 다시 묻고, 2,000개 넘는 ID 목록은 검색바와 같은
 * 저장 목록 토큰 경로를 탄다. 적용은 서버가 적용 시점에 조건을 다시 평가한 실제 결과를 돌려준다.
 */
export function AssignmentEditor({
  surveyId,
  assignment,
  columnCandidates,
  resultCodeOptions,
  assignmentOptions,
  displayColumn,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(assignment.name);
  const [savedName, setSavedName] = useState(assignment.name);
  const [rows, setRows] = useState<FilterDraftRow[]>(() =>
    initialRows(assignment.lastClauses, columnCandidates),
  );
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // 값 변환(저장 목록 토큰)은 같은 값이면 한 번만 — 디바운스마다 목록을 새로 저장하지 않는다.
  const prepareCache = useRef(new Map<string, Promise<string>>());
  const prepareCached = (source: string, value: string): Promise<string> => {
    const key = `${source}\u0000${value}`;
    let hit = prepareCache.current.get(key);
    if (!hit) {
      hit = prepareContactClauseValue(surveyId, source, value);
      prepareCache.current.set(key, hit);
      // 실패한 변환은 다시 시도할 수 있게 캐시에서 뺀다.
      hit.catch(() => prepareCache.current.delete(key));
    }
    return hit;
  };

  const draft = draftRowsToClauses(rows);
  const draftKey = JSON.stringify(draft);
  const [prepared, setPrepared] = useState<
    { key: string; clauses: ContactAssignmentClause[] } | { key: string; error: string } | null
  >(null);

  useEffect(() => {
    const pending: ContactAssignmentClause[] = JSON.parse(draftKey);
    if (pending.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      Promise.all(
        pending.map(async (c) => ({ ...c, value: await prepareCached(c.source, c.value) })),
      )
        .then((clauses) => {
          if (!cancelled) setPrepared({ key: draftKey, clauses });
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setPrepared({
              key: draftKey,
              error: getErrorMessage(err, '조건을 해석할 수 없습니다.'),
            });
          }
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // prepareCached 는 ref 만 읽는다 — 조건 문자열이 바뀔 때만 다시 준비한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const current = prepared && prepared.key === draftKey ? prepared : null;
  const readyClauses = current && 'clauses' in current ? current.clauses : null;
  const prepareError = current && 'error' in current ? current.error : null;

  const previewQuery = useQuery({
    queryKey: ['contact-assignment-preview', surveyId, assignment.id, readyClauses],
    queryFn: () =>
      client.contacts.assignments.preview({
        surveyId,
        assignmentId: assignment.id,
        clauses: readyClauses ?? [],
      }),
    enabled: readyClauses != null && readyClauses.length > 0,
    placeholderData: keepPreviousData,
  });
  const summary: Summary | undefined =
    draft.length > 0 && readyClauses ? previewQuery.data : undefined;
  const previewError =
    prepareError ?? (previewQuery.isError ? getErrorMessage(previewQuery.error, '') : null);
  const settling = draft.length > 0 && (current == null || previewQuery.isFetching);

  const saveName = () => {
    const next = name.trim();
    if (next.length === 0) {
      setName(savedName);
      return;
    }
    if (next === savedName) return;
    startTransition(async () => {
      try {
        await client.contacts.assignments.rename({ surveyId, id: assignment.id, name: next });
        setSavedName(next);
        setName(next);
        toast.success('이름을 바꿨습니다.');
        router.refresh();
      } catch (err) {
        setName(savedName);
        toast.error(getErrorMessage(err, '이름을 바꾸지 못했습니다.'));
      }
    });
  };

  const runApply = () => {
    if (!readyClauses) return;
    startTransition(async () => {
      try {
        const result = await client.contacts.assignments.apply({
          surveyId,
          assignmentId: assignment.id,
          clauses: readyClauses,
        });
        setConfirmOpen(false);
        toast.success(
          `배정 적용했습니다 — ${savedName} ${fmt(result.matched)}명 (새로 ${fmt(result.incoming)} · 다른 컨택원에서 ${fmt(sumOthers(result))} · 빠짐 ${fmt(result.leaving)})`,
        );
        await queryClient.invalidateQueries({
          queryKey: ['contact-assignment-preview', surveyId, assignment.id],
        });
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err, '배정 적용에 실패했습니다.'));
      }
    });
  };

  const runRemove = () => {
    startTransition(async () => {
      try {
        const { unassigned } = await client.contacts.assignments.remove({
          surveyId,
          id: assignment.id,
        });
        toast.success(
          unassigned > 0
            ? `컨택원을 지웠습니다. ${fmt(unassigned)}명이 배정 없음이 됐습니다.`
            : '컨택원을 지웠습니다.',
        );
        router.push(assignmentsHref(surveyId));
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err, '컨택원을 지우지 못했습니다.'));
      }
    });
  };

  // 오른쪽 패널이 따라가는 줄 — 고른 줄이 지워졌으면 첫 줄.
  const focusedRow = rows.find((r) => r.id === focusedRowId) ?? rows[0] ?? null;
  const setFocusedValue = (value: string) => {
    if (!focusedRow) return;
    setRows(rows.map((r) => (r.id === focusedRow.id ? { ...r, value } : r)));
  };

  const canApply =
    draft.length > 0 && summary != null && !settling && previewError == null && !isPending;

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="rounded-lg border bg-white">
        <div className="grid grid-cols-[180px_1fr] border-b">
          <label htmlFor="assignment-name" className="px-4 py-4 text-sm font-medium text-slate-700">
            컨택원 이름
          </label>
          <div className="px-4 py-3">
            <Input
              id="assignment-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              className="h-10 max-w-[420px]"
            />
          </div>
        </div>

        <div className="grid grid-cols-[180px_1fr] border-b">
          <div className="px-4 py-4">
            <div className="text-sm font-medium text-slate-700">배정할 대상</div>
            <p className="mt-1 text-xs text-slate-500">조사 대상 목록 필터와 같은 조건입니다.</p>
          </div>
          <div className="px-4 py-3">
            <FilterBarCore
              as="div"
              variant="stack"
              rows={rows}
              onRowsChange={setRows}
              onRowFocus={setFocusedRowId}
              columnCandidates={columnCandidates}
              ariaLabel="배정할 대상 조건"
              defaultValueForSource={(source) => (source === FILTER_SOURCE.WEB ? 'completed' : '')}
              renderValueWidget={({ source, value, onChange, inputId }) => (
                <div className="min-w-0 flex-1">
                  <ValueWidget
                    source={source}
                    value={value}
                    onChange={onChange}
                    resultCodeOptions={resultCodeOptions}
                    assignmentOptions={assignmentOptions}
                    surveyId={surveyId}
                    idListAutoGrow
                  emptyToggles
                    {...(inputId !== undefined ? { inputId } : {})}
                  />
                </div>
              )}
              stackFooter={
                <MatchedCount
                  empty={draft.length === 0}
                  settling={settling}
                  error={previewError}
                  matched={summary?.matched}
                />
              }
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" size="sm">
              <Link href={assignmentsHref(surveyId)}>목록</Link>
            </Button>
            <button
              type="button"
              className="text-sm text-red-600 hover:text-red-700"
              onClick={() => setRemoveOpen(true)}
            >
              컨택원 삭제
            </button>
          </div>
          <Button onClick={() => setConfirmOpen(true)} disabled={!canApply}>
            배정 적용
          </Button>
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{savedName}의 배정을 조건 결과로 바꿉니다</AlertDialogTitle>
              <AlertDialogDescription asChild>
                {summary ? <ApplySummary name={savedName} summary={summary} /> : <span />}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction disabled={isPending} onClick={runApply}>
                배정 적용
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>컨택원 {savedName}을(를) 지웁니다</AlertDialogTitle>
              <AlertDialogDescription>
                {summary && summary.current > 0
                  ? `배정된 ${fmt(summary.current)}명이 배정 없음이 됩니다. 되돌릴 수 없습니다.`
                  : '배정된 대상은 배정 없음이 됩니다. 되돌릴 수 없습니다.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                disabled={isPending}
                onClick={runRemove}
                className="bg-red-600 hover:bg-red-700"
              >
                삭제
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <AssignmentSidePanel
        surveyId={surveyId}
        assignment={{ id: assignment.id, name: savedName }}
        focused={focusedRow ? { source: focusedRow.source, value: focusedRow.value } : null}
        onFocusedValueChange={setFocusedValue}
        clauses={draft.length > 0 ? readyClauses : null}
        columnCandidates={columnCandidates}
        displayColumn={displayColumn}
        otherOwnerNames={summary?.fromOthers.map((o) => o.name) ?? []}
      />
    </div>
  );
}

function sumOthers(summary: Summary): number {
  return summary.fromOthers.reduce((n, o) => n + o.count, 0);
}

function MatchedCount({
  empty,
  settling,
  error,
  matched,
}: {
  empty: boolean;
  settling: boolean;
  error: string | null;
  matched: number | undefined;
}) {
  if (empty) {
    return (
      <span className="text-sm text-slate-500">조건을 하나 이상 넣어야 적용할 수 있습니다</span>
    );
  }
  if (error) {
    return (
      <span role="alert" className="text-sm text-red-600">
        {error}
      </span>
    );
  }
  return (
    <span className="text-sm text-slate-600" aria-live="polite">
      조건에 맞는 대상{' '}
      <strong className={`text-base text-blue-600 ${settling ? 'opacity-50' : ''}`}>
        {matched === undefined ? '…' : `${fmt(matched)}명`}
      </strong>
    </span>
  );
}

function ApplySummary({ name, summary }: { name: string; summary: Summary }) {
  const others = sumOthers(summary);
  return (
    <div className="space-y-2 text-sm text-slate-600">
      <p>
        {name} {fmt(summary.current)}명 → {fmt(summary.matched)}명. 적용하는 순간 조건을 다시
        계산합니다.
      </p>
      <ul className="space-y-1 rounded bg-slate-50 px-3 py-2">
        <li>새로 들어옴 {fmt(summary.incoming)}명 (배정 없음에서)</li>
        <li>
          다른 컨택원에서 옮겨 옴 {fmt(others)}명
          {summary.fromOthers.length > 0
            ? ` (${summary.fromOthers.map((o) => `${o.name} ${fmt(o.count)}`).join(' · ')})`
            : ''}
        </li>
        <li>빠짐 {fmt(summary.leaving)}명 (배정 없음이 됩니다)</li>
      </ul>
      {summary.leaving > 0 && (
        <p className="text-xs text-slate-500">
          손으로 옮겨 둔 대상도 조건 밖이면 빠집니다 — 교체는 이 컨택원의 배정을 조건 결과와 똑같이
          만듭니다.
        </p>
      )}
    </div>
  );
}
