import { useCallback, useRef, useState } from 'react';

import { useSyncLatestRef } from '@/hooks/use-latest-ref';
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

  // 외부 값 변경 시 로컬 응답 동기화 — effect 대신 렌더 중 조정 패턴
  const [prevValueFromProps, setPrevValueFromProps] = useState(valueFromProps);
  if (prevValueFromProps !== valueFromProps) {
    setPrevValueFromProps(valueFromProps);
    setLocalResponse(valueFromProps);
  }

  const mergePatch = useQuestionResponseWriter({
    questionId,
    isTestMode,
    value: externalValue,
    onChange: externalOnChange,
  });

  // Phase 5-D: sibling 셀 id 변경 시 stale closure 방지
  const siblingIdsRef = useRef(siblingCellIds);
  useSyncLatestRef(siblingIdsRef, siblingCellIds);

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

  // 게이팅 비활성화 시 값 지움 — 빈 문자열이 아니라 키 값 undefined(JSON 직렬화에서
  // 탈락 = 저장상 키 삭제). emptyDefault 채움 조건(cellResponse === undefined)이
  // 다시 성립해 재활성화 시 초기값이 자연 재채움된다.
  const clearValue = useCallback(() => {
    setLocalResponse(undefined);
    mergePatch({ [cellId]: undefined });
  }, [mergePatch, cellId]);

  return { cellResponse: localResponse, updateValue, clearValue };
}
