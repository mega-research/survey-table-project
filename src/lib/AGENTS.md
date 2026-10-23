# 공용 lib — src/lib

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

잔류 기준(무엇이 lib 에 남는가)은 루트 `AGENTS.md` 의 "src/lib 잔류 기준" 절이다.

## 디렉터리 구조

```
src/
├── lib/                        # 인프라 어댑터 + 프론트·서버가 함께 쓰는 계산 (도메인 로직 흡수 완료 — 트래커 E-1)
│                               # 판정은 폴더 이름이 아니라 소비자 실측 — 루트 AGENTS.md 의 "src/lib 잔류 기준" 참조
│   ├── auth/ + auth.ts         # 인증 어댑터 + 가드. server.ts=Better Auth 인스턴스 · client.ts=브라우저 authClient
│   │                           # · safe-redirect=로그인 복귀 경로 정제 · protected-paths=proxy/레이아웃 공용 AUTH_PAGES
│   │                           # · require-admin-page · external-viewer(비내부 계정 → 데이터 파티션)
│   │                           # auth.ts=requireAuth/requireActiveAccount/getCurrentUser
│   │                           # (구 guest-grants=env grant 게스트는 티켓 21 이 걷었다)
│   ├── rate-limit/             # Upstash 2단 레이트리밋 + 신뢰 IP 추출
│   ├── logger/                 # pino + Axiom transport, redact, route/context 로깅
│   ├── crypto/                 # PII 암호화 (cipher + blind index, 컨택·응답 공용)
│   ├── contacts/               # 그룹 레벨·업로드 병합 매칭·업로드 제한·결과코드 정규화(result-code-statuses-normalize)·Raw 양식 이월 응답 되읽기 raw-format-import 순수 공용
│   │                           # (엑셀 파서·스킴 헬퍼는 server/contacts, 컬럼 자동감지는 features/operations)
│   ├── operations/             # 운영 콘솔 공유 계산 21파일 — format 짝 12개는 *-format.ts(서버 쌍이 동일 어간 소유) + 공유 판정·필터 9개. UI 도 소비하므로 여기가 정답 (ADR 0016)
│   │                           # contacts-filter-sql.server.ts 는 drizzle 의존 서버 전용 — lib 안 .server.ts 마킹의 예
│   ├── mail/                   # 렌더 미리보기·변수 추출·이미지 클릭영역·상수 4파일 (발송·dispatch·reconcile·빌링은 server/mail)
│   ├── quota/                  # 쿼터 응답 매칭·정규화·달성 상태 계산 quota-status-calc (쿼터 게이트는 features/survey-response/lib/quota-gate)
│   ├── r2-client.ts            # R2 인프라 어댑터 — S3Client 단일 소유자 + 객체 존재 검사 + URL→key
│   ├── r2-env.ts               # R2 env 검증 (SDK 를 모르는 순수 헬퍼)
│   ├── image-utils-server.ts   # 서버 이미지/파일 삭제·복사
│   ├── image-extractor.ts      # 질문에서 이미지 URL 추출
│   ├── spss/                   # SPSS .sav 빌더 + 변수 생성/검증 + 데이터 변환
│   ├── inngest/                # Inngest 클라이언트 어댑터만 (client.ts) — 함수는 server/workflows/jobs
│   ├── question/               # 질문 스키마/정규화/가드/변형 + row-repeat(행 반복 펼치기·판정·참조 재배선 — analytics 가 import 해 lib 잔류)
│   ├── survey/                 # 토큰 치환, 수식·셀 게이팅, 이미지/첨부 promote, PII 보관기한, 응답 헤더 설정, 숨은 문항 판정·strip question-visibility, 경로 밖 문항 판정·strip answer-path, 답할 수 있는 범위 answerable-scope(응답 확정·Raw 내보내기 공용 판정), 표의 숨은 칸 판정 table-cell-visibility, 이월값 조건 prior-answer-condition, 보기 선택 판독 choice-selection·choice-table-cell-value — 전부 서버·lib 가 소비해 잔류 (컨택 attrs·이월 응답 context 와 이월값 강조는 features/question-renderer, 프리필·형식 정규화는 features/survey-response/lib, 셀 리치텍스트는 table-editor/cell-editor/utils)
│   ├── survey-response/        # 구조 생존 판정 1파일 (테스트 응답 초기화는 server/survey-response, version-rebase 는 features/survey-response/lib)
│   ├── analytics/              # 통계 analyzer + 엑셀/SPSS export 워크북 계산 + row-repeat-usage(내보내기에서 쓰이지 않은 뒤쪽 벌 pruning) (교차분석·필터는 features/analytics)
│   ├── duplicate-detection/    # 중복 감지 신호 타입 1파일 (판정 로직은 server/survey-response)
│   ├── lookup/                 # LUT 룩업
│   ├── upload/                 # 업로드 정책(첨부·이미지) + 라우트 진입 가드(route-guard)
│   ├── sanitize.ts             # HTML sanitize (서버: jsdom 금지, sanitize-html 사용)
│   ├── survey-url.ts           # 설문 URL 조립
│   ├── option-text-read.ts     # 응답에서 옵션 텍스트 입력값 읽기
│   ├── option-value-code-migration.ts  # 옵션 value→optionCode 일괄 마이그레이션 순수 로직
│   ├── date-formatters.ts      # 날짜·시각 표시 공통 포매터
│   ├── get-error-message.ts    # 에러 → 사용자 표시 메시지
│   ├── pg-error.ts             # Postgres 에러 판별 (SQLSTATE 23505 등) — 드라이버 모양을 읽는 인프라 헬퍼
│   ├── fake-data-generator.ts  # 테스트용 더미 응답 생성
│   └── utils.ts                # 공통 유틸리티 (cn())
│
```

---

## 레이트리밋과 로깅

- **레이트리밋** (`lib/rate-limit/`): Upstash Redis 2단 판정(`isRateLimitedTwoTier`). 입력의 sessionId/responseId를 클라이언트 축으로 삼아 `group:ip:clientId`로 같은 NAT 뒤 응답자를 격리하고, `group-ip:ip` 전체 가드가 식별자 회전 남용을 막는다. **UPSTASH env 미설정이면 limiter가 no-op(항상 통과)**. 신뢰 IP 헤더 부재 시에만 fail-closed.
- **로깅** (`lib/logger/`): pino + Axiom transport(2026-09-11 프로덕션·프리뷰 `AXIOM_TOKEN`/`AXIOM_DATASET=survey-prod` 등록으로 켜짐). `base`의 `rpcLoggingMiddleware`가 최전방이라 인증·레이트리밋 거부까지 기록된다. PII 마스킹은 `redact.ts` 소관.
- **Sentry**: RPC 의 진짜 장애(비-ORPCError 예외·INTERNAL_SERVER_ERROR)만 로깅 미들웨어가 `rpc`·`code`·`role`·`surveyId` 태그와 `rpc <이름>` 트랜잭션명을 붙여 보낸다(`isSentryWorthyRpcError`). 코드 있는 거부(UNAUTHORIZED·FORBIDDEN·TOO_MANY_REQUESTS 등)는 로그만 남긴다. 핸들러 인터셉터는 procedure 밖 예외의 최후 창구이고 `isSentryCaptured` 표식으로 중복 전송을 막는다. 클라이언트는 브라우저·확장 주입 스크립트 오류(`__firefox__`·`window.ethereum`·extension URL)를 `ignoreErrors`/`denyUrls` 로 거른다.

---

## 이월 응답

- **이월 면제는 글자 비교 하나로 판정하고 저장 축을 만들지 않는다** (CONTEXT.md 「이월 면제」). 판정 재료는 `lib/survey/prior-answers.ts` 의 `priorAnswerText`/`priorOptionText` 이고 판정은 `isUntouchedPriorValue` 하나다. 이월 응답은 응답 화면에 진입할 때마다 다시 읽히므로, 「응답자가 손댔는가」를 담는 저장 축(응답 안 사이드카·별도 컬럼)을 새로 만들지 않는다 — 원본과의 글자 비교만으로 판정한다.
