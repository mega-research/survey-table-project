import { describe, expect, it } from 'vitest';

import type { ContactTargetEditChange } from '@/shared/contracts/contacts';

import { visibleContactTargetEditChanges } from './contact-target-edit-logs';

describe('visibleContactTargetEditChanges — 게스트 화면 거르기', () => {
  const assignment: ContactTargetEditChange = {
    kind: 'assignment',
    before: null,
    after: { id: 'a', name: '10차' },
  };

  it('게스트는 컨택원 변경을 받지 않는다', () => {
    const memo: ContactTargetEditChange = { kind: 'memo', before: '', after: 'x' };
    expect(visibleContactTargetEditChanges([memo, assignment], { isGuest: true })).toEqual([memo]);
    expect(visibleContactTargetEditChanges([assignment], { isGuest: true })).toEqual([]);
  });

  it('게스트가 아니면 그대로', () => {
    expect(visibleContactTargetEditChanges([assignment], { isGuest: false })).toEqual([assignment]);
  });
});
