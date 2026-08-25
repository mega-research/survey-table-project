import { describe, expect, it } from 'vitest';

import { RESID_DEFAULT_LABEL } from '@/lib/operations/contacts-format';
import { ensureTestContactColumns } from '@/server/contacts/services/test-contact-columns';

describe('resid 기본 라벨 — 시스템ID', () => {
  it('기본 라벨 상수는 시스템ID — 고객 엑셀의 NO/ID 류 컬럼과 구분', () => {
    expect(RESID_DEFAULT_LABEL).toBe('시스템ID');
  });

  it('테스트 대상 기본 스킴의 resid 라벨도 시스템ID', () => {
    const scheme = ensureTestContactColumns(null, null);
    const resid = scheme.columns.find((c) => c.source === 'system.resid');
    expect(resid?.label).toBe('시스템ID');
  });
});
