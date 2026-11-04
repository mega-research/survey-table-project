'use client';

/**
 * 열 차례로 열기 가시성 — 단계를 적은 열 중 몇 단계까지 보일지 정한다(CONTEXT.md 「열 차례로 열기」).
 *
 * 열린 단계는 저장하지 않는다. 기본값은 값에서 파생하고(`deriveOpenColumnStep`), 세션 안에서 `+` 로
 * 연 단계는 컴포넌트 상태로만 산다 — 행 차례로 열기(`use-staged-rows`)와 같은 규칙이다.
 */
import { useCallback, useMemo, useState } from 'react';

import { useQuestionResponseWriter } from '@/features/question-renderer/hooks/use-question-response-writer';
import {
  useQuestionResponseSelector,
  useResponseSources,
} from '@/features/question-renderer/response-sources';
import { useInlineSurveyLocale } from '@/features/question-renderer/survey-locale-context';
import {
  cellIdsOfColumnStepsBeyond,
  deriveOpenColumnStep,
  hiddenStagedColumnIds,
  maxColumnStep,
  stageableColumns,
  stagedColumnAddLabel,
} from '@/features/question-renderer/utils/staged-columns';
import type { TableColumn, TableRow } from '@/types/survey';
import { systemText } from '@/utils/system-strings';

export interface UseStagedColumnsParams {
  questionId: string;
  /** 작성된 열 전체 */
  columns: TableColumn[];
  /** 구조 전체 행 — 행 반복으로 펼친 벌까지(가려진 행의 칸 값도 판정·비우기에 든다) */
  rows: TableRow[];
  value?: Record<string, unknown> | undefined;
  onChange?: ((v: Record<string, unknown>) => void) | undefined;
}

export interface UseStagedColumnsReturn {
  isActive: boolean;
  /** 지금 열린 단계 */
  openStep: number;
  /** 가장 큰 단계 */
  maxStep: number;
  /** 지금 가려 렌더에서 뺄 열 id */
  hiddenColumnIds: Set<string>;
  canAdd: boolean;
  canRemove: boolean;
  addLabel: string;
  addStep: () => void;
  removeStep: () => void;
}

const selectQuestionResponse = (questionResponse: unknown) => questionResponse;
const NO_HIDDEN: Set<string> = new Set();

export function useStagedColumns({
  questionId,
  columns: authoredColumns,
  rows,
  value,
  onChange,
}: UseStagedColumnsParams): UseStagedColumnsReturn {
  // 보기·순위 옵션 칸이 든 열의 단계는 무시한다(빌더가 막지만 옛 구조·스크립트 설정 방어)
  const columns = useMemo(() => stageableColumns(authoredColumns, rows), [authoredColumns, rows]);
  const { questionResponses: source } = useResponseSources();
  const sourceQuestionResponse = useQuestionResponseSelector(source, questionId, selectQuestionResponse);
  const [sessionOpenStep, setSessionOpenStep] = useState(0);
  const defaultAddLabel = systemText('table.addColumn', useInlineSurveyLocale());

  const currentResponse = useMemo(() => {
    if (source) {
      return typeof sourceQuestionResponse === 'object' && sourceQuestionResponse !== null
        ? (sourceQuestionResponse as Record<string, unknown>)
        : {};
    }
    return value ?? {};
  }, [source, sourceQuestionResponse, value]);

  const mergePatch = useQuestionResponseWriter({ questionId, value, onChange });

  const maxStep = useMemo(() => maxColumnStep(columns), [columns]);
  const isActive = maxStep >= 2;
  const derivedOpenStep = useMemo(
    () => (isActive ? deriveOpenColumnStep(columns, rows, currentResponse) : 1),
    [isActive, columns, rows, currentResponse],
  );
  const openStep = isActive ? Math.min(maxStep, Math.max(derivedOpenStep, sessionOpenStep, 1)) : maxStep;

  const hiddenColumnIds = useMemo(
    () => (isActive ? hiddenStagedColumnIds(columns, openStep) : NO_HIDDEN),
    [isActive, columns, openStep],
  );

  const addStep = useCallback(() => {
    setSessionOpenStep((prev) => Math.min(maxStep, Math.max(prev, openStep) + 1));
  }, [maxStep, openStep]);

  const removeStep = useCallback(() => {
    if (openStep <= 1) return;
    const next = openStep - 1;
    // 닫는 단계의 값은 비운다 — 남겨 두면 값에서 파생한 열린 단계가 곧바로 다시 연다.
    const cleared = cellIdsOfColumnStepsBeyond(columns, rows, next);
    if (cleared.length > 0) mergePatch(Object.fromEntries(cleared.map((id) => [id, ''])));
    setSessionOpenStep(next);
  }, [openStep, columns, rows, mergePatch]);

  return {
    isActive,
    openStep,
    maxStep,
    hiddenColumnIds,
    canAdd: isActive && openStep < maxStep,
    canRemove: isActive && openStep > 1,
    addLabel: stagedColumnAddLabel(columns) ?? defaultAddLabel,
    addStep,
    removeStep,
  };
}
