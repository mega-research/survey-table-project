import { NextRequest, NextResponse } from 'next/server';

import { recordVisibilitySegment } from '@/features/survey-response/server/services/lifecycle.service';

/**
 * Page Visibility 세그먼트 수신 엔드포인트.
 * 클라이언트가 navigator.sendBeacon / fetch(keepalive)로 호출한다.
 * body: { responseId: string, action: 'hide' | 'show' }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { responseId, action } = (body ?? {}) as {
    responseId?: unknown;
    action?: unknown;
  };

  if (
    typeof responseId !== 'string' ||
    responseId.trim() === '' ||
    (action !== 'hide' && action !== 'show')
  ) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  try {
    await recordVisibilitySegment({ responseId, action });
  } catch (err) {
    console.error('[segment] 기록 실패:', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
