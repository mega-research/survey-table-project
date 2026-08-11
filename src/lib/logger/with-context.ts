import 'server-only';

import type { Logger } from 'pino';

import { logger } from './logger';

/**
 * 로그 컨텍스트 — "누가·어디서·무엇을" 표준 바인딩.
 *
 * role 은 향후 superadmin/admin/user/guest 확장을 전제로 열린 string 이다 —
 * 현재의 admin/guest 이분법에 하드코딩하지 말 것.
 *
 * allowlist 관례: 여기에 싣는 값은 식별자·경로·건수뿐이다. email 등 PII 평문과
 * JSONB 컨테이너는 금지 (redact 가 걸러주지만 그건 안전망이지 허가가 아니다).
 */
export interface LogContext {
  /** 누가 — supabase user id. 비인증 경로는 생략하고 source 로 표기. */
  userId?: string;
  role?: 'admin' | 'guest' | 'anonymous' | (string & {});
  /** 어디서 — 신뢰 클라이언트 IP (getTrustedClientIpOrNull). */
  ip?: string;
  /** 무엇을 — oRPC procedure 경로 (예: 'contacts.list'). */
  rpc?: string;
  /** 무엇을 — REST 라우트 패턴 (예: '/api/surveys/[surveyId]/export'). */
  route?: string;
  /** 비인증 주체의 출처 표기 (예: 'resend-webhook', 'inngest'). */
  source?: string;
  requestId?: string;
  surveyId?: string;
  responseId?: string;
  contactTargetId?: string;
  campaignId?: string;
  /** Inngest run id 등 백그라운드 실행 단위. */
  runId?: string;
  [key: string]: unknown;
}

/** 컨텍스트가 바인딩된 child logger 를 만든다. 요청/잡 진입점에서 1회 생성해 전파. */
export function withContext(context: LogContext): Logger {
  return logger.child(context);
}
