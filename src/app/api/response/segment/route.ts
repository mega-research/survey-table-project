import { NextRequest, NextResponse } from 'next/server';

import { RecordVisibilitySegmentInput } from '@/features/survey-response/domain/lifecycle';
import { recordVisibilitySegment } from '@/features/survey-response/server/services/lifecycle.service';
import { withRouteLogging, type RouteLogContext } from '@/lib/logger';
import { getTrustedClientIpOrNull } from '@/lib/rate-limit/client-ip';
import { isRateLimitedTwoTier } from '@/lib/rate-limit/rate-limiter';

/**
 * Page Visibility 세그먼트 수신 엔드포인트.
 * 클라이언트가 navigator.sendBeacon / fetch(keepalive)로 호출한다.
 * body: { responseId: string, action: 'hide' | 'show' }
 *
 * REST 엔드포인트라 oRPC 미들웨어를 거치지 않으므로 진입부에서 직접 rate limit 한다.
 */
async function handleSegment(req: NextRequest, ctx: RouteLogContext) {
  // 신뢰 IP 추출 불가면 fail-closed. 단일 'unknown' 버킷 공유로 인한 상호 잠식/약 DoS 차단.
  const ip = getTrustedClientIpOrNull(req.headers);
  if (ip === null) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  // fine 키에 responseId(클라이언트 축)를 쓰기 위해 파싱을 rate limit 앞에 둔다 (draft 와 동일).
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
  ctx.bind({ responseId: parsed.data.responseId, action: parsed.data.action });

  // 2단 판정 — 응답 단위 격리(`group:ip:responseId`) + IP 전체 가드.
  if (await isRateLimitedTwoTier('response-segment', ip, parsed.data.responseId)) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  // 예기치 못한 기록 실패는 로깅 래퍼가 err 기록 + 500 응답으로 처리한다.
  await recordVisibilitySegment(parsed.data);

  return NextResponse.json({ ok: true });
}

export const POST = withRouteLogging('/api/response/segment', handleSegment, {
  errorMessage: 'internal',
  // sendBeacon 고볼륨 익명 경로 — 기존대로 Sentry 미캡처 (pino error 로그만)
  sentry: false,
});
