import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { results, wheres } = vi.hoisted(() => ({
  results: [] as unknown[][],
  wheres: [] as unknown[],
}));

/** select 가 불릴 때마다 results 에서 한 벌씩 꺼내 준다 — 설문 행 조회 → 대상자 조회 순서 */
vi.mock('@/db', () => ({
  db: {
    select: () => {
      const rows = results.shift() ?? [];
      const chain = {
        from: () => chain,
        where: (w: unknown) => {
          wheres.push(w);
          return chain;
        },
        orderBy: () => chain,
        limit: () => Promise.resolve(rows),
      };
      return chain;
    },
  },
}));
vi.mock('./send-address', () => ({ loadSendEmailForTarget: vi.fn(async () => 'tester@example.com') }));

import { getFirstTestTargetSample } from './contact-sample';

const dialect = new PgDialect();
const TARGET_ROW = { id: 'ct-test', attrs: { 전시회명: 'A' }, inviteCode: 'tst999', resid: 1 };

describe('getFirstTestTargetSample — 미리보기·테스트 발송이 쓰는 첫 테스트 대상자', () => {
  beforeEach(() => {
    results.length = 0;
    wheres.length = 0;
  });

  it('테스트 모드가 켜져 있으면 테스트 파티션의 첫 대상자를 돌려준다', async () => {
    results.push([{ testModeEnabled: true }], [TARGET_ROW]);

    const sample = await getFirstTestTargetSample('sv-1');

    expect(sample).toEqual({ ...TARGET_ROW, email: 'tester@example.com' });
    // 대상자 조회는 is_test = true 로 건다(브라우저가 실데이터를 보는 중이어도)
    const targetQuery = dialect.sqlToQuery(wheres[1] as never);
    expect(targetQuery.sql).toContain('is_test');
    expect(targetQuery.params).toContain(true);
    expect(targetQuery.params).not.toContain(false);
  });

  it('테스트 모드가 꺼져 있으면 대상자를 읽지 않고 null 이다 — 꺼진 설문의 테스트 링크는 열리지 않는다', async () => {
    results.push([{ testModeEnabled: false }], [TARGET_ROW]);

    expect(await getFirstTestTargetSample('sv-1')).toBeNull();
    expect(wheres).toHaveLength(1);
  });

  it('테스트 대상자가 없거나 설문이 없으면 null 이다', async () => {
    results.push([{ testModeEnabled: true }], []);
    expect(await getFirstTestTargetSample('sv-1')).toBeNull();

    results.length = 0;
    results.push([]);
    expect(await getFirstTestTargetSample('sv-none')).toBeNull();
  });
});
