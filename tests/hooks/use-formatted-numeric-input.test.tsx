import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFormattedNumericInput } from '@/hooks/use-formatted-numeric-input';

function changeEvent(value: string) {
  return {
    target: { value, selectionStart: value.length, setSelectionRange: vi.fn() },
  } as unknown as React.ChangeEvent<HTMLInputElement>;
}

describe('useFormattedNumericInput', () => {
  it('콤마 옵션: 화면엔 콤마, store 엔 raw', () => {
    const onRawChange = vi.fn();
    const { result } = renderHook(() =>
      useFormattedNumericInput({
        rawValue: '1234567',
        onRawChange,
        numberFormat: { thousandSeparator: true },
        enabled: true,
      }),
    );
    expect(result.current.displayValue).toBe('1,234,567');
    act(() => result.current.handleChange(changeEvent('1,234,5678')));
    expect(onRawChange).toHaveBeenCalledWith('12345678');
  });

  it('max 초과·소수 자릿수 초과·비숫자는 타이핑 거부 (onRawChange 미호출)', () => {
    const onRawChange = vi.fn();
    const { result } = renderHook(() =>
      useFormattedNumericInput({
        rawValue: '10',
        onRawChange,
        numberFormat: { max: 100, decimalPlaces: 0 },
        enabled: true,
      }),
    );
    act(() => result.current.handleChange(changeEvent('101')));
    act(() => result.current.handleChange(changeEvent('10.')));
    act(() => result.current.handleChange(changeEvent('10a')));
    expect(onRawChange).not.toHaveBeenCalled();
    act(() => result.current.handleChange(changeEvent('100')));
    expect(onRawChange).toHaveBeenCalledWith('100');
  });

  it('환산 표시와 min 힌트 — min 힌트는 포커스 중 숨기고 blur 후 표시', () => {
    const { result } = renderHook(() =>
      useFormattedNumericInput({
        rawValue: '123',
        onRawChange: vi.fn(),
        numberFormat: { unit: 'tenMillion', min: 200 },
        enabled: true,
      }),
    );
    expect(result.current.unitReading).toBe('12억 3천만');
    // 초기(비포커스) 상태는 표시
    expect(result.current.rangeViolation).toBe('200 이상 입력해주세요');
    // 포커스 중에는 숨김 (타이핑 중 깜빡임 방지)
    act(() => result.current.handleFocus());
    expect(result.current.rangeViolation).toBeNull();
    // blur 후 다시 표시
    act(() => result.current.handleBlur());
    expect(result.current.rangeViolation).toBe('200 이상 입력해주세요');
  });

  it('max 초과 우회 값(prefill 오설정 등)도 범위 힌트로 표시한다', () => {
    const { result } = renderHook(() =>
      useFormattedNumericInput({
        rawValue: '500',
        onRawChange: vi.fn(),
        numberFormat: { max: 100 },
        enabled: true,
      }),
    );
    expect(result.current.rangeViolation).toBe('100 이하로 입력해주세요');
  });

  it('enabled=false 면 아무 가공 없이 통과시킨다', () => {
    const onRawChange = vi.fn();
    const { result } = renderHook(() =>
      useFormattedNumericInput({
        rawValue: '자유 텍스트',
        onRawChange,
        numberFormat: { thousandSeparator: true },
        enabled: false,
      }),
    );
    expect(result.current.displayValue).toBe('자유 텍스트');
    act(() => result.current.handleChange(changeEvent('자유 텍스트2')));
    expect(onRawChange).toHaveBeenCalledWith('자유 텍스트2');
    expect(result.current.unitReading).toBeNull();
  });
});
