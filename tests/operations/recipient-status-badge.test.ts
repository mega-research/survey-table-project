import { describe, expect, it } from 'vitest';

import { mailRecipientStatusValues } from '@/db/schema/mail';
import { STATUS_LABEL } from '@/components/operations/mail-campaign/recipient-status-badge';

describe('recipient-status-badge STATUS_LABEL', () => {
  it('모든 MailRecipientStatus 값에 라벨/톤이 매핑되어 있다', () => {
    for (const status of mailRecipientStatusValues) {
      expect(STATUS_LABEL[status], `누락된 status: ${status}`).toBeDefined();
      expect(STATUS_LABEL[status].label.length).toBeGreaterThan(0);
      expect(STATUS_LABEL[status].tone.length).toBeGreaterThan(0);
    }
  });
});
