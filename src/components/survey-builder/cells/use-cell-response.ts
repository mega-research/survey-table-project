import { useCallback, useEffect, useRef, useState } from 'react';

import { useQuestionResponseWriter } from '@/hooks/use-question-response-writer';
import { useTestResponseStore } from '@/stores/test-response-store';

/**
 * 셀 응답 값 관리 훅
 * - Zustand cell-level selector로 해당 셀만 구독
 * - 쓰기는 질문 응답 쓰기 채널(use-question-response-writer)에 위임 —
 *   모드별 병합·커밋 의식과 stale closure 방지는 채널이 소유한다
 * - 로컬 상태로 UI 즉시 반영 보장
 */
export function useCellResponse(
  questionId: string,
  cellId: string,
  isTestMode: boolean,
  externalValue?: Record<string, unknown>,
  externalOnChange?: (value: Record<string, unknown>) => void,
  /**
   * Phase 5-D: 같은 radioGroup의 sibling 셀 id 목록.
   * updateValue 호출 시 sibling 셀들의 응답을 자동으로 빈값('')으로 클리어해
   * 브라우저 native radio single-select 동작과 React state를 동기화한다.
   */
  siblingCellIds?: string[],
) {
  // cell-level selector: 해당 셀 값만 구독
  const storeResponse = useTestResponseStore(
    useCallback(
      (state) => {
        if (!isTestMode) return undefined;
        const qr = state.testResponses[questionId];
        if (typeof qr === 'object' && qr !== null) {
          return (qr as Record<string, unknown>)[cellId];
        }
        return undefined;
      },
      [isTestMode, questionId, cellId],
    ),
  );

  const valueFromProps = isTestMode ? storeResponse : externalValue?.[cellId];

  const [localResponse, setLocalResponse] = useState(valueFromProps);

  useEffect(() => {
    setLocalResponse(valueFromProps);
  }, [valueFromProps]);

  const mergePatch = useQuestionResponseWriter({
    questionId,
    isTestMode,
    value: externalValue,
    onChange: externalOnChange,
  });

  // Phase 5-D: sibling 셀 id 변경 시 stale closure 방지
  const siblingIdsRef = useRef(siblingCellIds);
  siblingIdsRef.current = siblingCellIds;

  const updateValue = useCallback(
    (cellValue: string | string[] | object) => {
      setLocalResponse(cellValue);

      // sibling 셀 응답을 빈값으로 클리어 (radioGroup single-select 강제용)
      const siblingClear: Record<string, string> = {};
      const sids = siblingIdsRef.current;
      if (sids && sids.length > 0) {
        for (const sid of sids) siblingClear[sid] = '';
      }

      mergePatch({ ...siblingClear, [cellId]: cellValue });
    },
    [cellId, mergePatch],
  );

  return { cellResponse: localResponse, updateValue };
}
