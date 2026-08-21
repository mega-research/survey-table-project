import { describe, expect, it } from 'vitest';

import type { MailRecipientStatus } from '@/shared/contracts/mail';
import { mailRecipientStatusValues } from '@/shared/contracts/mail';
import {
  recipientStatusMeta,
  STATUS_LABEL,
} from '@/components/operations/mail-campaign/recipient-status-badge';

describe('recipient-status-badge STATUS_LABEL', () => {
  it('모든 MailRecipientStatus 값에 라벨/톤이 매핑되어 있다', () => {
    for (const status of mailRecipientStatusValues) {
      expect(STATUS_LABEL[status], `누락된 status: ${status}`).toBeDefined();
      expect(STATUS_LABEL[status].label.length).toBeGreaterThan(0);
      expect(STATUS_LABEL[status].tone.length).toBeGreaterThan(0);
    }
  });
});

describe('recipientStatusMeta', () => {
  it('정의된 status 는 STATUS_LABEL 메타를 그대로 반환한다', () => {
    for (const status of mailRecipientStatusValues) {
      expect(recipientStatusMeta(status)).toEqual(STATUS_LABEL[status]);
    }
  });

  it('정의되지 않은 status 는 status 문자열 라벨 + 중립 톤으로 폴백한다', () => {
    const unknown = '___unknown___' as MailRecipientStatus;
    const meta = recipientStatusMeta(unknown);
    expect(meta.label).toBe('___unknown___');
    expect(meta.tone.length).toBeGreaterThan(0);
  });
});
