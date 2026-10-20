import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { encryptPii } from '@/lib/crypto/aes';

import {
  NO_BOUNCED_ADDRESSES,
  allCandidatesBouncedSql,
  bouncedAddressesFromSnapshots,
  firstEmailRowByTarget,
  resolveSendAddresses,
  selectEmailPiiRows,
} from './send-address';

// 행 함수는 주입된 executor 만 쓴다 — 전역 db 는 로드만 막는다.
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
const C = '33333333-3333-4333-8333-333333333333';

const row = (contactTargetId: string, columnKey: string, plain: string | null) => ({
  id: `${contactTargetId}:${columnKey}`,
  contactTargetId,
  columnKey,
  cipher: plain === null ? 'broken-cipher' : encryptPii(plain),
  maskHint: null,
});

describe('selectEmailPiiRows', () => {
  it('대상 id 가 비면 쿼리 없이 빈 배열을 돌려준다', async () => {
    const { executor, select } = makeExecutor([]);

    await expect(selectEmailPiiRows(executor, [], null)).resolves.toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("field_type='email' 과 contact_target_id IN (...) 조건으로 조회한다", async () => {
    const { executor, captured } = makeExecutor([]);

    await selectEmailPiiRows(executor, [A, B], null);

    const query = dialect.sqlToQuery(captured.where as never);
    expect(query.sql).toContain(`"contact_pii"."field_type" = 'email'`);
    expect(query.sql).toContain('"contact_target_id" in (');
    expect(query.params).toEqual([A, B]);
  });

  it('contact_target_id, column_key 오름차순으로 정렬한다 — 첫 칸 선택의 전제', async () => {
    const { executor, captured } = makeExecutor([]);

    await selectEmailPiiRows(executor, [A], null);

    const [first, second] = captured.orderBy.map((o) => dialect.sqlToQuery(o as never).sql);
    expect(first).toBe('"contact_pii"."contact_target_id" asc');
    expect(second).toBe('"contact_pii"."column_key" asc');
    expect(captured.orderBy).toHaveLength(2);
  });

  it('발송 주소 순서가 지정되면 순위에 든 열만 조회하고 그 순위로 정렬한다', async () => {
    const { executor, captured } = makeExecutor([]);

    await selectEmailPiiRows(executor, [A], ['실무자 e-mail', '대표자 e-mail']);

    const where = dialect.sqlToQuery(captured.where as never);
    expect(where.sql).toContain('"contact_pii"."column_key" IN ($2, $3)');
    expect(where.params).toEqual([A, '실무자 e-mail', '대표자 e-mail']);

    const order = dialect.sqlToQuery(captured.orderBy[1] as never);
    expect(order.sql).toBe('CASE "contact_pii"."column_key" WHEN $1 THEN 0 WHEN $2 THEN 1 END asc');
    expect(order.params).toEqual(['실무자 e-mail', '대표자 e-mail']);
  });

  it('열이 하나뿐인 순서도 값마다 바인딩한다 — ANY 배열 바인딩의 길이 1 풀림을 피한다', async () => {
    const { executor, captured } = makeExecutor([]);

    await selectEmailPiiRows(executor, [A], ['실무자 e-mail']);

    const where = dialect.sqlToQuery(captured.where as never);
    expect(where.sql).toContain('"contact_pii"."column_key" IN ($2)');
    expect(where.params).toEqual([A, '실무자 e-mail']);
  });
});

describe('firstEmailRowByTarget', () => {
  it('정렬된 행에서 대상당 첫 행만 남긴다', () => {
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

describe('bouncedAddressesFromSnapshots', () => {
  it('칸 값 그대로와, 주소 하나로 보낸 메일의 주소를 담는다 — 대소문자 무시', () => {
    const bounced = bouncedAddressesFromSnapshots(['Dead@x.com', 'a@x.com / b@x.com', null]);

    expect(bounced.has('dead@x.com')).toBe(true);
    expect(bounced.has('a@x.com / b@x.com')).toBe(true);
    // 여러 주소 한 통의 반송은 어느 주소인지 몰라 주소 단위로 확정하지 않는다.
    expect(bounced.has('a@x.com')).toBe(false);
    expect(bounced.has('live@x.com')).toBe(false);
  });

  it('반송이 없으면 대조하지 않는다', () => {
    expect(NO_BOUNCED_ADDRESSES.has('a@x.com')).toBe(false);
    expect(NO_BOUNCED_ADDRESSES.blindIndexes).toEqual([]);
  });
});

describe('allCandidatesBouncedSql', () => {
  it('반송이 없으면 FALSE — IN () 빈 목록을 만들지 않는다', () => {
    expect(dialect.sqlToQuery(allCandidatesBouncedSql(null, NO_BOUNCED_ADDRESSES)).sql).toBe(
      'FALSE',
    );
  });
});

describe('resolveSendAddresses', () => {
  it('요청한 대상 전부를 판정한다 — 후보 행이 없으면 missing', async () => {
    const { executor } = makeExecutor([row(A, 'email', 'a@x.com')]);

    const result = await resolveSendAddresses(executor, [A, C], null);

    expect(result.get(A)).toEqual({ kind: 'send', columnKey: 'email', email: 'a@x.com' });
    expect(result.get(C)).toEqual({ kind: 'missing' });
  });

  it('1순위 칸 반송 + 2순위 칸 복호화 실패 → bounced (발송과 사전 점검이 같은 판정)', async () => {
    const { executor } = makeExecutor([row(A, 'email', 'dead@x.com'), row(A, 'email2', null)]);

    const result = await resolveSendAddresses(
      executor,
      [A],
      null,
      bouncedAddressesFromSnapshots(['dead@x.com']),
    );

    expect(result.get(A)).toEqual({ kind: 'bounced' });
  });

  it('칸 「a, c」의 주소가 각각 반송이면 bounced', async () => {
    const { executor } = makeExecutor([row(A, 'email', 'a@x.com, c@x.com')]);

    const result = await resolveSendAddresses(
      executor,
      [A],
      null,
      bouncedAddressesFromSnapshots(['a@x.com', 'c@x.com']),
    );

    expect(result.get(A)).toEqual({ kind: 'bounced' });
  });
});
