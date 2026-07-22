import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import { completedResponse, notDeletedResponse, notTestResponse } from '@/data/response-filters';

const dialect = new PgDialect();

describe('response-filters', () => {
  it('completedResponse는 status = completed 조건이다', () => {
    const query = dialect.sqlToQuery(completedResponse);
    expect(query.sql).toContain('"status"');
    expect(query.params).toEqual(['completed']);
  });

  it('notDeletedResponse는 deleted_at IS NULL 조건이다', () => {
    const query = dialect.sqlToQuery(notDeletedResponse);
    expect(query.sql).toContain('"deleted_at" is null');
  });

  it('notTestResponse는 mode와 무관한 실제 응답 is_test=false 조건이다', () => {
    const query = dialect.sqlToQuery(notTestResponse);
    expect(query.sql).toContain('"is_test"');
    expect(query.params).toEqual([false]);
  });
});
