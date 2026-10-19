import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from './pg-error';

describe('isUniqueViolation', () => {
  it('드라이버 에러의 SQLSTATE 23505', () => {
    expect(isUniqueViolation({ code: '23505', message: 'duplicate key' })).toBe(true);
  });

  it('drizzle 이 감싼 에러는 cause 의 SQLSTATE 로 판정한다', () => {
    const driver = Object.assign(new Error('duplicate key value violates constraint'), {
      code: '23505',
    });
    const wrapped = new Error('Failed query: insert into "contact_assignments" …', {
      cause: driver,
    });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it('다른 에러는 아니다', () => {
    expect(isUniqueViolation(new Error('Failed query', { cause: { code: '23503' } }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
