import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import * as route from '@/app/api/webhooks/resend/route';
import { REPLY_FORWARD_STEP_TIMEOUTS_MS } from '@/server/mail/services/reply-forward';

describe('Resend webhook Next route exports', () => {
  it('Next가 허용하는 POST handler와 실행 시간 제한만 export한다', () => {
    expect(Object.keys(route).sort()).toEqual(['POST', 'maxDuration']);
  });

  it('실행 시간 제한을 명시한다 — 플랫폼 기본값에 기대지 않는다', () => {
    expect(route.maxDuration).toBe(300);
  });

  it('회신 전달의 단계별 제한 시간을 다 써도 실행 시간 제한 안에 끝난다', () => {
    // 가장 오래 걸리는 길: 받은 메일 조회 → 원본 내려받기 → 받은 그대로 발송(거절) → 첨부를 뺀 재발송.
    const { lookup, download, send, sendWithoutAttachments } = REPLY_FORWARD_STEP_TIMEOUTS_MS;
    const worstCaseMs = lookup + download + send + sendWithoutAttachments;
    // 남는 시간은 DB 조회·장부 기록·원본 풀기의 몫이다.
    const marginMs = 60_000;

    expect(worstCaseMs + marginMs).toBeLessThanOrEqual(route.maxDuration * 1000);
  });
});
