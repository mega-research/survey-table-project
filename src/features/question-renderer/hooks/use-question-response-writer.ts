import { useCallback, useRef } from 'react';

import { useResponseSources } from '@/features/question-renderer/response-sources';
import { useSyncLatestRef } from '@/hooks/use-latest-ref';

/**
 * 질문 응답 쓰기 채널 — "최신 응답 읽기 → 패치 병합 → 커밋" 의식의 단일 거처.
 *
 * 같은 의식이 주입 원본(response-sources)과 value/onChange props 라는 두 adapter 형태로
 * use-cell-response 와 use-dynamic-row-state 에 복제돼 있었다. adapter 선택,
 * stale-closure 방지(ref 패턴), 비객체 응답 폴백을 이 모듈이 소유한다 —
 * 호출자는 mergePatch(patch) 하나만 안다.
 *
 * 불변식:
 * - 커밋 base 는 항상 "커밋 시점의 최신" 질문 응답이다. 원본이 주입돼 있으면 source.read(),
 *   없으면 마지막 렌더의 value(ref 경유). 빠른 연속 호출에서도 패치가 유실되지 않는다.
 *   (props 모드의 연속 호출 누적 보정은 상위 mergedOnChange 계층 소관 — 현행 동작 보존.)
 * - 질문 응답이 객체가 아니면(미응답·문자열 응답 등) 빈 객체를 base 로 시작한다.
 * - props 모드에서 onChange 미제공이면 커밋은 no-op 이다.
 * - 패치 키가 base 와 겹치면 패치가 이긴다 (스프레드 순서 보장).
 */
export function useQuestionResponseWriter(params: {
  questionId: string;
  value?: Record<string, unknown> | undefined;
  onChange?: ((v: Record<string, unknown>) => void) | undefined;
}): (patch: Record<string, unknown>) => void {
  const { questionId, value, onChange } = params;

  const { questionResponses: source } = useResponseSources();

  // ref 패턴: stale closure 방지 (빠른 연속 업데이트 시 최신 값 보장)
  const valueRef = useRef(value);
  useSyncLatestRef(valueRef, value);
  const onChangeRef = useRef(onChange);
  useSyncLatestRef(onChangeRef, onChange);

  return useCallback(
    (patch: Record<string, unknown>) => {
      if (source) {
        const latest = source.read(questionId);
        const base = typeof latest === 'object' && latest !== null ? latest : {};
        source.write(questionId, { ...(base as Record<string, unknown>), ...patch });
      } else if (onChangeRef.current) {
        const base = (valueRef.current || {}) as Record<string, unknown>;
        onChangeRef.current({ ...base, ...patch });
      }
    },
    [source, questionId],
  );
}
