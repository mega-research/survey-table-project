'use client';

import { useCallback, useState } from 'react';

/**
 * 입력칸의 포커스 여부 — 응답 품질 위반 문구를 **치는 동안에는 숨기기** 위한 것.
 *
 * 한글은 조합 중 첫 자모(ㅇ·ㅎ)가 값에 잠깐 실린다. 그 순간 "자음·모음만으로는 답할 수 없다"
 * 를 띄우면 첫 글자부터 빨간 글씨가 스친다. 형식 검사(useInputFormatField)와 같은 규칙으로
 * 포커스가 빠진 뒤에만 문구를 보인다. 판정 자체는 그대로라 「다음」 차단은 바뀌지 않는다.
 */
export function useFieldFocus(): { focused: boolean; onFocus: () => void; onBlur: () => void } {
  const [focused, setFocused] = useState(false);
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  return { focused, onFocus, onBlur };
}
