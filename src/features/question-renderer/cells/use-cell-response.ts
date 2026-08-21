import { useCallback, useRef, useState } from 'react';

import { useQuestionResponseWriter } from '@/features/question-renderer/hooks/use-question-response-writer';
import {
  useQuestionResponseSelector,
  useResponseSources,
} from '@/features/question-renderer/response-sources';
import { useSyncLatestRef } from '@/hooks/use-latest-ref';

/**
 * 셀 응답 값 관리 훅
 * - 질문 응답 원본이 주입돼 있으면 그 원본을 셀 단위로 구독 (이 셀 값만 본다)
 * - 원본이 없으면 externalValue/externalOnChange props 가 유일한 원본이다
 * - 쓰기는 질문 응답 쓰기 채널(use-question-response-writer)에 위임 —
 *   adapter 별 병합·커밋 의식과 stale closure 방지는 채널이 소유한다
 * - 로컬 상태로 UI 즉시 반영 보장
 */
export function useCellResponse(
  questionId: string,
  cellId: string,
  externalValue?: Record<string, unknown>,
  externalOnChange?: (value: Record<string, unknown>) => void,
  /**
   * Phase 5-D: 같은 radioGroup의 sibling 셀 id 목록.
   * updateValue 호출 시 sibling 셀들의 응답을 자동으로 빈값('')으로 클리어해
   * 브라우저 native radio single-select 동작과 React state를 동기화한다.
   */
  siblingCellIds?: string[],
) {
  const { questionResponses: source } = useResponseSources();

  // 셀 단위 구독: 질문 응답 객체가 아니라 이 셀 값만 본다
  const selectCell = useCallback(
    (questionResponse: unknown) =>
      typeof questionResponse === 'object' && questionResponse !== null
        ? (questionResponse as Record<string, unknown>)[cellId]
        : undefined,
    [cellId],
  );
  const sourceResponse = useQuestionResponseSelector(source, questionId, selectCell);

  const valueFromProps = source ? sourceResponse : externalValue?.[cellId];

  const [localResponse, setLocalResponse] = useState(valueFromProps);

  // 외부 값 변경 시 로컬 응답 동기화 — effect 대신 렌더 중 조정 패턴
  const [prevValueFromProps, setPrevValueFromProps] = useState(valueFromProps);
  if (prevValueFromProps !== valueFromProps) {
    setPrevValueFromProps(valueFromProps);
    setLocalResponse(valueFromProps);
  }

  const mergePatch = useQuestionResponseWriter({
    questionId,
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
