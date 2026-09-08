import { useCallback, useMemo, useState } from 'react';

import { useQuestionResponseWriter } from '@/hooks/use-question-response-writer';
import {
  DEFAULT_ROW_REPEAT_ADD_LABEL,
  cellIdsOfBundlesBeyond,
  deriveOpenRepeatCount,
  hiddenRepeatRowIds,
  isRowRepeatActive,
  structuralRepeatCount,
} from '@/lib/question/row-repeat';
import { useTestResponseStore } from '@/stores/test-response-store';
import type { RowRepeatConfig, TableRow } from '@/types/survey';

/**
 * 행 반복 가시성 — 구조에 이미 펼쳐진 벌 중 몇 벌을 보일지 정한다.
 *
 * 열린 벌 수는 저장하지 않는다. 기본값은 값에서 파생하고(`deriveOpenRepeatCount`),
 * 세션 안에서 `+` 로 연 벌은 컴포넌트 상태로만 산다. 빈 벌을 열어둔 채 이탈했다
 * 돌아오면 그 벌은 접혀 있다 — 값 손실은 없다 (설계 결정 4).
 */
export interface UseRowRepeatParams {
  questionId: string;
  /** 열 필터를 거친 렌더 대상 행 (구조에 펼쳐진 전체 벌을 담고 있다) */
  rows: TableRow[];
  rowRepeatConfig?: RowRepeatConfig | null | undefined;
  isTestMode: boolean;
  value?: Record<string, unknown> | undefined;
  onChange?: ((v: Record<string, unknown>) => void) | undefined;
}

export interface UseRowRepeatReturn {
  /** 반복 블록이 켜져 있고 구조에 펼친 벌이 있는가 */
  isActive: boolean;
  /** 지금 보이는 벌 수 */
  openCount: number;
  /** 구조에 펼쳐진 최대 벌 수 */
  maxCount: number;
  /** 지금 접혀 있어 렌더에서 빼야 할 행 id */
  hiddenRowIds: Set<string>;
  canAdd: boolean;
  canRemove: boolean;
  addLabel: string;
  addBundle: () => void;
  removeBundle: () => void;
}

export function useRowRepeat({
  questionId,
  rows,
  rowRepeatConfig,
  isTestMode,
  value,
  onChange,
}: UseRowRepeatParams): UseRowRepeatReturn {
  const testQuestionResponse = useTestResponseStore((s) => s.testResponses[questionId]);
  const [sessionOpenCount, setSessionOpenCount] = useState(0);

  const currentResponse = useMemo(() => {
    if (isTestMode) {
      return typeof testQuestionResponse === 'object' && testQuestionResponse !== null
        ? (testQuestionResponse as Record<string, unknown>)
        : {};
    }
    return value ?? {};
  }, [isTestMode, testQuestionResponse, value]);

  const mergePatch = useQuestionResponseWriter({ questionId, isTestMode, value, onChange });

  const maxCount = useMemo(
    () => (isRowRepeatActive(rowRepeatConfig) ? structuralRepeatCount(rows) : 0),
    [rowRepeatConfig, rows],
  );
  const isActive = maxCount > 0;

  const derivedOpenCount = useMemo(
    () => (isActive ? deriveOpenRepeatCount(rows, currentResponse) : 0),
    [isActive, rows, currentResponse],
  );

  const openCount = isActive
    ? Math.min(maxCount, Math.max(derivedOpenCount, sessionOpenCount))
    : 0;

  const hiddenRowIds = useMemo(
    () => (isActive ? hiddenRepeatRowIds(rows, openCount) : new Set<string>()),
    [isActive, rows, openCount],
  );

  const addBundle = useCallback(() => {
    setSessionOpenCount((prev) => Math.min(maxCount, Math.max(prev, openCount) + 1));
  }, [maxCount, openCount]);

  const removeBundle = useCallback(() => {
    if (openCount <= 1) return;
    const next = openCount - 1;
    // 접는 벌의 값은 비운다 — 화면에 없는 잔존 값이 다음 진입에서 그 벌을 다시 열고,
    // 내보내기의 "쓰인 벌" 판정에도 잡힌다.
    const cleared = cellIdsOfBundlesBeyond(rows, next);
    if (cleared.length > 0) {
      mergePatch(Object.fromEntries(cleared.map((id) => [id, ''])));
    }
    setSessionOpenCount(next);
  }, [openCount, rows, mergePatch]);

  return {
    isActive,
    openCount,
    maxCount,
    hiddenRowIds,
    canAdd: isActive && openCount < maxCount,
    canRemove: isActive && openCount > 1,
    addLabel: rowRepeatConfig?.addLabel?.trim() || DEFAULT_ROW_REPEAT_ADD_LABEL,
    addBundle,
    removeBundle,
  };
}
