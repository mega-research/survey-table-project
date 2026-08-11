import { NextRequest, NextResponse } from 'next/server';

import { SaveDraftResponseInput } from '@/features/survey-response/domain/response';
import { saveDraftResponseIfActive } from '@/features/survey-response/server/services/response.service';
import { withRouteLogging, type RouteLogContext } from '@/lib/logger';
import { getTrustedClientIpOrNull } from '@/lib/rate-limit/client-ip';
import { isRateLimitedTwoTier, type RateLimitGroup } from '@/lib/rate-limit/rate-limiter';

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
async function handleDraft(req: NextRequest, ctx: RouteLogContext) {
  // 신뢰 IP 추출 불가면 fail-closed. 단일 'unknown' 버킷 공유로 인한 상호 잠식 차단.
  const ip = getTrustedClientIpOrNull(req.headers);
  if (ip === null) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  // fine 키에 responseId(클라이언트 축)를 쓰기 위해 파싱을 rate limit 앞에 둔다.
  // JSON 파싱은 CPU 경량이라, NAT 공유 IP 의 응답자 상호 격리 이득이 순서 비용을 상회한다.
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
  // 로그에는 응답값(answers) 자체를 싣지 않는다 — 식별자·건수만 (allowlist 관례)
  ctx.bind({
    responseId: parsed.data.responseId,
    answerCount: Object.keys(parsed.data.answers).length,
  });

  // 2단 판정 — 응답 단위 격리(`group:ip:responseId`) + IP 전체 가드. RPC saveDraft 와
  // 같은 response-draft 버킷을 공유한다 (같은 성격의 쓰기이므로 예산도 함께 본다).
  if (await isRateLimitedTwoTier(RATE_LIMIT_GROUP, ip, parsed.data.responseId)) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }
  if (Object.keys(parsed.data.answers).length > MAX_DRAFT_ANSWER_KEYS) {
    return NextResponse.json({ error: 'too many answers' }, { status: 400 });
  }

  // 예기치 못한 저장 실패는 로깅 래퍼가 err 기록 + 500 응답으로 처리한다.
  const result = await saveDraftResponseIfActive(parsed.data);
  if (!result.saved) {
    // 제출 직후 탭 닫기 등 정상 시나리오. 에러율을 오염시키지 않도록 info 로만 남긴다.
    ctx.log.info({ skipped: result.skipped }, '임시 저장 skip');
    return NextResponse.json({ ok: true, skipped: result.skipped });
  }

  return NextResponse.json({ ok: true });
}

export const POST = withRouteLogging('/api/response/draft', handleDraft, {
  errorMessage: 'internal',
  // sendBeacon 고볼륨 익명 경로 — 기존대로 Sentry 미캡처 (pino error 로그만)
  sentry: false,
});
