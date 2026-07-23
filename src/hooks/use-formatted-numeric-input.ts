'use client';

/**
 * 숫자 입력란의 표시 포맷(콤마/환산)·타이핑 차단(max/소수 자릿수)·min 라이브 힌트 공용 훅.
 * 단답형(question-input.tsx)과 테이블 input 셀(input-cell.tsx)이 공유한다.
 *
 * store 로는 항상 raw 숫자 문자열만 전달한다 — 콤마는 화면 value 에만 존재.
 */

import { useCallback, useState } from 'react';

import type { NumberFormat } from '@/types/survey';
import {
  exceedsDecimalPlaces,
  exceedsMax,
  formatKoreanUnitReading,
  formatWithComma,
  rangeViolationMessage,
  stripComma,
  violatesMinStart,
} from '@/utils/number-format';
import { isPartialNumericInput } from '@/utils/numeric-input';

interface Options {
  rawValue: string;
  onRawChange: (raw: string) => void;
  // exactOptionalPropertyTypes: 옵셔널 prop 읽기 값은 항상 `| undefined` 를 포함하므로
  // Question.numberFormat(옵셔널 필드) 을 그대로 전달하는 호출부와 타입을 맞춘다.
  numberFormat?: NumberFormat | null | undefined;
  enabled: boolean;
}

export function useFormattedNumericInput({
  rawValue,
  onRawChange,
  numberFormat,
  enabled,
}: Options) {
  // min 힌트는 포커스 중 숨긴다 — '15' 를 치는 도중 '1' 에서 에러가 스치는 깜빡임 방지
  const [focused, setFocused] = useState(false);
  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);

  const useComma = enabled && !!numberFormat?.thousandSeparator;
  const displayValue = useComma ? formatWithComma(rawValue) : rawValue;

  const decimalPlaces = numberFormat?.decimalPlaces;
  const max = numberFormat?.max;
  const min = numberFormat?.min;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const displayNext = e.target.value;
      const raw = useComma ? stripComma(displayNext) : displayNext;
      if (enabled) {
        if (!isPartialNumericInput(raw)) return;
        if (exceedsDecimalPlaces(raw, decimalPlaces)) return;
        if (exceedsMax(raw, max)) return;
        // min 도달 불가 시작(min>=1 의 0/'.' 시작, min>=0 의 음수 시작)은 타이핑에서 차단.
        // '10' 을 위한 중간값 '1'(min=10) 처럼 도달 가능한 미달값은 여기서 막지 않는다 —
        // 그 몫은 blur 힌트 + "다음" 차단 검증(rangeViolationMessage) 소관.
        if (violatesMinStart(raw, min)) return;
      }
      if (useComma) {
        // 콤마 재포맷으로 인한 캐럿 점프 보정 — 캐럿 앞의 콤마 제외 문자 수를 보존
        const el = e.target;
        const caret = el.selectionStart ?? displayNext.length;
        const charsBefore = displayNext.slice(0, caret).replace(/,/g, '').length;
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(() => {
            const formatted = formatWithComma(raw);
            let pos = 0;
            let seen = 0;
            while (pos < formatted.length && seen < charsBefore) {
              if (formatted[pos] !== ',') seen += 1;
              pos += 1;
            }
            el.setSelectionRange(pos, pos);
          });
        }
      }
      onRawChange(raw);
    },
    [enabled, useComma, decimalPlaces, max, onRawChange],
  );

  const unitReading = enabled ? formatKoreanUnitReading(rawValue, numberFormat?.unit) : null;

  // 범위 힌트 — 포커스 중 숨김. min 은 이 힌트가 1차 피드백이고,
  // max 는 타이핑 차단이 1차·이 힌트는 우회 값(prefill 오설정 등) 봉합용.
  const rangeViolation =
    enabled && !focused ? rangeViolationMessage(rawValue, numberFormat) : null;

  return { displayValue, handleChange, handleFocus, handleBlur, unitReading, rangeViolation };
}
