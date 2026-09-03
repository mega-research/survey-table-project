import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { firstEmailRowByTarget, selectEmailPiiRows } from '@/lib/crypto/contact-pii-repo';

// selectEmailPiiRows 는 주입된 executor 만 쓴다 — 전역 db 는 로드만 막는다.
vi.mock('@/db', () => ({ db: {} }));

const dialect = new PgDialect();

/** select(...).from(contactPii).where(...).orderBy(...) 체인 stub — where/orderBy 인자를 캡처한다. */
function makeExecutor(rows: Array<Record<string, unknown>>) {
  const captured: { where: unknown; orderBy: unknown[] } = { where: null, orderBy: [] };
  const executor = {
    select: vi.fn(() => ({
      from: () => ({
        where: (where: unknown) => {
          captured.where = where;
          return {
            orderBy: async (...args: unknown[]) => {
              captured.orderBy = args;
              return rows;
            },
          };
        },
      }),
    })),
  };
  return { executor: executor as never, select: executor.select, captured };
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('selectEmailPiiRows', () => {
  it('대상 id 가 비면 쿼리 없이 빈 배열을 돌려준다', async () => {
    const { executor, select } = makeExecutor([]);

    await expect(selectEmailPiiRows(executor, [])).resolves.toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("field_type='email' 과 contact_target_id IN (...) 조건으로 조회한다", async () => {
    const { executor, captured } = makeExecutor([]);

    await selectEmailPiiRows(executor, [A, B]);

    const query = dialect.sqlToQuery(captured.where as never);
    expect(query.sql).toContain('"field_type" = ');
    expect(query.sql).toContain('"contact_target_id" in (');
    expect(query.params).toEqual(['email', A, B]);
  });

  it('contact_target_id, column_key 오름차순으로 정렬한다 — 첫 컬럼 선택의 전제', async () => {
    const { executor, captured } = makeExecutor([]);

    await selectEmailPiiRows(executor, [A]);

    const [first, second] = captured.orderBy.map((o) => dialect.sqlToQuery(o as never).sql);
    expect(first).toBe('"contact_pii"."contact_target_id" asc');
    expect(second).toBe('"contact_pii"."column_key" asc');
    expect(captured.orderBy).toHaveLength(2);
  });
});

describe('firstEmailRowByTarget', () => {
  it('정렬된 행에서 컨택당 첫 행만 남긴다', () => {
    const rows = [
      { contactTargetId: A, columnKey: 'email', cipher: 'a1' },
      { contactTargetId: A, columnKey: 'email2', cipher: 'a2' },
      { contactTargetId: B, columnKey: 'mail', cipher: 'b1' },
    ];

    const first = firstEmailRowByTarget(rows);

    expect([...first.keys()]).toEqual([A, B]);
    expect(first.get(A)?.cipher).toBe('a1');
    expect(first.get(B)?.cipher).toBe('b1');
  });

  it('빈 입력이면 빈 Map', () => {
    expect(firstEmailRowByTarget([]).size).toBe(0);
  });
});
