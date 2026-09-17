import { describe, expect, it, beforeEach } from 'vitest';

import { readOptTextsSidecar } from '@/lib/option-text-read';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';

describe('readOptTextsSidecar', () => {
  it('루트 __optTexts__ 를 questionId → optionId → text 로 추출한다', () => {
    const qr = {
      q1: 'opt-a',
      __optTexts__: { q1: { 'opt-a': '기타 답변' }, q2: { 'opt-b': '상세' } },
    };
    expect(readOptTextsSidecar(qr)).toEqual({
      q1: { 'opt-a': '기타 답변' },
      q2: { 'opt-b': '상세' },
    });
  });

  it('사이드카가 없거나 형태가 손상되면 빈 객체', () => {
    expect(readOptTextsSidecar(null)).toEqual({});
    expect(readOptTextsSidecar({})).toEqual({});
    expect(readOptTextsSidecar({ __optTexts__: 'broken' })).toEqual({});
    expect(readOptTextsSidecar({ __optTexts__: { q1: ['a'] } })).toEqual({});
    // 문자열 아닌 값은 필터, 문자열만 생존
    expect(
      readOptTextsSidecar({ __optTexts__: { q1: { a: 1, b: 'ok' } } }),
    ).toEqual({ q1: { b: 'ok' } });
  });
});

describe('seedOptionTexts', () => {
  beforeEach(() => useSurveyResponseStore.getState().resetResponseState());

  it('저장값을 스토어로 되살린다 (이어가기 시드)', () => {
    useSurveyResponseStore.getState().seedOptionTexts({ q1: { 'opt-a': '기타 답변' } });
    expect(useSurveyResponseStore.getState().getOptionText('q1', 'opt-a')).toBe('기타 답변');
  });

  it('현재 편집값이 저장값보다 우선한다', () => {
    const store = useSurveyResponseStore.getState();
    store.setOptionText('q1', 'opt-a', '방금 타이핑');
    store.seedOptionTexts({ q1: { 'opt-a': '옛 저장값', 'opt-b': '보존' } });
    expect(useSurveyResponseStore.getState().getOptionText('q1', 'opt-a')).toBe('방금 타이핑');
    expect(useSurveyResponseStore.getState().getOptionText('q1', 'opt-b')).toBe('보존');
  });
});
