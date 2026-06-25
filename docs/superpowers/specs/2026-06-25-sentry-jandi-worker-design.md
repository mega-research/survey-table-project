# Sentry 런타임 에러 → JANDI 알림 Worker 설계

- 일자: 2026-06-25
- 상태: 설계 승인됨, 구현 계획 대기
- 범위: Sentry Issue Alert 기반 런타임 에러 알림만
- 배포 타깃: Cloudflare Workers Free

## 배경

Vercel에서 운영 중인 Next.js 앱에 런타임 예외가 발생하면 JANDI 채팅방으로 알림을 보내고 싶다. 이 프로젝트는 이미 Sentry Next.js 설정을 갖고 있으며 `sendDefaultPii: false`로 요청 쿠키, 헤더, IP 같은 민감정보 첨부를 차단하고 있다.

Vercel 자체 Webhook은 배포 이벤트에는 맞지만, 운영 중 런타임 예외 알림에는 Sentry Issue Alert가 더 직접적이다. 중계 서버는 Vercel 앱과 분리되어야 Vercel 배포 또는 런타임 문제 상황에서도 알림 경로가 함께 영향을 받을 가능성이 낮다.

## 목표

- Sentry Issue Alert Webhook을 수신한다.
- Sentry payload를 JANDI Incoming Webhook 메시지 형식으로 변환한다.
- JANDI Incoming Webhook URL과 수신 인증 토큰은 Cloudflare secret으로만 관리한다.
- 앱 본체의 Next.js/oRPC 구조를 건드리지 않고 독립 Worker로 배포한다.
- 변환 로직과 요청 처리 로직을 Vitest로 검증 가능하게 만든다.

## 비목표

- Vercel deployment failed 알림 연동은 이번 범위에서 제외한다.
- Sentry Metric Alert, Cron Monitor, Uptime Alert 등 다른 알림 타입은 제외한다.
- Sentry API를 호출해 추가 상세정보를 조회하지 않는다.
- JANDI 알림 중복 제거를 위한 KV/Durable Object 저장소는 도입하지 않는다.
- 프로젝트 내부 관리자 UI에서 알림 설정을 관리하지 않는다.

## 확정 결정

| 항목 | 결정 |
|------|------|
| 알림 소스 | Sentry Issue Alert Webhook |
| 중계 서버 | Cloudflare Worker |
| 저장소 위치 | 레포 내 `workers/sentry-jandi/` |
| 수신 인증 | `Authorization: Bearer <token>` 우선, 필요 시 `?token=` fallback |
| 비밀 관리 | Cloudflare secret: `JANDI_WEBHOOK_URL`, `SENTRY_WEBHOOK_TOKEN` |
| JANDI 메시지 | `body`, `connectColor`, `connectInfo` |
| 테스트 | 변환 함수 + fetch handler 단위 테스트 |

## 아키텍처

```text
Sentry Issue Alert
  -> POST https://<worker>.workers.dev/sentry
    -> Cloudflare Worker
      -> POST JANDI Incoming Webhook
```

### 1. Worker 패키지

신규 디렉터리:

```text
workers/sentry-jandi/
├── README.md
├── wrangler.jsonc
├── src/
│   ├── index.ts
│   ├── jandi.ts
│   └── sentry.ts
└── tests/
    ├── jandi.test.ts
    └── worker.test.ts
```

`workers/sentry-jandi/src/index.ts`는 Cloudflare Worker entrypoint다. HTTP method, path, 인증, JSON parsing, JANDI 전송 실패 처리를 담당한다.

`sentry.ts`는 Sentry payload에서 안전하게 필드를 추출한다. 외부 payload는 완전 신뢰하지 않고 `unknown` 입력을 좁히는 작은 helper를 둔다.

`jandi.ts`는 JANDI payload를 만든다. JANDI 문서 기준 `body`는 필수이고, 상세 정보는 `connectInfo`의 `{ title, description }` 배열로 보낸다.

### 2. 요청 처리

Worker는 `POST /sentry`만 처리한다.

- `GET /healthz`는 200과 짧은 JSON을 반환한다.
- 지원하지 않는 path는 404를 반환한다.
- `POST`가 아니면 405를 반환한다.
- 인증 실패는 401을 반환한다.
- JSON 파싱 실패는 400을 반환한다.
- JANDI 전송 실패는 502를 반환한다.
- 성공 시 202를 반환한다.

Sentry Alert Webhook에 bearer header를 설정하기 어렵거나 UI 제약이 있으면 URL에 `?token=<secret>`을 붙일 수 있게 한다. 기본 문서와 예시는 bearer header를 우선 안내한다.

### 3. Sentry payload 매핑

Sentry Issue Alert payload에서 다음 후보 필드를 사용한다.

| JANDI 표시 | Sentry 후보 |
|------------|-------------|
| 제목 | `data.title`, `data.metadata.value`, `data.message`, `action` |
| 에러 타입 | `data.metadata.type` |
| 레벨 | `data.level`, `level` |
| 프로젝트 | `data.project`, `project`, `project_name` |
| 환경 | `data.environment`, `environment` |
| 릴리즈 | `data.release`, `release` |
| 이슈 링크 | `data.web_url`, `data.permalink`, `data.issue_url`, `url` |
| 이슈 ID | `data.issue_id`, `issue_id` |

Sentry 문서 예시에는 `issue_id`, `issue_url`, `level`, `metadata.type`, `metadata.value`, `project`, `release` 등의 필드가 포함된다. 실제 조직별 payload 차이를 고려해 모든 필드는 optional로 처리하고, 값이 없으면 JANDI 상세 줄을 생략한다.

### 4. JANDI 메시지 포맷

예상 메시지:

```json
{
  "body": "[Sentry] ReferenceError: heck is not defined",
  "connectColor": "#E5484D",
  "connectInfo": [
    { "title": "Project", "description": "survey-table-project" },
    { "title": "Level", "description": "error" },
    { "title": "Environment", "description": "production" },
    { "title": "Release", "description": "2026-06-25" },
    { "title": "Issue", "description": "[Open in Sentry](https://sentry.io/...)" }
  ]
}
```

색상은 severity 기반으로 둔다.

| level | color |
|-------|-------|
| fatal | `#D92D20` |
| error | `#E5484D` |
| warning | `#F59E0B` |
| info/debug | `#3B82F6` |
| unknown | `#6B7280` |

### 5. 보안과 개인정보

- JANDI webhook URL은 secret으로만 배포한다.
- Sentry 수신 URL은 token 없이는 동작하지 않는다.
- Worker 로그에는 원본 payload 전체를 남기지 않는다.
- JANDI 메시지에는 제목, 레벨, 프로젝트, 환경, 릴리즈, 이슈 링크만 포함한다.
- request cookies, headers, user IP, form body 같은 민감 가능 필드는 전달하지 않는다.
- Sentry 쪽 기존 `sendDefaultPii: false` 설정은 유지한다.

### 6. 배포와 운영 절차

`wrangler.jsonc`는 다음 secret 이름을 required로 선언한다.

```jsonc
{
  "secrets": {
    "required": ["JANDI_WEBHOOK_URL", "SENTRY_WEBHOOK_TOKEN"]
  }
}
```

운영자는 다음 순서로 연결한다.

1. Cloudflare Worker 배포
2. `JANDI_WEBHOOK_URL` secret 등록
3. `SENTRY_WEBHOOK_TOKEN` secret 등록
4. Sentry Alert Rule에서 webhook URL 등록
5. Sentry의 test notification으로 JANDI 수신 확인

로컬 개발은 `.dev.vars.example`만 커밋하고 실제 `.dev.vars`는 커밋하지 않는다. 현재 루트 `.gitignore`는 `.env*`를 이미 제외하지만, Worker 디렉터리의 `.dev.vars*`도 명시적으로 제외한다.

## 테스트 전략

TDD로 다음 테스트를 먼저 작성한다.

- Sentry payload의 `metadata.type/value`를 JANDI 제목과 상세 정보로 변환한다.
- optional 필드가 없어도 fallback 제목을 만들고 빈 상세 줄을 만들지 않는다.
- severity별 `connectColor`를 선택한다.
- 인증 토큰이 없거나 틀리면 JANDI fetch를 호출하지 않고 401을 반환한다.
- 잘못된 JSON은 400을 반환한다.
- JANDI 응답이 실패하면 502를 반환한다.
- 정상 요청은 JANDI 형식 payload를 전송하고 202를 반환한다.

검증 명령:

```bash
pnpm test workers/sentry-jandi
pnpm lint
```

Worker 런타임 타입 확인이 필요하면 구현 시 `wrangler types` 또는 최소 `tsc --noEmit` 검증을 추가한다.

## 참조

- Sentry Issue Alert Webhooks: https://docs.sentry.io/integrations/integration-platform/webhooks/issue-alerts/
- JANDI Incoming Webhook format: https://support.jandi.com/en/articles/connect-incoming-webhook-21bc249f
- Cloudflare Workers secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare Workers environment variables: https://developers.cloudflare.com/workers/configuration/environment-variables/

## 미해결 질문

- 없음. 구현은 Sentry 런타임 에러 알림만 대상으로 시작한다.
