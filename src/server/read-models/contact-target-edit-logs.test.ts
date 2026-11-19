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
  it('담당 범위를 가르는 열의 변경은 범위 게스트에게 싣지 않는다 — 다른 업체 이름이 들어 있다', () => {
    const moved: ContactTargetEditChange = {
      kind: 'attr',
      key: '실사업체',
      label: '실사업체',
      before: '프라임',
      after: '프롬',
    };
    const renamed: ContactTargetEditChange = {
      kind: 'attr',
      key: '기업체명',
      label: '기업체명',
      before: '옛 이름',
      after: '새 이름',
    };
    expect(
      visibleContactTargetEditChanges([moved, renamed], { isGuest: true, hiddenAttrsKey: '실사업체' }),
    ).toEqual([renamed]);
    // 범위가 없는 게스트·관리자는 그대로 본다
    expect(visibleContactTargetEditChanges([moved], { isGuest: true })).toEqual([moved]);
    expect(
      visibleContactTargetEditChanges([moved], { isGuest: false, hiddenAttrsKey: '실사업체' }),
    ).toEqual([moved]);
  });
});
