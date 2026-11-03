import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ContactAttemptHistoryCard } from '@/features/operations/contacts/contact-attempt-history-card';
import type { ContactAttemptRow } from '@/shared/contracts/contacts-io';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('ContactAttemptHistoryCard — 회차 결과', () => {
  it('회차마다 기록자 이메일을 보이고, 기록자 기능 전 회차는 「-」로 보인다', () => {
    const attempts: ContactAttemptRow[] = [
      {
        id: 'a2',
        attemptNo: 2,
        resultCode: '3.비수신',
        note: null,
        createdByEmail: 'caller@local',
        createdAt: new Date('2026-11-03T01:00:00Z'),
      },
      {
        id: 'a1',
        attemptNo: 1,
        resultCode: '13. 독려',
        note: '금일중',
        createdByEmail: null,
        createdAt: new Date('2026-10-27T01:00:00Z'),
      },
    ];
    render(
      <ContactAttemptHistoryCard
        contactTargetId="ct-1"
        surveyId="s-1"
        attempts={attempts}
        resultCodes={[]}
      />,
    );

    expect(screen.getByText('기록자 caller@local')).toBeTruthy();
    expect(screen.getByText('기록자 -')).toBeTruthy();
  });
});
