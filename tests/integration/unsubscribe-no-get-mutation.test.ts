import { describe, expect, it, vi } from 'vitest';

const {
  unsubscribeByTokenMock,
  lookupContactByTokenMock,
  revertUnsubscribeActionMock,
  confirmUnsubscribeActionMock,
} = vi.hoisted(() => ({
  unsubscribeByTokenMock: vi.fn(),
  lookupContactByTokenMock: vi.fn(async () => ({ ok: true, email: 'a@b.com', alreadyUnsubscribed: false })),
  revertUnsubscribeActionMock: vi.fn(),
  confirmUnsubscribeActionMock: vi.fn(),
}));

vi.mock('@/actions/unsubscribe-actions', () => ({
  unsubscribeByToken: unsubscribeByTokenMock,
  lookupContactByToken: lookupContactByTokenMock,
  revertUnsubscribeAction: revertUnsubscribeActionMock,
  confirmUnsubscribeAction: confirmUnsubscribeActionMock,
}));

import UnsubscribePage from '@/app/unsubscribe/[token]/page';

describe('unsubscribe page GET does not mutate', () => {
  it('does not call unsubscribeByToken on initial render', async () => {
    unsubscribeByTokenMock.mockClear();
    await UnsubscribePage({
      params: Promise.resolve({ token: '11111111-1111-4111-8111-111111111111' }),
      searchParams: Promise.resolve({}),
    });
    expect(unsubscribeByTokenMock).not.toHaveBeenCalled();
  });
});
