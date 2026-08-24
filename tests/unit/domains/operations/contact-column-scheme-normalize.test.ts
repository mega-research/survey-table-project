import { describe, expect, it } from 'vitest';

import { normalizeContactColumnScheme } from '@/lib/operations/contacts';
import { quotaTone } from '@/lib/operations/quota-status';
import { buildQuotaStatus } from '@/lib/operations/quota-status';
import type { QuotaConfig } from '@/shared/contracts/quota';

/**
 * contact_columns JSONB 드리프트 방어.
 *
 * 실제 사고: columns 키가 없는 객체가 저장돼 있어 진척 보고 페이지의
 * `contactScheme?.columns.find(...)` 가 500 으로 죽었다. 옵셔널 체이닝은 scheme 만
 * 막고 columns 는 막지 않는다.
 */
describe('normalizeContactColumnScheme', () => {
  it('columns 키가 없는 객체는 빈 배열로 보정한다 — 사고 재현 입력', () => {
    const result = normalizeContactColumnScheme({ version: 1, headerRow: 1 });
    expect(result?.columns).toEqual([]);
    // 소비처가 바로 .find 를 불러도 죽지 않아야 한다.
    expect(() => result?.columns.find((c) => c.source === 'system.resid')).not.toThrow();
  });

  it('columns 외 필드는 보존한다 — 스킴을 통째로 버리지 않는다', () => {
    const result = normalizeContactColumnScheme({ version: 2, headerRow: 3 });
    expect(result?.version).toBe(2);
    expect(result?.headerRow).toBe(3);
  });

  it('columns 가 배열이면 그대로 통과시킨다', () => {
    const columns = [{ key: 'a', label: 'A', source: 'attrs.a' }];
    const result = normalizeContactColumnScheme({ version: 1, headerRow: 1, columns });
    expect(result?.columns).toBe(columns);
  });

  it('columns 가 배열이 아닌 값이어도 보정한다', () => {
    expect(normalizeContactColumnScheme({ version: 1, columns: 'oops' })?.columns).toEqual([]);
    expect(normalizeContactColumnScheme({ version: 1, columns: null })?.columns).toEqual([]);
  });

  it('null·비객체·배열은 null 로 낮춘다', () => {
    expect(normalizeContactColumnScheme(null)).toBeNull();
    expect(normalizeContactColumnScheme(undefined)).toBeNull();
    expect(normalizeContactColumnScheme('scheme')).toBeNull();
    expect(normalizeContactColumnScheme([])).toBeNull();
  });
});

/**
 * quota_config 도 JSONB 라 같은 드리프트가 가능하다 — categories 가 없는 차원이
 * 저장돼 있어도 라벨 조회가 죽지 않고 id 로 폴백해야 한다.
 */
describe('quota_config 드리프트 방어', () => {
  it('categories 가 없는 차원이 있어도 집계가 죽지 않는다', () => {
    const config = {
      enabled: true,
      dimensions: [{ id: 'd1', questionId: 'q1', kind: 'choice', label: '성별' }],
      cells: [{ categoryIds: ['c-unknown'], target: 10 }],
    } as unknown as QuotaConfig;

    expect(() => buildQuotaStatus(config, [])).not.toThrow();
  });

  it('quotaTone 은 target 0 을 즉시 마감으로 본다', () => {
    expect(quotaTone(0, 0)).toBe('done');
  });
});
