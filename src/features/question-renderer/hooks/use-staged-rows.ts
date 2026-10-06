import { useCallback, useMemo, useState } from 'react';

import { useQuestionResponseWriter } from '@/features/question-renderer/hooks/use-question-response-writer';
import {
  useQuestionResponseSelector,
  useResponseSources,
} from '@/features/question-renderer/response-sources';
import {
  DEFAULT_STAGED_ROWS_ADD_LABEL,
  cellIdsOfStagedRowAt,
  deriveOpenStagedCount,
  hiddenStagedRowIds,
  resolveStagedRows,
  stagedRowCount,
} from '@/features/question-renderer/utils/staged-rows';
import type { StagedRowsConfig, TableRow } from '@/types/survey';

/**
 * 행 차례로 열기 가시성 — 저작된 행 묶음 중 몇 행을 보일지 정한다.
 *
 * 열린 행 수는 저장하지 않는다. 기본값은 값에서 파생하고(`deriveOpenStagedCount`),
 * 세션 안에서 `+` 로 연 행은 컴포넌트 상태로만 산다. 빈 행을 열어둔 채 이탈했다
 * 돌아오면 그 행은 닫혀 있다 — 값 손실은 없다 (행 반복의 열린 벌 수와 같은 결정).
 */
export interface UseStagedRowsParams {
  questionId: string;
  /** 구조 전체 행 — 열 필터를 거치지 않은 원본(가려진 열의 칸 값도 판정·비우기에 든다) */
  rows: TableRow[];
  stagedRowsConfig?: StagedRowsConfig | null | undefined;
  value?: Record<string, unknown> | undefined;
  onChange?: ((v: Record<string, unknown>) => void) | undefined;
}

export interface UseStagedRowsReturn {
  /** 설정이 켜져 있고 묶음 행이 표에 있는가 */
  isActive: boolean;
  /** 지금 보이는 묶음 행 수 */
  openCount: number;
  /** 묶음 행 수 (열 수 있는 최대) */
  maxCount: number;
  /** 처음 보이는 행 수 — 이 아래로는 닫히지 않는다 */
  initialCount: number;
  /** 지금 가려져 있어 렌더에서 빼야 할 행 id */
  hiddenRowIds: Set<string>;
  canAdd: boolean;
  canRemove: boolean;
  addLabel: string;
  addRow: () => void;
  removeRow: () => void;
}

/** 질문 응답 통째 구독용 안정 selector — 훅 밖 상수라 매 렌더 새 함수가 되지 않는다. */
const selectQuestionResponse = (questionResponse: unknown) => questionResponse;

const NO_HIDDEN_ROWS: Set<string> = new Set();

export function useStagedRows({
  questionId,
  rows,
  stagedRowsConfig,
  value,
  onChange,
}: UseStagedRowsParams): UseStagedRowsReturn {
  const { questionResponses: source } = useResponseSources();
  const sourceQuestionResponse = useQuestionResponseSelector(
    source,
    questionId,
    selectQuestionResponse,
  );
  const [sessionOpenCount, setSessionOpenCount] = useState(0);

  const currentResponse = useMemo(() => {
    if (source) {
      return typeof sourceQuestionResponse === 'object' && sourceQuestionResponse !== null
        ? (sourceQuestionResponse as Record<string, unknown>)
        : {};
    }
    return value ?? {};
  }, [source, sourceQuestionResponse, value]);

  const mergePatch = useQuestionResponseWriter({ questionId, value, onChange });

  // 구조가 깨진 설정(묶음 행이 사라짐 · 보기 옵션 칸이 듦 등)은 동작시키지 않는다 — 전부 보인다.
  const config = useMemo(() => resolveStagedRows(rows, stagedRowsConfig), [rows, stagedRowsConfig]);

  const maxCount = useMemo(() => (config ? stagedRowCount(rows, config) : 0), [config, rows]);
  const isActive = maxCount > 0;

  // 값이 없을 때의 열린 수 = 다듬어진 「처음 보이는 행 수」.
  const initialCount = useMemo(
    () => (config && isActive ? deriveOpenStagedCount(rows, config, undefined) : 0),
    [config, isActive, rows],
  );

  const derivedOpenCount = useMemo(
    () => (config && isActive ? deriveOpenStagedCount(rows, config, currentResponse) : 0),
    [config, isActive, rows, currentResponse],
  );

  const openCount = isActive ? Math.min(maxCount, Math.max(derivedOpenCount, sessionOpenCount)) : 0;

  const hiddenRowIds = useMemo(
    () => (config && isActive ? hiddenStagedRowIds(rows, config, openCount) : NO_HIDDEN_ROWS),
    [config, isActive, rows, openCount],
  );

  const addRow = useCallback(() => {
    setSessionOpenCount((prev) => Math.min(maxCount, Math.max(prev, openCount) + 1));
  }, [maxCount, openCount]);

  const removeRow = useCallback(() => {
    if (!config || openCount <= initialCount) return;
    // 닫는 행의 값은 비운다 — 남겨 두면 값에서 파생한 열린 수가 그 행을 곧바로 다시 연다.
    const cleared = cellIdsOfStagedRowAt(rows, config, openCount);
    if (cleared.length > 0) {
      mergePatch(Object.fromEntries(cleared.map((id) => [id, ''])));
    }
    setSessionOpenCount(openCount - 1);
  }, [config, openCount, initialCount, rows, mergePatch]);

  return {
    isActive,
    openCount,
    maxCount,
    initialCount,
    hiddenRowIds,
    canAdd: isActive && openCount < maxCount,
    canRemove: isActive && openCount > initialCount,
    addLabel: stagedRowsConfig?.addLabel?.trim() || DEFAULT_STAGED_ROWS_ADD_LABEL,
    addRow,
    removeRow,
  };
}
