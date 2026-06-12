import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCellResponse } from '@/components/survey-builder/cells/use-cell-response';
import { useTestResponseStore } from '@/stores/test-response-store';

/**
 * 셀 응답 훅 characterization — 응답 쓰기 채널(use-question-response-writer) 추출 전
 * 현행 동작 고정.
 *
 * 두 모드의 쓰기 의식("최신 응답 읽기 → 패치 병합 → 커밋")이 이 훅과
 * use-dynamic-row-state 에 복제돼 있던 것을 use-question-response-writer 로 추출했다.
 * 런타임 단언 11건은 추출 전후 무수정 green (예외: 86행 initialProps 타입 캐스트 1줄 —
 * 테스트 추가 커밋의 pre-existing tsc 에러 수정, 행위 무관).
 */

beforeEach(() => {
  useTestResponseStore.getState().clearTestResponses();
});

describe('useCellResponse — 테스트 모드 (test-response-store adapter)', () => {
  it('store 의 해당 셀 값을 읽는다', () => {
    useTestResponseStore.getState().updateTestResponse('q1', { c1: '저장값' });
    const { result } = renderHook(() => useCellResponse('q1', 'c1', true));
    expect(result.current.cellResponse).toBe('저장값');
  });

  it('updateValue: store 의 최신 응답에 병합 커밋 (기존 키 보존)', () => {
    useTestResponseStore.getState().updateTestResponse('q1', { c0: '기존' });
    const { result } = renderHook(() => useCellResponse('q1', 'c1', true));

    act(() => result.current.updateValue('새값'));

    expect(useTestResponseStore.getState().testResponses['q1']).toEqual({
      c0: '기존',
      c1: '새값',
    });
  });

  it('updateValue: sibling 셀 응답을 빈값으로 클리어한 뒤 자신을 기록', () => {
    useTestResponseStore.getState().updateTestResponse('q1', { c2: '경쟁값', c3: '경쟁값2' });
    const { result } = renderHook(() => useCellResponse('q1', 'c1', true, undefined, undefined, ['c2', 'c3']));

    act(() => result.current.updateValue('선택'));

    expect(useTestResponseStore.getState().testResponses['q1']).toEqual({
      c2: '',
      c3: '',
      c1: '선택',
    });
  });

  it('질문 응답이 객체가 아니면 빈 객체에서 시작해 병합', () => {
    useTestResponseStore.getState().updateTestResponse('q1', '문자열응답');
    const { result } = renderHook(() => useCellResponse('q1', 'c1', true));

    act(() => result.current.updateValue('값'));

    expect(useTestResponseStore.getState().testResponses['q1']).toEqual({ c1: '값' });
  });
});

describe('useCellResponse — 실응답 모드 (value/onChange adapter)', () => {
  it('externalValue 의 해당 셀 값을 읽는다', () => {
    const { result } = renderHook(() => useCellResponse('q1', 'c1', false, { c1: '외부값' }));
    expect(result.current.cellResponse).toBe('외부값');
  });

  it('updateValue: 최신 externalValue 에 병합해 onChange 로 전달', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useCellResponse('q1', 'c1', false, { c0: '기존' }, onChange),
    );

    act(() => result.current.updateValue('새값'));

    expect(onChange).toHaveBeenCalledWith({ c0: '기존', c1: '새값' });
  });

  it('updateValue: rerender 로 갱신된 최신 externalValue 를 병합 (stale closure 방지 ref 패턴)', () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }: { value: Record<string, unknown> }) =>
        useCellResponse('q1', 'c1', false, value, onChange),
      { initialProps: { value: { c0: '구버전' } as Record<string, unknown> } },
    );

    rerender({ value: { c0: '신버전', c9: '추가' } });
    act(() => result.current.updateValue('새값'));

    expect(onChange).toHaveBeenCalledWith({ c0: '신버전', c9: '추가', c1: '새값' });
  });

  it('updateValue: sibling 클리어가 실응답 경로에도 적용', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useCellResponse('q1', 'c1', false, { c2: '경쟁값' }, onChange, ['c2']),
    );

    act(() => result.current.updateValue('선택'));

    expect(onChange).toHaveBeenCalledWith({ c2: '', c1: '선택' });
  });

  it('onChange 미제공 시 커밋은 no-op 이지만 로컬 상태는 즉시 반영', () => {
    const { result } = renderHook(() => useCellResponse('q1', 'c1', false, {}));

    act(() => result.current.updateValue('로컬값'));

    expect(result.current.cellResponse).toBe('로컬값');
    expect(useTestResponseStore.getState().testResponses['q1']).toBeUndefined();
  });
});

describe('useCellResponse — 로컬 상태 동기화', () => {
  it('updateValue 직후 cellResponse 가 동기 반영된다 (UI 즉시 갱신)', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useCellResponse('q1', 'c1', false, {}, onChange));

    act(() => result.current.updateValue('즉시'));
    expect(result.current.cellResponse).toBe('즉시');
  });

  it('외부 값이 바뀌면 로컬 상태도 따라간다', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: Record<string, unknown> }) =>
        useCellResponse('q1', 'c1', false, value),
      { initialProps: { value: { c1: '처음' } } },
    );

    rerender({ value: { c1: '갱신' } });
    expect(result.current.cellResponse).toBe('갱신');
  });
});
