import { describe, expect, it } from 'vitest';

import { parseCompletionTarget } from './completion-target-card';

describe('parseCompletionTarget — 완료 목표 입력', () => {
  it('정수 글자를 목표로 읽는다 — 천 단위 쉼표와 앞뒤 공백은 정돈한다', () => {
    expect(parseCompletionTarget('1100')).toBe(1100);
    expect(parseCompletionTarget(' 1,100 ')).toBe(1100);
    expect(parseCompletionTarget('1')).toBe(1);
  });

  it('빈 칸·0·음수·소수·글자는 저장할 수 없는 값(null)이다', () => {
    // 해석 못 한 입력을 0 이나 「목표 없음」으로 조용히 바꾸지 않는다 — 저장 버튼이 막힌다.
    expect(parseCompletionTarget('')).toBeNull();
    expect(parseCompletionTarget('0')).toBeNull();
    expect(parseCompletionTarget('-3')).toBeNull();
    expect(parseCompletionTarget('10.5')).toBeNull();
    expect(parseCompletionTarget('천백')).toBeNull();
    expect(parseCompletionTarget('1e3')).toBeNull();
  });

  it('서버가 받는 상한을 넘으면 null 이다', () => {
    expect(parseCompletionTarget('10000000')).toBe(10_000_000);
    expect(parseCompletionTarget('10000001')).toBeNull();
  });
});
