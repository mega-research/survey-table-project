import { useCallback, useRef } from 'react';

import { useSyncLatestRef } from '@/hooks/use-latest-ref';
import { useTestResponseStore } from '@/stores/test-response-store';

/**
 * 질문 응답 쓰기 채널 — "최신 응답 읽기 → 패치 병합 → 커밋" 의식의 단일 거처.
 *
 * 같은 의식이 테스트 모드(test-response-store)와 실응답 모드(value/onChange props)라는
 * 두 adapter 형태로 use-cell-response 와 use-dynamic-row-state 에 복제돼 있었다.
 * adapter 선택(isTestMode), stale-closure 방지(ref 패턴), 비객체 응답 폴백을
 * 이 모듈이 소유한다 — 호출자는 mergePatch(patch) 하나만 안다.
 *
 * 불변식:
 * - 커밋 base 는 항상 "커밋 시점의 최신" 질문 응답이다. 테스트 모드는 store.getState(),
 *   실응답 모드는 마지막 렌더의 value(ref 경유). 빠른 연속 호출에서도 패치가 유실되지 않는다.
 *   (실응답 모드의 연속 호출 누적 보정은 상위 mergedOnChange 계층 소관 — 현행 동작 보존.)
 * - 질문 응답이 객체가 아니면(미응답·문자열 응답 등) 빈 객체를 base 로 시작한다.
 * - 실응답 모드에서 onChange 미제공이면 커밋은 no-op 이다.
 * - 패치 키가 base 와 겹치면 패치가 이긴다 (스프레드 순서 보장).
 */
export function useQuestionResponseWriter(params: {
  questionId: string;
  isTestMode: boolean;
  value?: Record<string, unknown> | undefined;
  onChange?: ((v: Record<string, unknown>) => void) | undefined;
}): (patch: Record<string, unknown>) => void {
  const { questionId, isTestMode, value, onChange } = params;

  const updateTestResponse = useTestResponseStore((s) => s.updateTestResponse);

  // ref 패턴: stale closure 방지 (빠른 연속 업데이트 시 최신 값 보장)
  const valueRef = useRef(value);
  useSyncLatestRef(valueRef, value);
  const onChangeRef = useRef(onChange);
  useSyncLatestRef(onChangeRef, onChange);

  return useCallback(
    (patch: Record<string, unknown>) => {
      if (isTestMode) {
        const latest = useTestResponseStore.getState().testResponses[questionId];
        const base = typeof latest === 'object' && latest !== null ? latest : {};
        // store 의 값 타입은 셀 응답 union — 병합 결과를 그 형태로 커밋한다
        updateTestResponse(questionId, {
          ...(base as Record<string, string | string[] | object>),
          ...(patch as Record<string, string | string[] | object>),
        });
      } else if (onChangeRef.current) {
        const base = (valueRef.current || {}) as Record<string, unknown>;
        onChangeRef.current({ ...base, ...patch });
      }
    },
    [isTestMode, questionId, updateTestResponse],
  );
}
