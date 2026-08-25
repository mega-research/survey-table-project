import { describe, expect, it } from 'vitest';

import { normalizeContactColumnScheme } from '@/lib/operations/contacts-format';
import { quotaTone } from '@/lib/quota/quota-status-calc';
import { buildQuotaStatus } from '@/lib/quota/quota-status-calc';
import { normalizeQuotaConfig } from '@/lib/quota/normalize';

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

  it('반환값은 columns 를 무보호로 읽어도 안전하다 — 브랜디드 타입의 런타임 근거', () => {
    // NormalizedContactColumnScheme 은 이 함수만 만들 수 있고, 소비 함수는 그 타입만 받는다.
    // 타입 계약이 성립하려면 어떤 입력이 와도 columns 가 배열이어야 한다.
    const inputs: unknown[] = [
      { version: 1, headerRow: 1 },
      { version: 1, headerRow: 1, columns: null },
      { version: 1, headerRow: 1, columns: 'oops' },
      { version: 1, headerRow: 1, columns: 42 },
      { version: 1, headerRow: 1, columns: {} },
      { version: 1, headerRow: 1, columns: [] },
    ];
    for (const input of inputs) {
      const result = normalizeContactColumnScheme(input);
      expect(Array.isArray(result?.columns)).toBe(true);
    }
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
    // 드리프트된 저장분. 정규화를 거치지 않으면 buildQuotaStatus 에 넘길 수조차 없다
    // (NormalizedQuotaConfig 브랜드가 컴파일에서 막는다) — 그게 이 방어의 본체다.
    const config = normalizeQuotaConfig({
      enabled: true,
      dimensions: [{ id: 'd1', questionId: 'q1', kind: 'choice', label: '성별' }],
      cells: [{ categoryIds: ['c-unknown'], target: 10 }],
    })!;

    expect(config.dimensions[0]?.categories).toEqual([]);
    expect(() => buildQuotaStatus(config, [])).not.toThrow();
  });

  it('dimensions·cells 가 배열이 아니어도 빈 배열로 낮춘다', () => {
    const config = normalizeQuotaConfig({ enabled: true, dimensions: null, cells: 'oops' })!;
    expect(config.dimensions).toEqual([]);
    expect(config.cells).toEqual([]);
    expect(() => buildQuotaStatus(config, [])).not.toThrow();
  });

  it('categoryIds 가 없는 셀은 버린다 — 셀 키 계산이 join 에서 죽는다', () => {
    const config = normalizeQuotaConfig({
      enabled: true,
      dimensions: [],
      cells: [{ target: 10 }, { categoryIds: ['c-1'], target: 5 }],
    })!;
    expect(config.cells).toHaveLength(1);
  });

  it('quotaTone 은 target 0 을 즉시 마감으로 본다', () => {
    expect(quotaTone(0, 0)).toBe('done');
  });
});
