import { NextRequest, NextResponse } from 'next/server';

import { SaveDraftResponseInput } from '@/features/survey-response/domain/response';
import { saveDraftResponseIfActive } from '@/features/survey-response/server/services/response.service';
import { getTrustedClientIpOrNull } from '@/lib/rate-limit/client-ip';
import { getRateLimiter, type RateLimitGroup } from '@/lib/rate-limit/rate-limiter';

/**
 * 한 요청에 실을 수 있는 문항 수 상한.
 * saveDraftResponse 는 문항을 순차 await 하므로, 키가 많으면 IP 당 rate limit 을 통과하면서
 * DB 왕복만 선형으로 늘어난다. 문항별 값 크기는 MAX_ANSWER_VALUE_BYTES 가 따로 본다.
 */
const MAX_DRAFT_ANSWER_KEYS = 200;

/** 미등록 그룹은 limiter 에서 fail-open 되므로 타입으로 등록 여부를 컴파일 타임에 고정한다. */
const RATE_LIMIT_GROUP: RateLimitGroup = 'response-draft';

/**
 * 이탈 시점 임시 저장 수신 엔드포인트.
 * 클라이언트가 visibilitychange:hidden / pagehide 에서 navigator.sendBeacon 으로 호출한다.
 * body: { responseId: string, answers: Record<string, unknown> } (+ 테스트 attempt 식별자)
 *
 * oRPC 는 sendBeacon 으로 호출할 수 없어(커스텀 헤더 불가, body 가 RPC 포맷) segment 와
 * 동일한 이유로 REST 를 유지한다. oRPC 미들웨어를 거치지 않으므로 진입부에서 직접 rate limit 한다.
 */
export async function POST(req: NextRequest) {
  // 신뢰 IP 추출 불가면 fail-closed. 단일 'unknown' 버킷 공유로 인한 상호 잠식 차단.
  const ip = getTrustedClientIpOrNull(req.headers);
  if (ip === null) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }
  const { success } = await getRateLimiter().limit(`${RATE_LIMIT_GROUP}:${ip}`);
  if (!success) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = SaveDraftResponseInput.safeParse(body);
  if (!parsed.success || parsed.data.responseId.trim() === '') {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }
  if (Object.keys(parsed.data.answers).length > MAX_DRAFT_ANSWER_KEYS) {
    return NextResponse.json({ error: 'too many answers' }, { status: 400 });
  }

  try {
    const result = await saveDraftResponseIfActive(parsed.data);
    if (!result.saved) {
      // 제출 직후 탭 닫기 등 정상 시나리오. 에러율을 오염시키지 않도록 info 로만 남긴다.
      console.info('[draft] 저장 skip:', result.skipped);
      return NextResponse.json({ ok: true, skipped: result.skipped });
    }
  } catch (err) {
    console.error('[draft] 저장 실패:', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
