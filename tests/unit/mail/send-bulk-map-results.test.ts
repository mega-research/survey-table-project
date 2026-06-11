import { describe, expect, it } from 'vitest';

import { mapBatchResults } from '@/lib/mail/send-bulk';
import type { BulkRecipientInput } from '@/lib/mail/send-bulk';

function makeRecipients(ids: string[]): BulkRecipientInput[] {
  return ids.map((id) => ({
    recipientId: id,
    to: `${id}@example.com`,
    subject: 's',
    html: '<p>h</p>',
  }));
}

describe('mapBatchResults', () => {
  it('모두 성공 — data.data 를 순서대로 매핑하고 재시도 없음', () => {
    const recipients = makeRecipients(['r0', 'r1', 'r2']);
    const { resolved, retryIndices } = mapBatchResults(
      recipients,
      [{ id: 'm0' }, { id: 'm1' }, { id: 'm2' }],
      [],
    );

    expect(retryIndices).toEqual([]);
    expect(resolved).toEqual([
      { recipientId: 'r0', resendMessageId: 'm0' },
      { recipientId: 'r1', resendMessageId: 'm1' },
      { recipientId: 'r2', resendMessageId: 'm2' },
    ]);
  });

  it('부분 실패 — 성공분은 확정 매핑, 실패 인덱스만 재시도 대상으로 분리(중복 발송 방지)', () => {
    // index 1 만 실패. data.data 는 성공분만 dense 로 담김(m0, m2).
    const recipients = makeRecipients(['r0', 'r1', 'r2']);
    const { resolved, retryIndices } = mapBatchResults(
      recipients,
      [{ id: 'm0' }, { id: 'm2' }],
      [{ index: 1, message: 'rate limited' }],
    );

    // 성공한 r0, r2 는 batch 메시지 id 를 보존 — 재발송하지 않는다.
    expect(resolved).toEqual([
      { recipientId: 'r0', resendMessageId: 'm0' },
      { recipientId: 'r2', resendMessageId: 'm2' },
    ]);
    // 실패한 index 1(r1) 만 재시도.
    expect(retryIndices).toEqual([1]);
  });

  it('여러 실패 인덱스 — dense 성공배열 커서가 실패 위치를 건너뛴다', () => {
    // index 0, 2 실패. 성공은 index 1, 3 → data.data = [m1, m3].
    const recipients = makeRecipients(['r0', 'r1', 'r2', 'r3']);
    const { resolved, retryIndices } = mapBatchResults(
      recipients,
      [{ id: 'm1' }, { id: 'm3' }],
      [
        { index: 0, message: 'e0' },
        { index: 2, message: 'e2' },
      ],
    );

    expect(resolved).toEqual([
      { recipientId: 'r1', resendMessageId: 'm1' },
      { recipientId: 'r3', resendMessageId: 'm3' },
    ]);
    expect(retryIndices).toEqual([0, 2]);
  });

  it('성공인데 id 누락 — errorReason 으로 확정(재시도 아님)', () => {
    const recipients = makeRecipients(['r0']);
    const { resolved, retryIndices } = mapBatchResults(recipients, [{}], []);

    expect(retryIndices).toEqual([]);
    expect(resolved).toEqual([
      { recipientId: 'r0', errorReason: 'Resend 응답 id 누락' },
    ]);
  });
});
