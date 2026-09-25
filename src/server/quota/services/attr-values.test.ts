import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: {} }));
// data-scope 가 끌고 오는 세션 판정은 이 질의와 무관 — 모듈 로드만 막는다.
vi.mock('@/lib/auth/guest-viewer', () => ({ isGuestViewer: vi.fn() }));

import { buildAttrValuesQuery } from './attr-values';

describe('buildAttrValuesQuery', () => {
  // 2026-09-21 프로덕션 500 — 같은 btrim(attrs ->> $n) 식을 select·where·order by 에 각각 쓰면
  // 키가 $1·$4·$5 로 따로 바인딩되어 Postgres 가 서로 다른 식으로 본다. SELECT DISTINCT 는
  // ORDER BY 식이 select 목록에 있어야 하므로 질의 자체가 거부된다. mock DB 로는 안 잡히던 결함이라
  // SQL 모양을 직접 못박는다.
  it('attrs 키를 한 번만 바인딩한다', () => {
    const { sql, params } = buildAttrValuesQuery(drizzle.mock(), 's1', '산업 분야', 'real').toSQL();

    expect(params.filter((p) => p === '산업 분야')).toHaveLength(1);
    expect(sql.match(/->>/g)).toHaveLength(1);
  });

  it('정렬·중복 제거·빈 값 제외는 안쪽 질의의 별칭 열에 건다', () => {
    const { sql, params } = buildAttrValuesQuery(drizzle.mock(), 's1', '산업 분야', 'test').toSQL();

    expect(sql).toMatch(/^select distinct "value" from \(select btrim\(/);
    expect(sql).toContain(`"trimmed" where "value" <> '' order by "value" limit`);
    expect(params).toEqual(['산업 분야', 's1', true, 51]);
  });
});
