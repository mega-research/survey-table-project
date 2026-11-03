import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ContactTargetEditHistoryCard } from '@/features/operations/contacts/contact-target-edit-history-card';
import type { ContactTargetEditLogRow } from '@/shared/contracts/contacts-io';

describe('ContactTargetEditHistoryCard — 대상 정보 수정 현황', () => {
  it('기록이 없으면 건수 0 과 「수정 이력이 없습니다」, 남지 않는 경로 안내를 보인다', () => {
    render(<ContactTargetEditHistoryCard rows={[]} />);
    expect(screen.getByText('대상 정보 수정 현황 (0건)')).toBeTruthy();
    expect(screen.getByText('수정 이력이 없습니다.')).toBeTruthy();
    expect(
      screen.getByText('명단 업로드·컨택원 일괄 배정으로 바뀐 값은 여기에 남지 않습니다.'),
    ).toBeTruthy();
  });

  it('한 줄에 누가·요약을, 펼친 자리에 변경 하나당 한 줄을 그린다', () => {
    const rows: ContactTargetEditLogRow[] = [
      {
        id: 'l1',
        action: 'info_edit',
        editorEmail: 'editor@local',
        createdAt: new Date('2026-10-27T00:35:53Z'),
        changes: [
          { kind: 'attr', key: 'a', label: '사업자등록증기업명', before: '-', after: '아리오나트' },
          { kind: 'attr', key: 'b', label: '명단기업명', before: '-', after: '아리오나트' },
        ],
      },
    ];
    render(<ContactTargetEditHistoryCard rows={rows} />);
    expect(screen.getByText('대상 정보 수정 현황 (1건)')).toBeTruthy();
    expect(screen.getByText('editor@local')).toBeTruthy();
    expect(screen.getByText('사업자등록증기업명 - → 아리오나트 외 1개')).toBeTruthy();
    expect(screen.getByText('사업자등록증기업명 - → 아리오나트')).toBeTruthy();
    expect(screen.getByText('명단기업명 - → 아리오나트')).toBeTruthy();
  });
});
