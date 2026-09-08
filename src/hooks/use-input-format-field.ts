'use client';

/**
 * 입력 형식(휴대전화·전화·사업자번호·법인번호·이메일) 칸의 화면 동작 공용 훅.
 * 단답형 문항 · 표 input 셀 · 보기 상세기재가 공유한다.
 *
 * **타이핑 중에는 아무것도 하지 않는다.** 자동 하이픈은 백스페이스·중간 수정·붙여넣기에서
 * 커서를 튀게 하는 고전적인 버그를 부른다. 정돈은 칸을 벗어날 때 한 번만 한다.
 *
 * 위반 문구도 포커스 중에는 숨긴다 — 치는 도중에 계속 빨간 글씨가 스치면 방해만 된다
 * (숫자 모드의 min 힌트와 같은 규칙).
 */
import { useCallback, useState } from 'react';

import { isUntouchedPriorValue } from '@/lib/survey/prior-answers';
import type { InputFormat } from '@/types/input-type';
import { formatFailureMessage, parseInputFormat } from '@/utils/input-format';

interface Options {
  /** 형식 미지정이면 null — 훅은 무동작이 된다. */
  format: InputFormat | null;
  rawValue: string;
  onRawChange: (raw: string) => void;
  /** 프리필 잠금 등으로 응답자가 못 고치는 칸이면 false — 정돈도 검사도 하지 않는다. */
  enabled?: boolean;
  /**
   * 이 칸의 이월(지난 회차) 원본 값. 현재 값이 여기에 글자 그대로 같으면 응답자가
   * 손대지 않은 것이므로 정돈도 검사도 하지 않는다 — 치지도 않은 값 때문에 막히면
   * 따를 수 있는 길이 없다. 한 글자라도 고치면 그때부터 대상이다.
   */
  priorOriginal?: string | null;
}

export interface InputFormatField {
  handleFocus: () => void;
  /** blur 시 정규형으로 정돈한다. 형식이 틀린 값은 손대지 않는다(고칠 수 있게 남긴다). */
  handleBlur: () => void;
  /** 포커스가 빠진 뒤에만 채워지는 위반 문구. */
  violation: string | null;
  /** 모바일 키패드 힌트 — 번호는 숫자 키패드, 이메일은 이메일 키패드. */
  inputMode: 'tel' | 'email' | undefined;
}

export function useInputFormatField({
  format,
  rawValue,
  onRawChange,
  enabled = true,
  priorOriginal = null,
}: Options): InputFormatField {
  const [focused, setFocused] = useState(false);
  const untouchedPrior = isUntouchedPriorValue(rawValue, priorOriginal);

  const handleFocus = useCallback(() => setFocused(true), []);

  const handleBlur = useCallback(() => {
    setFocused(false);
    if (!format || !enabled || untouchedPrior) return;
    const result = parseInputFormat(format, rawValue);
    if (result.ok && result.normalized !== rawValue) onRawChange(result.normalized);
  }, [format, enabled, untouchedPrior, rawValue, onRawChange]);

  let violation: string | null = null;
  if (format && enabled && !untouchedPrior && !focused && rawValue.trim() !== '') {
    const result = parseInputFormat(format, rawValue);
    if (!result.ok) violation = formatFailureMessage(format, result.reason);
  }

  const inputMode = format
    ? format === 'email'
      ? ('email' as const)
      : ('tel' as const)
    : undefined;

  return { handleFocus, handleBlur, violation, inputMode };
}
