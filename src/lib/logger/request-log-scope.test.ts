import { describe, expect, it } from 'vitest';

import {
  bindRequestLog,
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
