import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import { completedResponse, notDeletedResponse } from '@/data/response-filters';

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
});
