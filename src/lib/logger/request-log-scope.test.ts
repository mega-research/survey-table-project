import { describe, expect, it } from 'vitest';

import {
  bindRequestLog,
  loggableUuid,
  readContentLength,
  runWithRequestLogScope,
} from '@/lib/logger/request-log-scope';
import type { LogContext } from '@/lib/logger/with-context';

describe('요청 로그 범위', () => {
  it('범위 안에서 실은 필드는 그 범위의 묶음에 쌓인다 — await 를 건너도 같다', async () => {
    const bound: LogContext = {};
    await runWithRequestLogScope(bound, async () => {
      bindRequestLog({ responseId: 'resp-1' });
      await new Promise((resolve) => setTimeout(resolve, 1));
      bindRequestLog({ surveyId: 'svy-1' });
    });

    expect(bound).toEqual({ responseId: 'resp-1', surveyId: 'svy-1' });
  });

  it('범위 밖(RSC 직접 호출·잡·테스트)에서 부르면 아무 일도 하지 않는다', () => {
    expect(() => bindRequestLog({ surveyId: 'svy-1' })).not.toThrow();
  });

  it('겹쳐 도는 범위끼리 섞이지 않는다', async () => {
    const a: LogContext = {};
    const b: LogContext = {};
    await Promise.all([
      runWithRequestLogScope(a, async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        bindRequestLog({ responseId: 'a' });
      }),
      runWithRequestLogScope(b, async () => {
        bindRequestLog({ responseId: 'b' });
      }),
    ]);

    expect(a).toEqual({ responseId: 'a' });
    expect(b).toEqual({ responseId: 'b' });
  });
});

describe('readContentLength', () => {
  it('0 이상의 정수만 돌려준다', () => {
    expect(readContentLength(new Headers({ 'content-length': '2048' }))).toBe(2048);
    expect(readContentLength(new Headers({ 'content-length': '0' }))).toBe(0);
  });

  it('없거나 숫자가 아니거나 음수면 undefined', () => {
    expect(readContentLength(new Headers())).toBeUndefined();
    expect(readContentLength(new Headers({ 'content-length': 'abc' }))).toBeUndefined();
    expect(readContentLength(new Headers({ 'content-length': '-1' }))).toBeUndefined();
    expect(readContentLength(new Headers({ 'content-length': '12.5' }))).toBeUndefined();
    expect(readContentLength(undefined)).toBeUndefined();
  });
});

describe('loggableUuid', () => {
  it('UUID 모양이면 그대로 돌려준다 (대소문자 무관)', () => {
    expect(loggableUuid('11111111-2222-4333-8444-555555555555')).toBe(
      '11111111-2222-4333-8444-555555555555',
    );
    expect(loggableUuid('AAAAAAAA-2222-4333-8444-555555555555')).toBe(
      'AAAAAAAA-2222-4333-8444-555555555555',
    );
  });

  it('이메일·전화번호·빈 값·문자열이 아닌 값·앞뒤에 덧붙인 값은 undefined', () => {
    for (const planted of [
      'person@example.com',
      '010-1234-5678',
      '',
      'x'.repeat(129),
      '11111111-2222-4333-8444-555555555555 person@example.com',
      'person@example.com\n11111111-2222-4333-8444-555555555555',
      123,
      null,
      undefined,
      { id: '11111111-2222-4333-8444-555555555555' },
    ]) {
      expect(loggableUuid(planted)).toBeUndefined();
    }
  });
});
