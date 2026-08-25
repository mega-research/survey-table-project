import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { mailRecipients } from '@/db/schema/mail';

describe('mail recipient dispatch recovery schema', () => {
  it('재시도와 lease 인수를 위한 durable timestamps와 token을 가진다', () => {
    const columns = getTableColumns(mailRecipients);

    expect(columns).toHaveProperty('sendAttemptedAt');
    expect(columns).toHaveProperty('sendLeaseToken');
    expect(columns).toHaveProperty('sendLeaseExpiresAt');
    expect(columns).toHaveProperty('sendPayloadSnapshot');
  });
});
