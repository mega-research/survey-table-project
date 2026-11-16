# 공용 lib — src/lib

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·CI 게이트)은 루트 `AGENTS.md` 에, 마이그레이션 번호는 `supabase/AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 레이트리밋과 로깅

- **레이트리밋** (`lib/rate-limit/`): Upstash Redis 2단 판정(`isRateLimitedTwoTier`). 입력의 sessionId/responseId를 클라이언트 축으로 삼아 `group:ip:clientId`로 같은 NAT 뒤 응답자를 격리하고, `group-ip:ip` 전체 가드가 식별자 회전 남용을 막는다. **UPSTASH env 미설정이면 limiter가 no-op(항상 통과)**. 신뢰 IP 헤더 부재 시에만 fail-closed.
- **로깅** (`lib/logger/`): pino + Axiom transport(2026-09-11 프로덕션·프리뷰 `AXIOM_TOKEN`/`AXIOM_DATASET=survey-prod` 등록으로 켜짐). `base`의 `rpcLoggingMiddleware`가 최전방이라 인증·레이트리밋 거부까지 기록된다. PII 마스킹은 `redact.ts` 소관. 로그 한 줄에는 식별자(`rpc`·`userId`·`role`·`ip`·`surveyId`·`responseId`)와 크기·시간(`reqBytes` = Content-Length, `durationMs`)만 싣는다 — 요청 본문은 PII 암호화 **전** 평문이라 싣지 않는다. 입력에 없는 식별자(응답 저장의 설문 id, 응답 생성의 responseId)는 서비스가 `bindRequestLog`(`request-log-scope.ts`, AsyncLocalStorage)로 실어 관문(RPC 미들웨어·`withRouteLogging`)의 같은 줄에 합친다. 범위 밖(RSC·잡)에서는 무시된다.
- **Sentry**: RPC 의 진짜 장애(비-ORPCError 예외·INTERNAL_SERVER_ERROR)만 로깅 미들웨어가 `rpc`·`code`·`role`·`surveyId` 태그와 `rpc <이름>` 트랜잭션명을 붙여 보낸다(`isSentryWorthyRpcError`). 코드 있는 거부(UNAUTHORIZED·FORBIDDEN·TOO_MANY_REQUESTS 등)는 로그만 남긴다. 핸들러 인터셉터는 procedure 밖 예외의 최후 창구이고 `isSentryCaptured` 표식으로 중복 전송을 막는다. 클라이언트는 브라우저·확장 주입 스크립트 오류(`__firefox__`·`window.ethereum`·extension URL)를 `ignoreErrors`/`denyUrls` 로 거른다.
- **DB 쿼리 바인딩 값**: DrizzleQueryError 의 message `params:` 보간 구간과 `query`·`params`·`parameters` 키 값은 pino err 직렬화(`err-serializer.ts`)와 서버 Sentry `beforeSend`(`sentry-before-send.ts`)가 **한 규칙** `lib/logger/query-params-scrub.ts` 로 지운다 — 새 키·패턴은 그 파일에만 더한다. SQL 문장(`$n`)·바인딩 개수(`params: [Stripped 3 values]`)·원인 PostgresError 의 타입·메시지·스택은 남기고, SQLSTATE 는 `pg_code` 태그와 `postgres` 컨텍스트로 더한다(값을 담을 수 있는 `detail`·`where`·`hint` 는 옮기지 않는다). 원인 PG 메시지 자체는 그대로라 22P02·22007 처럼 입력값을 인용하는 메시지는 그 값이 남는다. edge·client 설정은 DB 를 부르지 않아 걸지 않았다.
- **요청 본문**: 같은 서버 `beforeSend` 가 모든 이벤트에서 `event.request.data` 를 지운다(URL·메서드는 남긴다). `sendDefaultPii:false` 는 본문을 막지 않고 SDK 기본값은 본문을 모으는 쪽이라, 웹훅 원문(주소·제목)과 RPC 본문(응답·명단 값)이 붙을 수 있다. `beforeSend` 는 오류 이벤트만 지난다 — 트랜잭션 이벤트에는 걸려 있지 않다.
