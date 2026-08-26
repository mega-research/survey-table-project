/**
 * UNIQUE 위반 판별 — 겉면이 아니라 원인을 본다.
 *
 * drizzle 은 쿼리 실패를 `Failed query: ...` 메시지의 평범한 Error 로 감싸고 원본
 * PostgresError 를 cause 에 넣는다. 겉면만 보던 시절 이 래핑 때문에 UNIQUE 위반이
 * 도메인 에러로 바뀌지 못하고 500 으로 샜다(티켓 06 팀 이름 중복).
 */
import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from './pg-error';

describe('isUniqueViolation', () => {
  it('드라이버 원본 에러의 SQLSTATE 를 읽는다', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
  });

  it('drizzle 이 감싼 에러도 cause 를 따라가 찾아낸다', () => {
    const wrapped = new Error('Failed query: insert into "teams" ...', {
      cause: Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      }),
    });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it('순환 cause 에 갇히지 않는다', () => {
    const a = new Error('a');
    const b = new Error('b');
    (a as { cause?: unknown }).cause = b;
    (b as { cause?: unknown }).cause = a;
    expect(isUniqueViolation(a)).toBe(false);
  });

  it('UNIQUE 와 무관한 에러는 그대로 흘려보낸다', () => {
    expect(isUniqueViolation(new Error('connection terminated'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });
});
