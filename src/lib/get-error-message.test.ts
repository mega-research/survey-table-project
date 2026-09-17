import { describe, expect, it } from 'vitest';

import { getErrorMessage } from '@/lib/get-error-message';

describe('getErrorMessage', () => {
  it('Error 인스턴스면 message 를 반환한다', () => {
    expect(getErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('Error 서브클래스도 message 를 반환한다', () => {
    class CustomError extends Error {}
    expect(getErrorMessage(new CustomError('custom'), 'fallback')).toBe('custom');
  });

  it('빈 message 를 가진 Error 는 빈 문자열을 반환한다', () => {
    expect(getErrorMessage(new Error(''), 'fallback')).toBe('');
  });

  it('문자열이 던져지면 fallback 을 반환한다', () => {
    expect(getErrorMessage('문자열 에러', 'fallback')).toBe('fallback');
  });

  it('unknown 객체가 던져지면 fallback 을 반환한다', () => {
    expect(getErrorMessage({ message: 'not-an-error' }, 'fallback')).toBe('fallback');
  });

  it('null 이면 fallback 을 반환한다', () => {
    expect(getErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('undefined 면 fallback 을 반환한다', () => {
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});
