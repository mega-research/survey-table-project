import { useEffect, useRef, useState } from 'react';

import { prepareContactClauseValue } from '@/features/operations/contacts/contacts-filter-bar';
import {
  type FilterDraftRow,
  draftRowsToClauses,
  newDraftRowId,
} from '@/features/operations/filters/filter-bar-core';
import { getErrorMessage } from '@/lib/get-error-message';
import { type ColumnCandidate, FILTER_SOURCE } from '@/lib/operations/filter-shared';
import { compactIdListValue } from './id-list-paste';
import type { ContactAssignmentClause } from '@/shared/contracts/contacts';

/** 조건이 바뀐 뒤 서버에 인원을 다시 묻기까지 기다리는 시간. */
export const CLAUSE_PREVIEW_DEBOUNCE_MS = 400;

/** 저장된 마지막 조건이 있으면 그것으로, 없으면 시스템ID(없으면 첫 열) 빈 줄 하나로 연다. */
export function initialClauseRows(
  lastClauses: ContactAssignmentClause[] | null,
  candidates: ColumnCandidate[],
): FilterDraftRow[] {
  if (lastClauses && lastClauses.length > 0) {
    return lastClauses.map((c, i) => ({
      id: `init-${i}`,
      op: c.op === 'OR' ? 'OR' : 'AND',
      source: c.source,
      // 낱개로 저장된 옛 조건도 열면 정리돼 보인다.
      value: compactIdListValue(c.source, c.value),
    }));
  }
  const source =
    candidates.find((c) => c.source === FILTER_SOURCE.RESID)?.source ?? candidates[0]?.source ?? '';
  return [{ id: newDraftRowId(), op: 'AND', source, value: '' }];
}

/**
 * 조건 편집 화면 왼쪽의 조건 줄 상태 — 컨택원 수정(`assignments/assignment-editor`)과 외주 담당 범위 수정
 * (`shares/share-editor`)이 같은 손 모양이라 한 벌로 둔다(ADR-0035).
 *
 * - 조건 줄은 조사 대상 필터와 같은 부품(FilterBarCore stack)이 그린다 — 같은 문법이 같은 결과를 낸다.
 * - 조건이 바뀌면 디바운스 뒤 서버로 보낼 값을 준비한다. 2,000개 넘는 ID 목록은 검색바와 같은 저장 목록 토큰
 *   경로를 타고, **같은 값이면 한 번만** 준비한다(디바운스마다 목록을 새로 저장하지 않는다). 연속 번호는 준비
 *   전에 구간으로 합친다 — 낱개 2,000개를 넘던 연속 번호도 구간 하나로 접혀 저장 목록을 만들지 않고, 적용 때
 *   보내는 값이 적용 뒤 칸에 남는 합친 값과 같다.
 * - 오른쪽 패널이 따라가는 줄은 마지막으로 고른 줄이고, 그 줄이 지워졌으면 첫 줄이다.
 *
 * 미리보기·적용 RPC 는 화면마다 다르므로 여기 없다 — 화면은 `readyClauses` 로 묻는다.
 */
export function useClauseDraft({
  surveyId,
  lastClauses,
  columnCandidates,
}: {
  surveyId: string;
  lastClauses: ContactAssignmentClause[] | null;
  columnCandidates: ColumnCandidate[];
}) {
  const [rows, setRows] = useState<FilterDraftRow[]>(() =>
    initialClauseRows(lastClauses, columnCandidates),
  );
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);

  const prepareCache = useRef(new Map<string, Promise<string>>());
  const prepareCached = (source: string, value: string): Promise<string> => {
    const key = `${source}\u0000${value}`;
    let hit = prepareCache.current.get(key);
    if (!hit) {
      hit = prepareContactClauseValue(surveyId, source, compactIdListValue(source, value));
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
    }, CLAUSE_PREVIEW_DEBOUNCE_MS);
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

  const focusedRow = rows.find((r) => r.id === focusedRowId) ?? rows[0] ?? null;
  const setFocusedValue = (value: string) => {
    if (!focusedRow) return;
    setRows(rows.map((r) => (r.id === focusedRow.id ? { ...r, value } : r)));
  };

  /** 적용 요청을 보내기 직전의 칸 값 — 적용이 끝나면 `compactSentRows` 에 넘긴다. */
  const snapshotRowValues = () => new Map(rows.map((r) => [r.id, r.value]));
  /**
   * 적용이 끝난 뒤 칸을 보낸 모양(합친 값)으로 바꾼다 — 요청이 도는 사이 사람이 고친 줄은 건드리지 않는다.
   */
  const compactSentRows = (sent: ReadonlyMap<string, string>) =>
    setRows((prev) =>
      prev.map((r) =>
        sent.get(r.id) === r.value ? { ...r, value: compactIdListValue(r.source, r.value) } : r,
      ),
    );

  return {
    rows,
    setRows,
    setFocusedRowId,
    focusedRow,
    setFocusedValue,
    draft,
    readyClauses,
    prepareError,
    /** 조건이 있는데 아직 준비되지 않았다(디바운스·저장 목록 변환 중). */
    preparing: draft.length > 0 && current == null,
    snapshotRowValues,
    compactSentRows,
  };
}
