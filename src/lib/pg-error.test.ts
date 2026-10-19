import { describe, expect, it } from 'vitest';

import { isUniqueViolation, retryOnTxConflict } from './pg-error';

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

describe('retryOnTxConflict', () => {
  const deadlock = () =>
    new Error('Failed query: update …', { cause: Object.assign(new Error('deadlock detected'), { code: '40P01' }) });

  it('교착·직렬화 실패는 다시 실행해 성공을 돌려준다', async () => {
    let calls = 0;
    const result = await retryOnTxConflict(async () => {
      calls++;
      if (calls === 1) throw deadlock();
      if (calls === 2) throw Object.assign(new Error('could not serialize'), { code: '40001' });
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('다른 에러는 다시 실행하지 않는다', async () => {
    let calls = 0;
    await expect(
      retryOnTxConflict(async () => {
        calls++;
        throw Object.assign(new Error('dup'), { code: '23505' });
      }),
    ).rejects.toThrow('dup');
    expect(calls).toBe(1);
  });

  it('횟수를 다 쓰면 마지막 에러를 던진다', async () => {
    let calls = 0;
    await expect(
      retryOnTxConflict(
        async () => {
          calls++;
          throw deadlock();
        },
        { attempts: 2 },
      ),
    ).rejects.toThrow('Failed query');
    expect(calls).toBe(2);
  });
});
