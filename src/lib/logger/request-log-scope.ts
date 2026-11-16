import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

import type { LogContext } from './with-context';

/**
 * 요청 로그 범위 — 요청 하나가 끝날 때 남기는 로그 한 줄에, 서비스가 도중에 알게 된 식별자를 싣는 통로.
 *
 * 왜 필요한가: 응답 저장 요청(saveDraft·complete)의 입력에는 responseId 만 있고 설문 id 는 서비스가
 * 응답 행을 읽어야 안다. 반대로 응답을 만드는 요청은 만든 뒤에야 responseId 가 생긴다. 로깅 관문
 * (`rpcLoggingMiddleware`·`withRouteLogging`)은 입력밖에 못 보므로, 그 줄이 「어느 설문의 어느 응답」
 * 인지 비어 있었다(2026-11-16 실측 — 초안 저장 로그에 시각·IP 만 있었다).
 *
 * 관문이 요청마다 빈 묶음으로 범위를 열고, 서비스는 `bindRequestLog` 로 그 묶음에 얹는다. 서비스가
 * 로거나 컨텍스트를 인자로 받지 않아도 되고, 범위 밖(RSC 직접 호출·Inngest 잡·테스트)에서는 아무 일도
 * 하지 않는다.
 *
 * allowlist 관례는 그대로다 — 싣는 값은 식별자·건수뿐이다. 답·attrs·PII 평문은 싣지 않는다
 * (with-context.ts). 이 통로는 「무엇을 실어도 되는가」를 넓히지 않는다.
 */
const scope = new AsyncLocalStorage<LogContext>();

/** `bound` 를 이 요청의 묶음으로 삼아 `fn` 을 돌린다. 관문만 부른다. */
export function runWithRequestLogScope<T>(bound: LogContext, fn: () => T): T {
  return scope.run(bound, fn);
}

/** 지금 요청의 로그 한 줄에 식별자를 싣는다. 범위 밖이면 무시한다. */
export function bindRequestLog(fields: LogContext): void {
  const bound = scope.getStore();
  if (bound) Object.assign(bound, fields);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 요청 입력에서 꺼낸 값을 id 로 적어도 되는지 거른다 — UUID 모양일 때만 돌려준다.
 *
 * 로깅 관문은 인증·입력 검증보다 앞이라, 누구나 `responseId: 'person@example.com'` 같은 값을
 * 보낼 수 있고 요청이 거부돼도 그 줄은 남는다. 길이 상한만으로는 이메일·전화번호를 못 거른다.
 * 설문·응답 id 는 둘 다 uuid 컬럼이라 모양이 다르면 진짜 id 가 아니다 — 원문을 적지 않는다.
 * 서비스가 DB 행에서 읽어 싣는 값은 이 함수를 거치지 않아도 된다.
 */
export function loggableUuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : undefined;
}

/**
 * 요청 본문 크기(바이트) — `Content-Length` 헤더를 그대로 읽는다. 본문을 다시 직렬화하지 않는다.
 * 헤더가 없거나(청크 전송) 0 이상의 정수가 아니면 undefined.
 */
export function readContentLength(headers: Headers | undefined): number | undefined {
  const raw = headers?.get('content-length');
  if (raw == null || !/^\d+$/.test(raw)) return undefined;
  const bytes = Number(raw);
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}
