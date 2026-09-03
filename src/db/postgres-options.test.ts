import { describe, expect, it } from 'vitest';

import {
  DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  DATABASE_LOCK_TIMEOUT_MS,
  DATABASE_STATEMENT_TIMEOUT_MS,
  createPostgresOptions,
} from '@/db/postgres-options';

describe('createPostgresOptions', () => {
  it('production 에서는 서버리스 인스턴스당 pool 을 5로 제한한다', () => {
    const options = createPostgresOptions('production');

    expect(options).toMatchObject({
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      max_lifetime: 60 * 30,
    });
  });

  it('DB 쿼리가 Vercel 300초 timeout 전에 실패하도록 세션 timeout 을 건다', () => {
    const options = createPostgresOptions('production');

    expect(options.connection).toMatchObject({
      statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
      lock_timeout: DATABASE_LOCK_TIMEOUT_MS,
    });
    expect(DATABASE_STATEMENT_TIMEOUT_MS).toBeLessThan(300_000);
  });
});
