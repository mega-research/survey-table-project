# 전면 리팩토링 설계 — feature-base 프론트엔드 + DDD-lite oRPC 백엔드

> 작성: 2026-06-05
> 상태: 설계 확정 (구현 미착수)
> 실행 방식: brainstorm → spec(본 문서) → writing-plans → **Workflow 멀티에이전트 fan-out**

---

## 0. 목표와 동기

### 핵심 동기 (1순위 성공 기준)
**도메인 응집·탐색성.** 현재 한 도메인(예: 메일)의 코드가 `actions/` 평탄 폴더, `data/`, `lib/`, `components/`에 흩어져 있다. "메일 관련 코드 어디?"에 즉답 가능하고, **한 feature 폴더 = 그 도메인의 모든 것(타입·서버·UI·훅·스토어)** 으로 끝나는 구조가 목표.

### 부차 효과 (동기는 아니나 함께 달성)
- 타입 계약 end-to-end (oRPC `.input()`/`.output()` + zod 단일 소스)
- service 레이어 분리로 단위 테스트 용이
- 경계 명확화로 변경 비용 축소

### 확정된 방향 (사용자 결정)
| 항목 | 결정 |
|------|------|
| 출발점 | 백지에서 재설계 (이전 2026-05-07 brainstorm은 참고만) |
| 실행 | Workflow 멀티에이전트 fan-out |
| feature 입도 | **9개** |
| server action | **0개 — 완전 oRPC** ('use server' 전면 제거) |
| 마이그레이션 전략 | **하이브리드** (인프라+검증feature 순차 → 8개 병렬 → cleanup) |
| 회귀 안전망 | **Playwright smoke + procedure unit** |
| 검증 feature(첫 타자) | **library** |
| OpenAPI | 코드만 + `ENABLE_PUBLIC_API` env 게이트 |
| RSC 패턴 | service 직접 호출 (RPC 자기호출 금지) |
| test DB | 로컬 supabase CLI |

---

## §1. 아키텍처 — 디렉토리·레이어·import 규칙

```
src/
├── app/                          # 라우트 = 얇은 껍데기
│   ├── api/
│   │   ├── rpc/[[...rest]]/       # oRPC RPC 핸들러 (전체 mutation/query)
│   │   ├── v1/[[...rest]]/        # OpenAPI 핸들러 (ENABLE_PUBLIC_API 게이트)
│   │   ├── inngest/  webhooks/resend/   # 유지
│   │   ├── image/proxy/          # 유지 (img src 직참조)
│   │   └── surveys/[id]/export/  # 유지 (파일 다운로드 스트림)
│   ├── admin/ ...  survey/[id]/ ...     # 페이지: RSC에서 service 직접 호출
├── features/                     # 9개
│   └── <feature>/
│       ├── domain/               # 타입 + zod 스키마 (server·client 공용, DDD-lite '경량 도메인')
│       ├── server/
│       │   ├── procedures/       # oRPC procedure (얇음) + colocated *.test.ts
│       │   └── services/         # 비즈 로직 + drizzle 쿼리 (순수 함수, 단위 테스트 타깃)
│       ├── ui/                   # 컴포넌트
│       ├── hooks/                # feature 전용 훅
│       └── stores/               # zustand (해당 feature 것만)
├── server/                       # oRPC 코어: context.ts + orpc.ts + router.ts + handler.ts
└── shared/
    ├── ui/                       # shadcn primitives (현 components/ui 33개)
    ├── db/                       # drizzle schema SoT (현 db/)
    ├── lib/                      # supabase·r2·sentry·sanitize·rpc client
    ├── domain/                   # cross-feature 타입 SoT (Survey, Question 등 현 types/survey.ts)
    ├── spss/                     # cross-cutting (builder export + analytics 양쪽)
    └── hooks/                    # cross-feature 승격 훅만
```

### 9개 feature
`survey-builder` · `survey-response` · `operations` · `contacts` · `mail` · `analytics` · `library` · `auth` · `media`

### 3대 규약
1. **레이어 import 단방향** — `domain ← server ← ui/hooks`. domain은 아무것도 import 안 함(타입+zod만), ui는 domain 타입 + RPC client만. ESLint `no-restricted-imports`로 강제.
2. **feature 간 직접 import 금지** — cross-feature 필요 시 `shared/`로 승격하거나 RPC 경유. 두 번째 feature가 import하는 순간 승격이 규칙.
3. **stores·spss·cross-feature 타입 배치** — zustand 7개는 주인 feature로 이동(`survey-store`→builder 등), `ui-store`만 shared. `Survey`/`Question` 타입과 `spss`는 빌더·분석·운영 공용이라 shared.

---

## §2. 백엔드 토폴로지 — oRPC 코어·인증·RSC·OpenAPI

### oRPC 코어 (`src/server/`)
```
server/
├── context.ts   # createContext: supabase session + db 핸들. RSC와 procedure 양쪽 재사용
├── orpc.ts      # base os + authed(admin) + pub(응답자) + traced(Sentry) 미들웨어
├── router.ts    # 9개 feature router 합성
└── handler.ts   # RPCHandler + OpenAPIHandler(게이트)
```

### procedure는 얇게
```ts
// features/mail/server/procedures/send-test.ts
export const sendTest = authed
  .input(SendTestInput)       // domain/ 의 zod
  .output(SendTestResult)
  .handler(({ input, context }) => mailService.sendTest(input, context))
```
input/output zod + service 호출만. 비즈 로직은 전부 service.

### 4대 결정
1. **RSC는 service 직접 호출** — `await surveyService.list(ctx)`. 같은 서버 내 자기 RPC HTTP 왕복 금지. `createContext`가 RSC·procedure 공용이라 인증/DB 컨텍스트 일관.
2. **인증 2-base** — `authed`(admin: supabase session 검증) / `pub`(응답자). 응답자 inviteToken 검증은 `pub` 위 별도 미들웨어. `traced`로 전 procedure Sentry span 자동.
3. **OpenAPI 게이트** — 모든 procedure `.input()`+`.output()` 필수 규율. `/api/v1` 라우트 코드는 존재하되 `ENABLE_PUBLIC_API` env로 게이팅(외부 노출 보류).
4. **REST 라우트 선별 유지** — `image/proxy`·`surveys/[id]/export`·`inngest`·`webhooks/resend`는 유지. `upload/*`는 media feature procedure로 흡수.

### lib 모듈 귀속 (애매한 것 확정)
| 현 모듈 | 귀속 |
|---------|------|
| `lib/crypto` (PII) | contacts |
| `lib/contacts` | contacts |
| `lib/versioning` | survey-builder |
| `lib/duplicate-detection` | survey-response |
| `lib/response-normalizer` | survey-response |
| `lib/lookup` | library |
| `lib/upload` | media |
| `lib/spss` | shared/spss |
| `lib/tiptap` | shared (빌더+메일 공용 에디터) |
| `lib/sanitize` | shared/lib |
| `lib/inngest` | shared/lib |
| `lib/supabase`, `lib/auth` | shared/lib + auth feature |
| `lib/operations` | operations |
| `lib/mail` | mail |
| `lib/analytics` | analytics |
| `lib/survey` (토큰치환) | shared/lib (mail·응답 공용) / 이미지 promote는 media |

> 정확한 actions/data/components 전체 파일 매핑은 각 feature 마이그레이션 시 작성. 위는 경계가 애매해 미리 확정한 것.

---

## §3. 프론트엔드 토폴로지 — RPC client·Query·폼·hook·stores

- **RPC client** (`shared/lib/rpc.ts`): `@orpc/client` + `@orpc/tanstack-query`로 타입드 클라이언트. `orpc.mail.list.queryOptions()` / `orpc.mail.sendTest.mutationOptions()` 패턴 — 수동 쿼리 키 관리하던 현 `hooks/queries/*`를 oRPC utils 자동 생성으로 대체.
- **zod 단일 소스** (타입 계약의 핵심): `domain/` zod 하나를 ① procedure `.input()` ② RHF resolver ③ 클라 타입추론 세 곳이 공유. 폼 검증과 서버 검증이 같은 스키마라 어긋날 수 없음. 현 RHF 7.63 + zod 4 활용.
- **폼 마이그레이션**: `<form action={serverAction}>` 3곳 + 나머지 mutation을 전부 `useMutation(orpc.x.mutationOptions())` + `invalidateQueries`로.
- **hook 배치 3-tier** (ESLint 강제): trivial=컴포넌트서 직접 `useQuery` / single-feature=`feature/hooks/` / cross-feature=`shared/hooks/`. 승격은 두 번째 feature import 시점.
- **stores**: zustand+immer 유지. 서버 상태는 Query, 클라 전용 상태(빌더 편집 세션, UI 토글)만 zustand. 7개를 주인 feature로 이동.

> 주의: 빌더 `survey-store`는 1000줄 god-store 가능성 → PR7(빌더) 진입 시 slice 분해 동반.

---

## §4. 데이터 흐름·에러·optimistic·세션

**흐름:** `컴포넌트 → useQuery/useMutation → RPC client → /api/rpc → procedure(input 검증) → service(비즈+drizzle) → db`. RSC 경로만 RPC 건너뛰고 service 직접 호출.

### 3-tier 에러 처리
1. **typed domain error** — oRPC `errors`로 도메인 실패 타입 정의(`QUOTA_FULL`, `SURVEY_CLOSED`, `INVALID_INVITE_TOKEN` 등). 클라에서 `isDefinedError`로 분기 → 사용자 친화 메시지. 계약에 박혀 누락 불가.
2. **validation error** — zod input 실패 → RHF 필드 에러 매핑(같은 스키마라 자동 정합).
3. **infrastructure error** — DB·네트워크 장애는 `traced` 미들웨어가 Sentry 캡처 + 글로벌 toast.

### optimistic update — 표 단순변경만
컬럼 순서·결과코드 토글·진척 상태 같은 단순/되돌리기 쉬운 변경에만. 설문 저장·메일 발송 등 복잡/부수효과 mutation은 invalidate→refetch(안전 우선). 과도한 optimistic 금지.

### 세션 만료
`authed` procedure가 `UNAUTHORIZED`(401) 반환 → queryClient 글로벌 `onError`에서 감지 → 로그인 redirect. 응답자(`pub`)는 해당 없음.

---

## §5. 마이그레이션 실행 — 컷오버 순서·Workflow fan-out·리스크

### 컷오버 순서 (하이브리드)
```
PR1  인프라 (순차)      server/ + shared/(db·ui·lib·domain·spss 이동) + RPC client
                        + auth 미들웨어 + ESLint 룰 + vitest include 확장
                        + Playwright smoke 7개 + 로컬 supabase 셋업 + CI
PR2  library (순차)      검증 feature → 패턴 확정 → 이후 8개의 복붙 템플릿
PR3~ 병렬 fan-out       나머지 8개 feature를 Workflow worktree isolation으로 동시 마이그레이션
PRn  cleanup (순차)      actions/ 26개 제거 + 옛 lib/data 정리 + CLAUDE.md 갱신
```

### 왜 병렬이 되는가
인프라 PR이 `shared/`(공용 db·ui·supabase)를 완성해두면, 각 feature는 *자기 폴더로 자기 코드 이동 + procedure 작성*만 함 → 파일 충돌 거의 없음. cross-feature 런타임 의존(operations→contacts/mail)은 코드 이동이 아니라 RPC 경유라 병렬을 막지 않음.

### Workflow 구조 스케치
```
phase('검증')   → 1 agent 순차 (library = 패턴 레퍼런스 확정)
phase('병렬')   → pipeline(8 features, [코드이동+procedure작성, procedure unit test, 빌드+lint 검증])
                  각 feature = worktree isolation, 동시 ~8 (CPU 코어 기준 큐잉)
phase('cleanup')→ 1 agent 순차
```
> 8개 = survey-builder, survey-response, operations, contacts, mail, analytics, auth, media

### 리스크 2개
1. **빌더 god-file** — 빌더 god-file 5개(1000+줄)·`survey-store` → fan-out에서 가장 무겁고 store slice 분해 동반. 1 agent가 벅차면 sub-fan-out으로 분할.
2. **shared 승격 경쟁** — 병렬 중 두 feature가 같은 모듈을 동시에 shared로 올리면 충돌 → 인프라 PR에서 공용 후보를 미리 shared로 확정해 예방.

---

## §6. 테스트 전략 — smoke·unit·co-location·test DB

### procedure unit (mock-driven)
기존 `tests/integration` 패턴 계승 — drizzle mock으로 service 로직 격리 테스트. test DB 불필요. **co-location**: `procedure.test.ts`를 `procedure.ts` 옆에. vitest `include`를 `features/**/*.test.ts`로 확장(현재 `tests/`만 → 인프라 PR에서 처리). `tests/`엔 e2e + fixtures만 남김.

### Playwright smoke E2E (7개)
마이그레이션 전에 깔아 회귀 그물로 사용:
1. admin 로그인
2. 설문 생성 + 질문 추가
3. publish(snapshot)
4. 공개 응답 제출
5. 운영 콘솔 응답 현황 조회
6. 컨택 엑셀 업로드
7. 메일 템플릿 작성 + 발송 (**Resend stub** — 실발송 금지)

빌더·응답·운영·컨택·메일 5개 feature를 가로지름. analytics/library/auth/media는 procedure unit이 커버.

### test DB — 로컬 supabase CLI
`supabase start`로 로컬 스택. 무료·CI 재현·dev 오염 없음.
> **prerequisite (인프라 PR에서 확인·셋업)**: 로컬 supabase CLI/docker 설치 여부, 마이그레이션을 로컬 스택에 적용하는 시드 스크립트.

---

## 미해결·주의사항

- **로컬 supabase 셋업 존재 여부 미확인** — 인프라 PR 착수 전 확인 필요. 없으면 셋업이 인프라 PR 첫 작업.
- **빌더 god-file 분해** — PR7 진입 시 store/컴포넌트 추가 분해 가능성. 사전 인벤토리 필요.
- **`survey-save-actions.ts` explicit field set** — 마이그레이션 시 spread 미사용 패턴 유지, 신규 컬럼 누락 주의(tsc 미검출).
- **drizzle 함정 계승** — timestamptz optimistic lock(version int), `ANY(${arr})` 금지(inArray) 등 기존 함정을 procedure/service에서도 유지.
- **`scripts/` tsc** — gitignored지만 strict 위반 89건 pre-existing. 머지 후 `scripts/` tsc 에러는 이번 작업과 무관.

---

## 다음 단계
writing-plans 스킬로 PR1(인프라) 상세 구현 계획부터 작성. 이후 각 PR을 Workflow fan-out으로 실행.
