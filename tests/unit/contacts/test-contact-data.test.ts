import { describe, expect, it } from 'vitest';

import {
  ensureTestContactColumns,
  resolveTestContactFieldBindings,
} from '@/lib/contacts/test-contact-columns';
import { TEST_CONTACT_FIXTURES } from '@/lib/contacts/test-contact-fixtures';

describe('테스트 대상자 기본 데이터', () => {
  it('20개의 명백한 합성 fixture를 제공한다', () => {
    expect(TEST_CONTACT_FIXTURES).toHaveLength(20);
    expect(new Set(TEST_CONTACT_FIXTURES.map((row) => row.name)).size).toBe(20);
    expect(TEST_CONTACT_FIXTURES.every((row) => row.phone.startsWith('000-'))).toBe(true);
  });

  it('실제 스킴을 변경하지 않고 빠진 네 의미 컬럼만 보충한다', () => {
    const real = {
      version: 1,
      headerRow: 1,
      columns: [
        {
          key: '담당자',
          label: '담당자',
          source: 'pii.담당자',
          piiType: 'name',
          order: 1,
        },
      ],
    } as const;
    const test = ensureTestContactColumns(real, null);
    expect(test).not.toBe(real);
    expect(test.columns.filter((column) => column.piiType === 'name')).toHaveLength(1);
    expect(test.columns.some((column) => column.source === 'attrs.test_company')).toBe(true);
    expect(test.columns.some((column) => column.piiType === 'phone')).toBe(true);
    expect(test.columns.some((column) => column.piiType === 'email')).toBe(true);
    expect(test.columns.map((column) => column.source)).toEqual(
      expect.arrayContaining([
        'system.resid',
        'system.contact_result',
        'system.email_count',
        'system.web',
        'system.contact_owner',
      ]),
    );
    expect(real.columns).toHaveLength(1);
  });

  it('보관된 테스트 스킴이 있으면 실제 스킴을 다시 복사하지 않는다', () => {
    const saved = {
      version: 1,
      headerRow: 1,
      columns: [{ key: 'custom', label: '사용자 컬럼', source: 'attrs.custom', order: 1 }],
    } as const;
    const result = ensureTestContactColumns(null, saved);
    expect(result.columns.map((column) => column.source)).toEqual(
      expect.arrayContaining([
        'attrs.custom',
        'system.resid',
        'system.contact_result',
        'system.email_count',
        'system.web',
        'system.contact_owner',
      ]),
    );
    expect(result).not.toBe(saved);
  });

  it('복사된 의미 컬럼의 실제 저장 key를 해석한다', () => {
    const scheme = ensureTestContactColumns(
      {
        version: 1,
        headerRow: 1,
        columns: [
          {
            key: '담당자',
            label: '담당자',
            source: 'pii.담당자',
            piiType: 'representative',
            order: 1,
          },
          { key: '소속', label: '회사명', source: 'attrs.소속', order: 2 },
        ],
      },
      null,
    );
    expect(resolveTestContactFieldBindings(scheme)).toMatchObject({
      name: { columnKey: '담당자', fieldType: 'representative' },
      company: { columnKey: '소속' },
    });
  });

  it('PII와 시스템 회사 라벨은 attrs 회사 컬럼으로 오인하지 않고 기본 컬럼을 보충한다', () => {
    const scheme = ensureTestContactColumns(
      {
        version: 1,
        headerRow: 1,
        columns: [
          {
            key: '회사 담당자',
            label: '회사 담당자',
            source: 'pii.회사 담당자',
            piiType: 'representative',
            order: 1,
          },
          { key: '회사', label: '회사', source: 'system.contact_owner', order: 2 },
        ],
      },
      null,
    );

    expect(scheme.columns.some((column) => column.source === 'attrs.test_company')).toBe(true);
    expect(resolveTestContactFieldBindings(scheme).company).toEqual({
      columnKey: 'test_company',
    });
  });
});
