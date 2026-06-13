# WS-1: 공개 표면 하드닝 + 의존성 — 설계 스펙

- 일자: 2026-06-13
- 상태: 승인됨 (구현 대기)
- 브랜치: `feat/ws1-public-surface-hardening`
- 출처: `claudedocs/owasp-security-audit-2026-06-13.md` (OWASP 전수 감사)

## 배경

OWASP 전수 보안 감사에서 확정 발견 30건이 나왔고, 이를 3개 워크스트림으로 분해했다. 본 스펙은 **WS-1 — "관리자 1명" 가정과 무관하게 외부 미인증 공격자가 즉시 악용 가능한 항목 + 공급망 위생**을 다룬다. WS-2(IDOR 구조 봉인)와 WS-3(방어심층 마감)은 별도 사이클이다.

## 범위 (In Scope) — 9개 발견

| # | 심각도 | 항목 | OWASP |
|---|--------|------|-------|
| 1 | HIGH | Next.js 16.2.4 → 패치 버전 bump (미들웨어/프록시 우회 CVE군) | A06 |
| 2 | MED | 미인증 pub 엔드포인트 rate limit 전무 | A07 |
| 3 | MED | 응답 제출 시 maxResponses/endDate/closed/draft/비공개 게이트 미강제 | A07 |
| 4 | MED | 중복방지 신호(x-forwarded-for 등) 무검증 → 신뢰 IP 정규화 | A07 |
| 5 | MED | updateQuestionResponse 상태/소속 가드 부재 → 응답 변조 | A08 |
| 7 | MED | 전역 보안 응답 헤더 전무 | A05 |
| 14 | LOW | sanitize가 style 속성 미필터 → CSS 인젝션 | A03 |
| 20 | LOW | sentry-example 데드코드 미인증 도달 | A05 |
| 23 | LOW | pnpm audit CI 게이트 부재 + transitive 미패치 | A06 |

## 목표 / 비목표

**목표**
- 외부 미인증 공격자가 (a) 마감/정원/폐쇄/비공개 설문에 응답 주입, (b) 응답 데이터 사후 변조, (c) pub 엔드포인트 무제한 스팸, (d) CSS/클릭재킹으로 UI 기만하는 경로를 차단한다.
- Next.js를 패치 버전으로 올려 미들웨어 우회 CVE군을 닫고, 공급망 위생을 CI로 강제한다.

**비목표 (Out of Scope)**
- WS-2 IDOR 구조(ownerUserId 도입, requireSurveyOwnership 강화, service WHERE 스코프) — 단일관리자 가정으로 현재 봉인, 별도 사이클.
- CSP(nonce 기반) enforce/Report-Only — Next App Router nonce plumbing은 회귀 위험이 커 전용 사이클.
- CAPTCHA/Turnstile — rate limit으로 충분, UX 마찰 회피(YAGNI).
- WS-3 저위험 위생(#13/#16/#21/#22/#24/#25/#26).

## 확정 설계 결정 (브레인스토밍 결과)

1. **배포 타깃**: Vercel 서버리스 → 인메모리 rate limit 불가, 외부 스토어 필요. `/api/rpc`·`/api/response/segment`는 Node 런타임(Drizzle 사용 가능), `proxy.ts`는 Edge.
2. **rate limit 백엔드**: Upstash Redis (`@upstash/ratelimit` + `@upstash/redis`). env `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (이미 `.env.local`에 값 등재, `.env.example`에 placeholder). limiter는 스왑 가능 인터페이스 뒤에 둔다.
3. **봇 방어**: rate limit + 신뢰 IP 정규화만. CAPTCHA 미도입.
4. **보안 헤더**: 안전 헤더만 enforce. `X-Frame-Options: SAMEORIGIN`(앱이 자기 라우트를 same-origin 임베드하는 곳 없음 — iframe은 전부 srcDoc/외부 YouTube/메일 미리보기 — 이나 혹시 모를 미리보기 보존 위해 DENY 대신 SAMEORIGIN). CSP는 비목표.
5. **#14 sanitize**: `style` 속성을 strip하지 않고 `allowedStyles` 화이트리스트로 안전 속성만 통과(TipTap text-align/color 보존).
6. **Next 목표 버전**: 16.2.9 (조회 시점 최신 16.2.x 패치, >= 16.2.6 충족).

## 상세 설계

### 0. 공통 인프라: RateLimiter 포트 (#2, #4 기반)

신규 모듈 `src/lib/rate-limit/`:

- `rate-limiter.ts`
  - 인터페이스: `RateLimiter { limit(key: string): Promise<{ success: boolean; remaining: number; resetMs: number }> }`
  - Upstash 구현: `@upstash/ratelimit`의 sliding window. 한도 프리셋을 그룹별로 정의(아래 표).
  - **env 미설정 시 no-op limiter** 반환 + 1회 `console.warn`. dev/test fail-open(앱 안 깨짐), prod는 env 존재 전제. (가용성 우선 — rate limit 실패가 서비스 다운을 유발하지 않도록.)
  - 싱글톤 팩토리(`getRateLimiter()`)로 Redis 클라이언트/limiter 재사용.
- `client-ip.ts`
  - `getTrustedClientIp(headers: Headers): string` — Vercel `x-forwarded-for` 최좌측(실제 클라) 신뢰 추출. 부재 시 `x-real-ip` 폴백, 최종 폴백 `'unknown'`.
  - **#4 해결**: `src/lib/duplicate-detection/signals.ts`의 raw `x-forwarded-for` 첫 토큰 직접 사용을 이 헬퍼로 교체. 클라이언트 핑거프린트(deviceId/UA/screen)는 soft anti-abuse임을 주석으로 명시.

**한도 프리셋 (그룹별, IP 키)**

| 그룹 | 대상 | 한도(초안) |
|------|------|-----------|
| response-mutation | response.start/updateAnswer/createWithFirstAnswer/createBlank/complete | 30 / 1min |
| response-segment | `/api/response/segment` | 60 / 1min |
| lookup | attrs.lookup, unsubscribe.lookup, duplicate.checkOnEntry | 60 / 1min |

> 한도 수치는 구현 시 합리 기본값으로 두고, 운영 관찰 후 조정 가능하게 상수로 분리.

**적용 방식**
- oRPC 미들웨어 `withRateLimit(group)`: pub 프로시저에 `.use()`로 부착. 키 = `${group}:${ip}`. 초과 시 `ORPCError('TOO_MANY_REQUESTS')`.
- `/api/response/segment` 핸들러: 진입부에서 limiter 직접 호출, 초과 시 429.

### 1. 응답 가용성 게이트 (#3)

- 신규 가드 `assertSurveyAcceptingResponses(survey, version)` (또는 service 내부 헬퍼):
  - `status === 'published'` (또는 활성 version published) — 아니면 거부.
  - `endDate` null 또는 미래 — 경과 시 거부.
  - `maxResponses` null 또는 완료 카운트 < maxResponses — complete 시점 하드 체크(count 쿼리). create 시점은 soft, complete 시점 하드. 잔여 race window는 허용(문서화).
  - `isPublic === false`면 유효 invite(contactTargetId) 필요, `requireInviteToken`면 토큰 강제(기존 checkTrackA와 일관).
- 적용 지점: `startResponse`, `createResponseWithFirstAnswer`, `createBlankResponse`, `completeResponse` (`src/features/survey-response/server/services/response.service.ts`).

### 2. 응답 변조 가드 (#5)

- `updateQuestionResponse` (response.service.ts:160):
  - WHERE에 `isNull(deletedAt) AND status = 'in_progress'` 추가. 영향 0행이면 throw(완료/삭제/타상태 응답의 사후 변조 차단).
  - `questionId`가 해당 응답의 versionId 스냅샷(또는 surveyId의 questions)에 존재하는지 검증 — 미존재 시 거부(임의 키 JSONB 주입 차단).
  - value 직렬화 바이트 상한(예: 합리적 KB 한도) 초과 시 거부.

### 3. 안전 보안 헤더 (#7)

- `next.config.ts`에 `async headers()` 추가, 전 라우트 적용:
  - `X-Frame-Options: SAMEORIGIN`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
  - CSP 미포함 — `// CSP는 WS 후속 사이클(nonce plumbing)` 주석.

### 4. CSS 인젝션 차단 (#14)

- `src/lib/sanitize.ts`:
  - `parseStyleAttributes: false` → `true`.
  - `allowedStyles` 화이트리스트: 안전 속성만 — `text-align`, `color`, `background-color`, `font-size`, `font-weight`, `font-style`, `text-decoration`, `padding`, `margin`, `width`(표) 등. **값 정규식으로 `url(`·`expression(`·`position`(fixed/absolute) 차단**.
  - `style`이 allowedAttributes에 포함된 태그에 한해 적용. TipTap이 생성하는 정상 인라인 스타일(text-align/color) 보존 확인.

### 5. 의존성 위생 (#1, #23)

- `package.json`: `next` 정확 핀 `16.2.4` → `16.2.9` 직접 수정. React 19.2.3 호환 확인.
- `pnpm.overrides` 추가: 감사 권고 transitive 패치 — `fast-xml-parser`, `ws`, `tar`, `protobufjs`, `@chenglou/pretext`. 설치 가능/호환 버전으로 핀(구현 시 최신 패치 확인).
- `ci.yml`: `pnpm audit --audit-level=high` 게이트 추가(prod 의존 기준). dev-only 툴체인 CVE(#11 vite/esbuild 등)는 override만, prod 게이트와 분리. 필요 시 잔존 unfixable 항목은 명시 allowlist + 주석.
- `.env.example`에 Upstash 키 placeholder 이미 등재됨 — 확인만.

### 6. 데드코드 제거 (#20)

- 삭제: `src/app/api/sentry-example-api/route.ts`, `src/app/sentry-example-page/page.tsx`.
- `src/app/layout.tsx`의 sentry-example 링크(라인 부근) 제거. 기타 참조 grep 후 정리.

## 테스트 전략

**TDD (red → green)**
- `client-ip.ts`: x-forwarded-for 다양한 형태 → 신뢰 IP 추출 단위 테스트.
- RateLimiter: no-op/Upstash 경계 — 미설정 시 항상 success, 설정 시 한도 초과 거부(Upstash 모킹).
- 가용성 게이트(#3): closed/draft/endDate 경과/maxResponses 초과/비공개+토큰없음 → 거부, 정상 published → 통과. (서비스 모킹은 `tests/integration` 패턴.)
- 변조 가드(#5): completed/deleted 응답 update 거부, 미존재 questionId 거부, in_progress 정상 update 성공.
- sanitize(#14): `position:fixed`·`background:url(...)`·`expression()` 제거, `text-align:center`·`color` 보존.

**검증 전용 (TDD 부적합)**
- #1 Next bump: `pnpm build` + 전체 `pnpm test` + `/admin` 인증 스모크(미인증 리다이렉트 유지 확인).
- #7 헤더: 헤더 단언 테스트 또는 빌드 후 응답 헤더 확인.
- #20: grep 0건 + 빌드.
- #23: `pnpm audit --audit-level=high` 출력 + CI 통과.

## 실행 순서 / 슬라이스 (각 독립 커밋)

1. **deps**: #1 Next 16.2.9 + #23 overrides/CI 게이트 — 기반부터.
2. **deadcode**: #20 sentry-example 제거.
3. **headers**: #7 next.config 안전 헤더.
4. **sanitize**: #14 allowedStyles.
5. **ratelimit**: #2 RateLimiter 포트 + #4 신뢰 IP + pub 프로시저/segment 적용.
6. **response-integrity**: #3 가용성 게이트 + #5 변조 가드 (둘 다 `response.service.ts` → 순차/동일 슬라이스).

- 1·2·3·4는 상호 독립 → 병렬 가능. 5는 신규 모듈(독립). 6은 response.service.ts 집중(순차).
- 다이나믹 워크플로우: 독립 슬라이스를 worktree 격리 TDD 에이전트로 병렬, response.service.ts 공유 슬라이스(6)는 순차. 각 슬라이스 = TDD red→green→리뷰.

## 롤아웃 / 운영 노트

- Upstash env는 Vercel 프로젝트 환경변수에도 등재 필요(프로덕션). 로컬 `.env.local` 등재 완료.
- rate limit 한도는 상수로 분리해 무중단 조정.
- `X-Frame-Options: SAMEORIGIN`이 향후 같은 오리진 미리보기를 막지 않는지 스모크 확인.

## 미해결 질문

- 없음. (한도 수치·override 정확 버전은 구현 시 합리 기본값/최신 패치로 확정.)
