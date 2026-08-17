import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactColumnScheme } from '@/db/schema/schema-types';

// db.select() 호출 순서대로 결과를 돌려주는 큐 기반 mock.
// 체인 메서드(from/where/orderBy/limit)는 전부 자기 자신을 반환하고,
// await 시점에 selectResults.shift() 를 resolve 한다.
const selectResults: unknown[][] = [];
const orderByArgs: unknown[] = [];

vi.mock('@/db', () => {
  const makeChain = () => {
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: (arg: unknown) => {
        orderByArgs.push(arg);
        return chain;
      },
      limit: () => chain,
      then: (resolve: (rows: unknown[]) => void) => {
        resolve(selectResults.shift() ?? []);
      },
    };
    return chain;
  };
  return {
    db: {
      select: vi.fn(makeChain),
      selectDistinct: vi.fn(makeChain),
    },
  };
});

import {
  ATTR_VALUES_CHECKBOX_LIMIT,
  ForbiddenAttrColumnError,
  listContactAttrValues,
} from './contact-attr-values.service';

function schemeWith(columns: ContactColumnScheme['columns']): ContactColumnScheme {
  return { version: 1, headerRow: 1, columns };
}

const visibleScheme = schemeWith([
  { key: 'resid', label: '번호', source: 'system.resid', order: 1 },
  { key: 'c1', label: '기업유형', source: 'attrs.기업유형', order: 2 },
  { key: 'c2', label: '숨김컬럼', source: 'attrs.숨김컬럼', order: 3, hidden: true },
]);

describe('listContactAttrValues', () => {
  beforeEach(() => {
    selectResults.length = 0;
    orderByArgs.length = 0;
    vi.clearAllMocks();
  });

  it('DISTINCT 의 ORDER BY 는 위치 지정(1) — 파라미터 식이면 PG 가 select list 불일치로 거부', async () => {
    // 회귀: ORDER BY attrs->>$n 은 select list 의 attrs->>$m 과 다른 식으로
    // 취급되어 "for SELECT DISTINCT, ORDER BY expressions must appear in
    // select list" 에러가 난다 (staging 재현 완료). ORDER BY 1 로 고정한다.
    selectResults.push([{ scheme: visibleScheme }]);
    selectResults.push([]);

    await listContactAttrValues({ surveyId: 'sv-1', attrsKey: '기업유형', scope: 'real' });

    expect(orderByArgs).toHaveLength(1);
    const rendered = new PgDialect().sqlToQuery(orderByArgs[0] as SQL);
    expect(rendered.sql.trim()).toBe('1');
    expect(rendered.params).toEqual([]);
  });

  it('스킴에 있는 attrs 컬럼 → distinct 값 목록, truncated=false', async () => {
    selectResults.push([{ scheme: visibleScheme }]);
    selectResults.push([{ v: '상장' }, { v: '코스닥' }]);

    const result = await listContactAttrValues({
      surveyId: 'sv-1',
      attrsKey: '기업유형',
      scope: 'real',
    });

    expect(result).toEqual({ values: ['상장', '코스닥'], truncated: false });
  });

  it('limit+1 건 조회 시 truncated=true, values 는 limit 개로 절단', async () => {
    selectResults.push([{ scheme: visibleScheme }]);
    selectResults.push(
      Array.from({ length: ATTR_VALUES_CHECKBOX_LIMIT + 1 }, (_, i) => ({ v: `값${i}` })),
    );

    const result = await listContactAttrValues({
      surveyId: 'sv-1',
      attrsKey: '기업유형',
      scope: 'real',
    });

    expect(result.truncated).toBe(true);
    expect(result.values).toHaveLength(ATTR_VALUES_CHECKBOX_LIMIT);
  });

  it('값 목록은 자연 정렬 — 숫자 접미사가 사전순이 아니라 숫자순', async () => {
    // SQL ORDER BY 1 은 텍스트 사전순('값1','값10','값2')으로 온다. 서비스가
    // localeCompare numeric 으로 재정렬해 체크박스 목록이 자연스럽게 보이게 한다.
    selectResults.push([{ scheme: visibleScheme }]);
    selectResults.push([{ v: '값1' }, { v: '값10' }, { v: '값2' }]);

    const result = await listContactAttrValues({
      surveyId: 'sv-1',
      attrsKey: '기업유형',
      scope: 'real',
    });

    expect(result.values).toEqual(['값1', '값2', '값10']);
  });

  it('스킴에 없는 attrs key → ForbiddenAttrColumnError', async () => {
    selectResults.push([{ scheme: visibleScheme }]);

    await expect(
      listContactAttrValues({ surveyId: 'sv-1', attrsKey: '없는컬럼', scope: 'real' }),
    ).rejects.toBeInstanceOf(ForbiddenAttrColumnError);
  });

  it('hidden 컬럼 → ForbiddenAttrColumnError (URL 직접 조작 가드)', async () => {
    selectResults.push([{ scheme: visibleScheme }]);

    await expect(
      listContactAttrValues({ surveyId: 'sv-1', attrsKey: '숨김컬럼', scope: 'real' }),
    ).rejects.toBeInstanceOf(ForbiddenAttrColumnError);
  });

  it('스킴 자체가 없으면 ForbiddenAttrColumnError', async () => {
    selectResults.push([]);

    await expect(
      listContactAttrValues({ surveyId: 'sv-1', attrsKey: '기업유형', scope: 'real' }),
    ).rejects.toBeInstanceOf(ForbiddenAttrColumnError);
  });
});
