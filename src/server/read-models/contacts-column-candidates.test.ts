import { describe, expect, it } from 'vitest';

import { buildColumnCandidates } from './contacts';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
    { key: 'contact_owner', label: '컨택원', source: 'system.contact_owner', order: 2 },
  ],
};

describe('buildColumnCandidates — 「현재 컨택원」', () => {
  it('기본(단체 메일 위저드)은 후보에 넣지 않는다', () => {
    expect(buildColumnCandidates(scheme).map((c) => c.source)).not.toContain(
      'system.contact_owner',
    );
  });

  it('조사 대상 목록은 켜서 받는다', () => {
    expect(
      buildColumnCandidates(scheme, { includeContactOwner: true }).map((c) => c.source),
    ).toContain('system.contact_owner');
  });
});
