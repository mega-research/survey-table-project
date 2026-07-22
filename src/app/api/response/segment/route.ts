import { NextRequest, NextResponse } from 'next/server';

import { RecordVisibilitySegmentInput } from '@/features/survey-response/domain/lifecycle';
import { recordVisibilitySegment } from '@/features/survey-response/server/services/lifecycle.service';
import { getTrustedClientIpOrNull } from '@/lib/rate-limit/client-ip';
import { getRateLimiter } from '@/lib/rate-limit/rate-limiter';

/**
 * Page Visibility 세그먼트 수신 엔드포인트.
 * 클라이언트가 navigator.sendBeacon / fetch(keepalive)로 호출한다.
 * body: { responseId: string, action: 'hide' | 'show' }
 *
 * REST 엔드포인트라 oRPC 미들웨어를 거치지 않으므로 진입부에서 직접 rate limit 한다.
 */
export async function POST(req: NextRequest) {
  // 신뢰 IP 추출 불가면 fail-closed. 단일 'unknown' 버킷 공유로 인한 상호 잠식/약 DoS 차단.
  const ip = getTrustedClientIpOrNull(req.headers);
  if (ip === null) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }
  const { success } = await getRateLimiter().limit(`response-segment:${ip}`);
  if (!success) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = RecordVisibilitySegmentInput.safeParse(body);
  if (!parsed.success || parsed.data.responseId.trim() === '') {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  try {
    await recordVisibilitySegment(parsed.data);
  } catch (err) {
    console.error('[segment] 기록 실패:', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
