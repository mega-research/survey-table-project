import { Inngest, Middleware, type Logger } from 'inngest';

import { flushLogs, withContext } from '@/lib/logger';

/**
 * Inngest 함수 공용 로거 — 클라이언트 logger 옵션으로 주입한다.
 *
 * inngest 내장 logger 미들웨어(inngest:logger)가 요청마다 이 로거의
 * child({ runID, eventName }) 를 만들어 ctx.logger 로 노출하고, step 재실행
 * (memoization replay) 구간에서는 로깅을 비활성화해 중복 로그를 막는다.
 * 함수 본문은 반드시 ctx.logger 를 사용할 것 (전역 logger·console 직접 사용 금지).
 *
 * allowlist 관례 동일: functionId·runId·campaignId 등 식별자와 건수만 바인딩.
 * 수신자 email·event data 통짜 로깅 금지 (campaign-dispatcher 가 email 을 다룸).
 */
const inngestLogger = withContext({ source: 'inngest' });

/**
 * 요청 종료 시 Axiom 배치 flush 미들웨어.
 *
 * 내장 미들웨어의 ProxyLogger.flush() 는 pino 스트림만 비우고 @axiomhq/js 의
 * ingest 배치는 전송하지 못한다. Inngest 핸들러는 장수 실행이라 Next after()
 * 대신 flushLogs() 를 직접 await 한다 (lib/logger/flush.ts 참조).
 * Axiom 미설정(현 운영 상태)이면 no-op.
 */
class LogFlushMiddleware extends Middleware.BaseMiddleware {
  override readonly id = 'app:log-flush';

  // 반환은 inngest 자체 Middleware.Response (fetch Response 아님 — d.ts 137행)
  override async wrapRequest({
    next,
  }: Middleware.WrapRequestArgs): Promise<Middleware.Response> {
    try {
      return await next();
    } finally {
      await flushLogs();
    }
  }
}

/**
 * ctx.logger 접근 헬퍼.
 *
 * 런타임에는 내장 inngest:logger 미들웨어가 항상 ctx.logger 를 주입하지만,
 * 4.13 의 triggers-API 컨텍스트 타입(ContextWithTriggers)에는 logger 가 노출되지
 * 않는다. 함수 본문의 개별 단언 대신 이 헬퍼 한 곳으로 좁힘을 모은다 —
 * 추후 SDK 타입이 열리면 이 헬퍼만 제거하면 된다.
 */
export function ctxLogger(ctx: object): Logger {
  return (ctx as { logger: Logger }).logger;
}

/**
 * Inngest 클라이언트.
 *
 * v4 SDK 부터 schemas 옵션이 별도 헬퍼(eventType/staticSchema)로 이동.
 * 본 프로젝트는 이벤트 가짓수가 적어 runtime payload 검증을
 * 핸들러 안에서 직접 처리 (campaign-dispatcher 의 event.data 캐스팅).
 *
 * 이벤트 카탈로그 (수동 관리):
 *   - mail/campaign.queued    — { campaignId: string; surveyId: string }
 *   - mail/campaign.dispatched — { campaignId: string; surveyId: string }
 */
export const inngest = new Inngest({
  id: 'survey-table-project',
  logger: inngestLogger,
  middleware: [LogFlushMiddleware],
});

/** mail/campaign.queued 이벤트 payload (수동 타입 — schemas 미사용 보완) */
export interface MailCampaignQueuedData {
  campaignId: string;
  surveyId: string;
}

/** mail/campaign.dispatched 이벤트 payload — 발송 청크 완료 후 reconciler 트리거용 */
export interface MailCampaignDispatchedData {
  campaignId: string;
  surveyId: string;
}
