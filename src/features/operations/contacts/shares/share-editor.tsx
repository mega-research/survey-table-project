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
import { Button, buttonVariants } from '@/components/ui/button';
import { prepareContactClauseValue } from '@/features/operations/contacts/contacts-filter-bar';
import { ValueWidget } from '@/features/operations/contacts/value-widget';
import {
  FilterBarCore,
  type FilterDraftRow,
  draftRowsToClauses,
  newDraftRowId,
} from '@/features/operations/filters/filter-bar-core';
import { getErrorMessage } from '@/lib/get-error-message';
import { shareCountAfter } from './share-overlap';
import { type ColumnCandidate, FILTER_SOURCE } from '@/lib/operations/filter-shared';
import { compactIdListValue } from '@/lib/operations/id-list-paste';
import type { ContactAssignmentClause, ContactResultCode } from '@/shared/contracts/contacts';
import type {
  FieldworkShareChangeSummary,
  FieldworkShareOverlap,
} from '@/shared/contracts/contacts-io';
import { client } from '@/shared/lib/rpc';

import { sharesHref } from './share-hrefs';
import { ShareSidePanel } from './share-side-panel';

interface Props {
  surveyId: string;
  link: {
    id: string;
    name: string;
    divided: boolean;
    count: number;
    lastClauses: ContactAssignmentClause[] | null;
  };
  columnCandidates: ColumnCandidate[];
  resultCodeOptions: ContactResultCode[];
  displayColumn: { source: string; label: string } | null;
}

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
      value: compactIdListValue(c.source, c.value),
    }));
  }
  const source =
    candidates.find((c) => c.source === FILTER_SOURCE.RESID)?.source ?? candidates[0]?.source ?? '';
  return [{ id: newDraftRowId(), op: 'AND', source, value: '' }];
}

/**
 * 외주 담당 범위 수정 화면 왼쪽 — 컨택원 수정 화면과 같은 손 모양이다(ADR-0035): 조건 줄(FilterBarCore
 * stack) · 디바운스 미리보기 · 확인 창 · 적용. 다른 점은 셋이다.
 *
 * - 적용하면 **이 외주 링크가 볼 수 있는 조사 대상**이 조건 결과와 같아진다(업체에게 보이는 연락처).
 * - 다른 외주 링크에 이미 있는 대상(겹침)은 미리보기에 링크별 인원으로 보이고, 연구원이 가져오기·남겨
 *   두기·같이 맡기기 중 하나를 **골라야** 적용할 수 있다(미리 골라 두지 않는다 — 티켓 04). 겹침이 없으면
 *   묻지 않고 「남겨 두기」로 보낸다: 서버가 적용 순간 조건을 다시 계산하므로 그 사이 다른 연구원이 만든
 *   겹침이 있어도 다른 링크를 건드리지 않고 연락처를 두 업체에 넓히지도 않는 쪽이다.
 * - 「담당 범위 없애기」는 이 링크를 다시 **설문 전체**로 되돌리는 명시 동작이다(0명 범위와 다르다).
 *
 * 컨택원 조건은 열 후보에 없다 — 담당 범위는 컨택원과 다른 층이라 일 나누기로 업체 접근을 고르지 않는다.
 */
export function ShareEditor({
  surveyId,
  link,
  columnCandidates,
  resultCodeOptions,
  displayColumn,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<FilterDraftRow[]>(() =>
    initialRows(link.lastClauses, columnCandidates),
  );
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [overlapChoice, setOverlapChoice] = useState<FieldworkShareOverlap | null>(null);
  const [isPending, startTransition] = useTransition();

  // 값 변환(저장 목록 토큰)은 같은 값이면 한 번만 — 디바운스마다 목록을 새로 저장하지 않는다.
  const prepareCache = useRef(new Map<string, Promise<string>>());
  const prepareCached = (source: string, value: string): Promise<string> => {
    const key = `${source}\u0000${value}`;
    let hit = prepareCache.current.get(key);
    if (!hit) {
      hit = prepareContactClauseValue(surveyId, source, compactIdListValue(source, value));
      prepareCache.current.set(key, hit);
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
    queryKey: ['fieldwork-share-preview', surveyId, link.id, readyClauses],
    queryFn: () =>
      client.contacts.fieldworkShares.preview({
        surveyId,
        linkId: link.id,
        clauses: readyClauses ?? [],
      }),
    enabled: readyClauses != null && readyClauses.length > 0,
    placeholderData: keepPreviousData,
  });
  const summary: FieldworkShareChangeSummary | undefined =
    draft.length > 0 && readyClauses ? previewQuery.data : undefined;
  const previewError =
    prepareError ?? (previewQuery.isError ? getErrorMessage(previewQuery.error, '') : null);
  const settling = draft.length > 0 && (current == null || previewQuery.isFetching);
  const hasOverlap = summary != null && summary.overlap > 0;
  // 겹침이 없으면 묻지 않는다 — 머리 주석의 「남겨 두기로 보낸다」.
  const effectiveOverlap: FieldworkShareOverlap | null = hasOverlap ? overlapChoice : 'keep';

  const refreshAfterWrite = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['fieldwork-share-preview', surveyId, link.id],
    });
    await queryClient.invalidateQueries({
      queryKey: ['fieldwork-share-matches', surveyId, link.id],
    });
    router.refresh();
  };

  const runApply = () => {
    if (!readyClauses || !effectiveOverlap) return;
    const overlap = effectiveOverlap;
    const sentValues = new Map(rows.map((r) => [r.id, r.value]));
    startTransition(async () => {
      try {
        const result = await client.contacts.fieldworkShares.apply({
          surveyId,
          linkId: link.id,
          clauses: readyClauses,
          overlap,
        });
        setConfirmOpen(false);
        setRows((prev) =>
          prev.map((r) =>
            sentValues.get(r.id) === r.value
              ? { ...r, value: compactIdListValue(r.source, r.value) }
              : r,
          ),
        );
        toast.success(
          `담당 범위를 적용했습니다 — ${link.name} ${fmt(result.after)}명 (새로 ${fmt(result.incoming)}${result.overlap > 0 ? ` · ${OVERLAP_LABEL[result.overlapChoice]} ${fmt(result.overlap)}` : ''} · 빠짐 ${fmt(result.leaving)})`,
        );
        await refreshAfterWrite();
      } catch (err) {
        toast.error(getErrorMessage(err, '담당 범위를 적용하지 못했습니다.'));
      }
    });
  };

  const runClear = () => {
    startTransition(async () => {
      try {
        const { released } = await client.contacts.fieldworkShares.clear({
          surveyId,
          linkId: link.id,
        });
        setClearOpen(false);
        toast.success(
          `담당 범위를 없앴습니다 — ${link.name}은(는) 이제 설문 전체를 봅니다${released > 0 ? ` (풀린 대상 ${fmt(released)}명)` : ''}.`,
        );
        await refreshAfterWrite();
      } catch (err) {
        toast.error(getErrorMessage(err, '담당 범위를 없애지 못했습니다.'));
      }
    });
  };

  const focusedRow = rows.find((r) => r.id === focusedRowId) ?? rows[0] ?? null;
  const setFocusedValue = (value: string) => {
    if (!focusedRow) return;
    setRows(rows.map((r) => (r.id === focusedRow.id ? { ...r, value } : r)));
  };

  const canApply =
    draft.length > 0 &&
    summary != null &&
    effectiveOverlap != null &&
    !settling &&
    previewError == null &&
    !isPending;

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="rounded-lg border bg-white">
        <div className="grid grid-cols-[180px_1fr] border-b">
          <div className="px-4 py-4 text-sm font-medium text-slate-700">지금 범위</div>
          <div className="px-4 py-4 text-sm text-slate-700">
            {link.divided ? (
              <>나눔 · {fmt(link.count)}명</>
            ) : (
              <span className="text-slate-500">
                설문 전체 — 아직 나누지 않아 이 링크로 들어온 외주는 모든 조사 대상을 봅니다.
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[180px_1fr] border-b">
          <div className="px-4 py-4">
            <div className="text-sm font-medium text-slate-700">맡길 대상</div>
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
              ariaLabel="맡길 대상 조건"
              defaultValueForSource={(source) => (source === FILTER_SOURCE.WEB ? 'completed' : '')}
              renderValueWidget={({ source, value, onChange, inputId }) => (
                <div className="min-w-0 flex-1">
                  <ValueWidget
                    source={source}
                    value={value}
                    onChange={onChange}
                    resultCodeOptions={resultCodeOptions}
                    assignmentOptions={[]}
                    surveyId={surveyId}
                    idListAutoGrow
                    idListCompact
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
                  summary={summary}
                />
              }
            />
          </div>
        </div>

        {hasOverlap && summary && (
          <OverlapChoice summary={summary} value={overlapChoice} onChange={setOverlapChoice} />
        )}

        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link
              href={sharesHref(surveyId)}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              목록
            </Link>
            {link.divided && (
              <button
                type="button"
                className="text-sm text-red-600 hover:text-red-700"
                onClick={() => setClearOpen(true)}
              >
                담당 범위 없애기
              </button>
            )}
          </div>
          <Button onClick={() => setConfirmOpen(true)} disabled={!canApply}>
            범위 적용
          </Button>
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{link.name}의 담당 범위를 조건 결과로 바꿉니다</AlertDialogTitle>
              <AlertDialogDescription render={<div />}>
                {summary && effectiveOverlap ? (
                  <ApplySummary name={link.name} summary={summary} overlap={effectiveOverlap} />
                ) : (
                  <span />
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction disabled={isPending} onClick={runApply}>
                범위 적용
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{link.name}의 담당 범위를 없앱니다</AlertDialogTitle>
              <AlertDialogDescription>
                {`지금 범위 ${fmt(link.count)}명이 풀리고, 이 링크로 들어온 외주는 다시 설문 전체의 조사 대상을 봅니다. 다른 업체에도 링크를 건넸다면 그 업체 대상의 연락처까지 보입니다.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                disabled={isPending}
                onClick={runClear}
                className="bg-red-600 hover:bg-red-700"
              >
                범위 없애기
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <ShareSidePanel
        surveyId={surveyId}
        link={{ id: link.id, name: link.name }}
        focused={focusedRow ? { source: focusedRow.source, value: focusedRow.value } : null}
        onFocusedValueChange={setFocusedValue}
        clauses={draft.length > 0 ? readyClauses : null}
        columnCandidates={columnCandidates}
        displayColumn={displayColumn}
      />
    </div>
  );
}

const OVERLAP_LABEL: Record<FieldworkShareOverlap, string> = {
  take: '가져옴',
  keep: '남겨 둠',
  joint: '같이 맡김',
};

const OVERLAP_OPTIONS: Array<{ value: FieldworkShareOverlap; title: string; help: string }> = [
  { value: 'take', title: '가져오기', help: '원래 링크에서 빼고 이 링크로 옮깁니다' },
  { value: 'keep', title: '남겨 두기', help: '원래 링크에 두고 이 링크에는 넣지 않습니다' },
  {
    value: 'joint',
    title: '같이 맡기기',
    help: '두 링크 모두에 둡니다 — 두 업체가 같은 연락처를 봅니다',
  },
];

function othersText(summary: FieldworkShareChangeSummary): string {
  return summary.fromOthers.map((o) => `${o.name} ${fmt(o.count)}`).join(' · ');
}

/** 겹침 처리 고르기 — 겹침이 있을 때만 그린다. 미리 골라 두지 않는다(필수 선택). */
function OverlapChoice({
  summary,
  value,
  onChange,
}: {
  summary: FieldworkShareChangeSummary;
  value: FieldworkShareOverlap | null;
  onChange: (v: FieldworkShareOverlap) => void;
}) {
  const legend = `겹치는 대상 ${fmt(summary.overlap)}명`;
  return (
    <div className="grid grid-cols-[180px_1fr] border-b">
      <div className="px-4 py-4">
        <div className="text-sm font-medium text-slate-700">{legend}</div>
        <p className="mt-1 text-xs text-slate-500">
          다른 외주 링크에 이미 있는 대상입니다 ({othersText(summary)}).
        </p>
      </div>
      <fieldset role="radiogroup" aria-label={legend} className="space-y-2 px-4 py-4">
        {OVERLAP_OPTIONS.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-2 text-sm text-slate-700"
          >
            <input
              type="radio"
              name="fieldwork-share-overlap"
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">{o.title}</span>
              <span className="ml-2 text-slate-500">{o.help}</span>
            </span>
          </label>
        ))}
        {value == null && (
          <p className="text-xs text-orange-600">
            겹치는 대상을 어떻게 할지 골라야 적용할 수 있습니다.
          </p>
        )}
      </fieldset>
    </div>
  );
}

function MatchedCount({
  empty,
  settling,
  error,
  summary,
}: {
  empty: boolean;
  settling: boolean;
  error: string | null;
  summary: FieldworkShareChangeSummary | undefined;
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
        {summary === undefined ? '…' : `${fmt(summary.matched)}명`}
      </strong>
      {summary && summary.fromOthers.length > 0 && (
        <span className="ml-2 text-orange-600">
          {summary.fromOthers.map((o) => `${o.name} 링크에 이미 ${fmt(o.count)}명`).join(' · ')}
        </span>
      )}
    </span>
  );
}

function ApplySummary({
  name,
  summary,
  overlap,
}: {
  name: string;
  summary: FieldworkShareChangeSummary;
  overlap: FieldworkShareOverlap;
}) {
  const after = shareCountAfter(summary, overlap);
  const others = summary.overlap > 0 ? ` (${othersText(summary)})` : '';
  return (
    <div className="space-y-2 text-sm text-slate-600">
      <p>
        {name} {fmt(summary.current)}명 → {fmt(after)}명. 적용하는 순간 조건을 다시 계산합니다.
      </p>
      <ul className="space-y-1 rounded bg-slate-50 px-3 py-2">
        <li>새로 들어옴 {fmt(summary.incoming)}명 (어느 링크에도 없던 대상)</li>
        {summary.overlap > 0 && overlap === 'take' && (
          <li>
            다른 링크에서 가져옴 {fmt(summary.overlap)}명{others}
          </li>
        )}
        {summary.overlap > 0 && overlap === 'keep' && (
          <li>
            남겨 둠 {fmt(summary.overlap)}명{others} — 원래 링크에 두고 이쪽에 넣지 않습니다
          </li>
        )}
        {summary.overlap > 0 && overlap === 'joint' && (
          <li>
            같이 맡김 {fmt(summary.overlap)}명{others} — 두 링크의 외주 화면에 모두 보입니다
          </li>
        )}
        <li>빠짐 {fmt(summary.leaving)}명 (이 링크에서 더는 보이지 않습니다)</li>
      </ul>
      {summary.overlap > 0 && overlap === 'take' && (
        <p className="text-xs text-slate-500">
          가져온 대상은 원래 링크의 외주 화면에서 사라집니다. 회차·수정 기록은 대상에 남습니다.
        </p>
      )}
    </div>
  );
}
