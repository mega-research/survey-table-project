# 서버 — src/server

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 디렉터리 구조

```
src/
├── server/                     # oRPC 백엔드 — 코어 + 도메인 12개 (경량 DDD: domain 순수 · procedures 얇음 · services)
│   ├── context.ts              # createContext (Better Auth 세션 사용자 + db + headers — RSC·procedure 공용)
│   ├── orpc.ts                 # base + pub / authed(내부) / superadmin / account / scoped + withRateLimit
│   ├── router.ts               # 전체 도메인 router 합성 (AppRouter)
│   ├── handler.ts              # RPCHandler (+ Sentry onError)
│   ├── openapi.ts              # OpenAPI 핸들러 (ENABLE_PUBLIC_API 게이트)
│   ├── rpc-logging.ts          # 전 procedure 구조화 로그 미들웨어
│   ├── rpc-error-policy.ts     # 에러 → RPC 코드 매핑
│   ├── rpc-timeout.ts          # 타임아웃 가드
│   ├── health.ts               # health procedure (코어 옆)
│   ├── data-scope.ts           # 요청이 어느 파티션(실/테스트)을 보는가 + 쓰기 잠금 — context 와 같은 계층
│   ├── work-scope.ts           # 요청이 어느 **팀 경계**를 보는가 (팀 | 시스템 전체 보기 | 없음) — data-scope 의 형제
│   ├── rpc-work-scope.ts       # 위 거부의 RPC 어댑터 — toRpcWorkScopeError(WorkScopeError→FORBIDDEN, 티켓 15)
│   ├── access-link.ts          # 링크 세션 판정 코어 (ADR-0026·0029, 구 fieldwork-link) — 토큰으로 「이 링크가 열리는가」(입구 화면·RSC)
│   │                           # + 입력의 설문 id 로 「이 요청의 주체가 누구인가」(resolveLinkActorForSurvey, scoped 베이스 — **외주 전용**)
│   │                           # 거부는 셋 — no_session(그 설문이 없다) · invalid(다시 접속) · closed(종료·삭제·배치 대기 + 외주만 중단)
│   │                           # 입구가 종류별이다: resolveLinkActor·resolveAccessLinkEntry·authenticateAccessLink(외주)
│   │                           # ↔ resolveClientLinkActor·resolveClientLinkEntry·authenticateClientLink. **종류는 WHERE 에 건다** —
│   │                           # 어긋난 종류의 토큰은 닫힌 링크가 아니라 없는 링크다
│   ├── fieldwork-proxy.ts      # 대리 응답 판정 코어 — 자격은 contacts.writeAttempts 하나이고 두 모델(링크·옛 실사 계정)이 같은 문을 지난다
│   │                           # 돌려주는 것은 **귀속과 차단뿐** (배너가 사라져 표시용 필드가 없다) + stampFieldworkAttribution
│   ├── rpc-fieldwork-proxy.ts  # 위의 RPC 어댑터 — 완료 대상 대행 진입 → FORBIDDEN
│   ├── page-fieldwork-link-access.ts # 외주 링크 콘솔 RSC 관문 — 접속 전·닫힘은 입구 화면으로 redirect, capability 부족만 notFound
│   ├── page-client-link-access.ts # 클라이언트 링크 콘솔 RSC 관문 (ADR-0029) — assertClientLinkPageAccess(token, tab?).
│   │                           # 토큰으로 세션을 세우고 operations.view 뒤에 **탭 화이트리스트**를 다시 묻는다. 설문 id 를
│   │                           # 받지 않고 돌려준다. 접속 전·닫힘은 입구로 redirect, 탭 밖은 사유 구분 없이 notFound
│   ├── survey-access.ts        # 설문 capability 판정 단일 정본 — resolveSurveyCapabilities(순수) + denialReasonFor(거부 사유 정본) + assertSurveyCapability(관문)
│   │                           # 주체 어휘는 `Actor = SurveyAccessUser | LinkActor` — **판별자가 링크 쪽에만** 있어 기존 호출부가 수정 없이 통과한다(ADR-0026)
│   │                           # 「누가 넣었는가」의 두 칸(계정·링크)은 attributionOf 가 주체에서 파생시킨다 — 잘못된 조합이 타입상 만들어지지 않는다
│   │                           # + assertSurveyCapabilityBatch(여러 설문·여러 capability 를 한 왕복으로 — 담기 200건용, 티켓 12)
│   ├── rpc-survey-access.ts    # 관문의 RPC 어댑터 — assertSurveyCapabilityRpc(not_found→NOT_FOUND 존재 은닉 / forbidden→FORBIDDEN) + toRpcSurveyAccessError
│   │                           # + assertSurveyCapabilityBatchRpc(배치 짝)
│   │                           # + assertScopedSurveyCapabilityRpc(비내부 계정도 지나는 표면 표시 — 판정은 코어 하나, 티켓 21 이 게스트 분기를 걷었다)
│   ├── page-survey-access.ts   # 관문의 RSC 페이지 어댑터 — assertSurveyCapabilityPage(사유 불문 notFound 접기)
│   │                           # + assertSurveyConsolePageAccess(게스트 허용 콘솔 페이지용 — requireAuth 포함, viewer 반환)
│   ├── response-filters.ts     # 어느 응답 행이 보이는가 (활성·삭제됨·완료·비테스트) — data-scope 의 형제, 8구역 공용
│   └── <domain>/               # survey-builder · survey-response · survey-document · operations · contacts
│       │                       # · mail · analytics · library · auth · media · quota · workspace
│       │                       # survey-document = 조사표 PDF·영역 앵커 (2026-09-03 신설, 자기 테이블 2개·procedures 2·services 4)
│       ├── domain/             # zod 계약 + 순수 규칙 (**client-safe** — server-only·Node·DB 의존 0. zod 는 런타임 의존이라 'import 0' 이 아니다)
│       │                       # UI 도 쓰는 모양은 shared/contracts 소관 — 여기는 그것을 다시 내보내고 서버 전용 입력·규칙만 남긴다
│       ├── procedures/         # oRPC procedure (authed/scoped/pub, 얇은 위임) + colocated *.test.ts
│       └── services/           # 비즈 로직 + drizzle (server-only, requireAuth/revalidatePath 없음)
│                               # 도메인 간 직접 import 금지(ESLint), 내부는 상대경로. 타 도메인 테이블 직접 쿼리는 허용
│   ├── read-models/            # 여러 도메인 테이블을 **읽기만** 하는 projection (설문 구조 · 버전 스냅샷 · 응답 · 보관함 분류 · 컨택 read model · 초대 조회 · 결과코드 · 쿼터 모수 · 설문 제어 플래그 · 템플릿 변수 카탈로그 · 응답내역 컬럼 스킴 · ID 목록 토큰 조회 contact-id-lists · 조사 대상 필터 해석 contact-filter-resolution(하위 파서 contacts-filter-parse) · 조사 대상 목록 조립 contacts-list-page · 컨택원 선택지 contact-assignment-options · 발송 주소 send-address · 앵커 행→스냅샷 매퍼 anchor-row · 팀 멤버십 · 활성 팀 목록 · 설문 소유자 이메일 · 실사 홈 설문 목록)
│   │                           # 자기완결 — 도메인을 import 하지 않는다(ESLint). 구 src/data
│   │                           # survey-structure 의 getSurveyById 는 React cache — **사본을 만들지 말 것**(cache 가 갈리면 RSC dedupe 가 깨진다)
│   │                           # version-snapshot 의 snapshotQuestions 는 비배열을 빈 배열로 접는다 — "구조가 깨졌다" 와 "질문이 없다" 를
│   │                           # 갈라야 하는 자리(응답 이관의 생존 판정 등)에서는 쓰지 말고 호출측이 직접 Array.isArray 로 볼 것
│   ├── workflows/              # 여러 도메인의 **쓰기를 조율**하는 흐름. 이 층만 도메인을 부를 수 있다
│   │                           # 결합을 없애는 게 아니라 한곳에 모아 보이게 하는 자리 — 파일이 늘면 그 자체가 신호다
│   │   ├── test-mail-archive.ts  # 테스트 파티션 메일 보관·삭제 흐름 (mail·contacts 쓰기를 함께 조율)
│   │   ├── test-version.ts       # 테스트 버전 맞추기 ensureTestVersion — 빌더 진입(survey-read)과 테스트 응답 저장(survey-response)이 부른다
│   │   ├── user-rehire.ts        # 재입사 — 상태 전이(auth)와 팀 배정(workspace)을 한 트랜잭션으로 (티켓 14)
│   │   └── jobs/                 # Inngest 함수 5개 + index (구 lib/inngest/functions). 잡은 도메인을 부르므로 여기가 집이다
│   └── storage-lifecycle/      # R2 유예 삭제 큐·발송 장부·참조 인덱스 (자체 r2_* 테이블만 만지는 독립 모듈)
│
│   ※ "여러 도메인이 쓴다"는 공용의 근거가 아니다 — 역할로 묶이지 않으면 제2의 lib 가 된다
│
```

---

## 인증과 권한

> 이 절은 설문 관문·procedure 베이스·capability 코어만 담는다. 나머지는 코드 옆 문서에 있다 — 팀·소유권·참여자·그룹·재배치·링크·옛 계정 모델은 `src/server/workspace/AGENTS.md`, 계정 수명주기·프로필·발급 입구는 `src/server/auth/AGENTS.md`, 세션·게이트·로그인·유형별 목적지는 `src/lib/auth/AGENTS.md`.

- **설문 삭제는 soft delete 다**(티켓 17, 스펙 §4 「삭제 전제」). `deleteSurvey` 가 `deleted_at`
  을 찍을 뿐이라 질문·응답·컨택·메일이 전부 남는다 — 예전 `tx.delete` + CASCADE 는 참여자
  (티켓 18)에게 삭제권이 넓어지는 전제와 맞지 않았다. **복구(`surveyBuilder.surveys.restore`)는
  슈퍼어드민 전용이고 capability 관문을 쓰지 않는다** — 코어가 삭제된 설문을
  `deleted_at IS NULL` 로 걸러 언제나 not_found 를 주기 때문이고, 그 필터를 느슨하게 하면
  「삭제는 안 보인다」가 통째로 무너진다. 소유자·팀장에게 열지 않는 것도 의도다: 되돌리는 일이
  흔해지면 삭제가 실질적인 아카이브가 된다. 복구가 팀·소유자·상태를 **되돌리지 않는 것**이
  요점이다 — 삭제가 애초에 건드리지 않으므로 되살릴 것은 `deleted_at` 하나다.
  **조회는 두 갈래로 닫힌다.** 관문이 있는 내부 표면은 capability 코어 하나가 닫으므로
  티켓 09~11 이 배선한 전 표면이 자동이고, **관문이 없는 응답자(pub) 경로는 각자 조건을
  건다** — `getSurveyBySlug`·`getSurveyByPrivateToken`·`getSurveyByPreviewToken`·
  `getQuotaConfig`. 토큰은 삭제된 설문을 여는 마지막 열쇠라 특히 그렇다. read-model 의
  `getSurveyById` 한 줄이 빌더 상세·운영 RSC·미리보기·`getSurveyForResponse`·변수 카탈로그·
  복제를 한꺼번에 닫는다(삭제된 행을 일부러 읽어야 하는 곳은 자기 쿼리를 따로 쓴다 —
  플래그를 달면 기본값이 호출부마다 갈리고 React cache 키도 함께 깨진다).
  **R2 는 관행 그대로 후보를 등록하되 실제로는 지워지지 않는다** — `REFERENCE_SURFACE` 의
  `surveys`·`questions` 에 deletedAt 술어가 **없어** 살아남은 행이 참조를 계속 주장하기
  때문이다. 바로 옆 `mail_templates` 가 반대 선례라 「일관성」을 이유로 술어를 달기 쉬운데,
  달면 삭제 7일 뒤 파일이 지워지고 그 뒤의 복구는 이미지·첨부가 빠진 설문을 되살린다
  (`reference-surface.test.ts` 가 이 자리를 못 박는다). 옛 `deleteKeyRefsBySourceIds` 는
  뺐다 — 「행이 소멸하는데 인덱스만 남는다」는 전제가 사라졌다.
  화면은 **시스템 전체 보기 툴바의 「삭제됨 N」 칩**이다. 상태 칩의 다섯 번째 값이 아니라
  별개의 모드다(칩은 받아온 목록을 접고 이쪽은 조회를 바꾼다). `deletedCount` 가 **null 이면
  이 화면에 휴지통이 없다** — 「비어 있는 휴지통」과 「볼 수 없는 사람」이 같은 그림이 되면
  안 되기 때문이다. 휴지통 카드(`DeletedSurveyCard`)도 별개 컴포넌트다.
  검증은 둘로 나뉜다 — `tests/integration/soft-delete-surface-inventory.test.ts`(기본 게이트,
  새 pub 표면이 붙으면 등재를 강요)와 `soft-delete-invisibility.realdb.test.ts`(등재된 표면이
  실제로 거부하는지). 목이 돌려주는 행은 언제나 테스트가 정한 행이라 WHERE 절은 실 DB 로만
  보인다.
- **설문 접근 판정은 `server/survey-access.ts` 하나가 한다**(티켓 07, 스펙 §8). `data-scope` 가
  "어느 파티션을 보는가" 를 정하듯 이쪽이 "무엇을 할 수 있는가" 를 정하는 코어다. 순수 함수
  `resolveSurveyCapabilities` 의 **순서가 곧 정책**이다 — 계정 유형 → 슈퍼어드민 → 팀 미배치 →
  배치 대기 → **소유자(소유 팀 소속일 때만)** → 소유 팀 팀장 → 참여자 → 팀 공개 설문의 팀원.
  소유자 분기가 소유 팀 소속을 함께 묻는 것이 이 코어의 **revocation 계약**이다 — 소유자
  일치만 보면 A팀 설문 소유자가 A팀에서 제외돼도 다른 팀 겸직이 남아 있는 한(팀 미배치 가드는
  "아무 팀에나 속했는가"만 묻는다) 그 설문 전권을 계속 행사한다. 팀을 접근 경계로 삼는 계약이
  제외로 끊기지 않으면 경계가 아니다(Codex 적대적 리뷰). 설문이 고아가 되지는 않는다 — 소유 팀
  팀장과 슈퍼어드민이 언제나 남고 정식 이전은 티켓 19 다. `invite_only` 는 마지막
  하나(팀원)만 지운다: v2 에서 그 뜻이 "소유 팀 **팀원에게만** 숨김" 으로 바뀌었고, 팀장까지 막으면
  팀장이 자기 팀 설문을 관리할 수 없어 승계·해산이 잠긴다. 팀 미배치 사용자는 **초대 설문을 포함해**
  전부 차단이고(CONTEXT.md 「팀 미배치 사용자」), 배치 대기 설문은 소유자에게도 닫힌다 — 팀이 정해지기
  전에는 아무도 열 수 없다(ADR-0006). **게스트는 이 사슬을 타지 않는다** — 팀도 소유권도 없어
  4~8번이 무의미하고 자격은 「이 설문에 부여됐는가」 하나뿐이다(`src/server/workspace/AGENTS.md` 의 게스트 절). 실사는 부여
  모델이 붙기 전까지 기본 거부다(티켓 24).
  **매트릭스 검증은 두 파일이 방향을 나눠 진다.** `src/server/survey-access.test.ts` 는 분기를
  **열 단위**로 서술하고(왜 그렇게 되는가), `tests/integration/capability-matrix-spec.test.ts`
  는 스펙 §8 표를 **행 단위**로 옮긴다(티켓 23 C 검증 게이트). 어긋나면 표가 이긴다. 둘 다
  프리셋 상수를 다시 읽어 비교하지 않는다 — 그러면 구현이 스스로를 채점해 매트릭스가 바뀌어도
  GREEN 이 유지된다. 표 쪽에는 **완전성 가드 둘**이 함께 있다: 모든 capability 어휘가 정확히
  한 행에 있고(어휘가 늘면 행을 강요받는다), 각 열의 판정 결과가 그 열의 O 칸과 **정확히
  같다**(판정이 표에 없는 것을 더 줘도 잡힌다). 셀 단언만으로는 표가 자기 누락을 모른다.
- **관문 배선(티켓 09·10 완료분)**: 빌더·분석·운영 콘솔 도메인의 surveyId procedure 전수가
  handler 첫 줄에서 capability 관문을 지난다. 매핑 — 조회 survey.view · 운영 제어·현황 조회
  operations.view · 응답 조회·응답 상세 편집 responses.view · 응답 관리 4종(삭제·복원·초기화·
  재응답 허용) responses.manage · 컨택 열람
  contacts.view · 컨택 관리·업로드·결과코드 어휘·수신거부 해제 contacts.manage · 결과코드
  회차 쓰기 contacts.writeAttempts · 메일 조회 mail.view · 캠페인·템플릿·테스트 발송 mail.send ·
  조사 대상 단건 발송·그 미리보기(contactSample) mail.sendSingle ·
  내보내기 export.download · mutation(운영 제어·쿼터 저장·컬럼 픽커 저장 포함) survey.edit ·
  발행 survey.publish · 삭제 survey.delete · 분석 analytics.view. **단 분석 RSC 화면 둘
  (`/analytics/[surveyId]`·`/surveys/[id]/analytics`)은 `responses.view` 도 요구한다** —
  `getResponsesWithAnswers` 로 복호화된 원문 응답과 응답자 추적 필드를 클라이언트 props 로
  직렬화하므로 RSC payload 에 그대로 실린다(analytics **RPC** 는 집계 스키마로만 나가 종전대로
  analytics.view 다). 두 화면이 갈리지 않게 `tests/repo/analytics-page-guards.test.ts` 가 묶는다.
  거부 사유의 정본은 코어
  `denialReasonFor` 하나다 — **survey.view 가 없으면 forbidden 이 아니라 not_found**(id 스캔으로
  타 팀 설문 존재 확인 차단), 보이는 설문의 권한 부족만 forbidden. authed 표면은
  `assertSurveyCapabilityRpc`, **scoped 표면(비내부 계정도 지나는 문)은 `assertScopedSurveyCapabilityRpc`**
  — 티켓 21 이 게스트 분기를 걷어 지금은 코어 판정에 그대로 위임한다. 이름을 남기는 이유는
  **표면의 청중을 코드에 적어 두기 위해서**이고, tests/repo 의 정적 가드도 그 구분을 본다.
  `control.get` 만 관문 NOT_FOUND 를 null 로 접는다(미저장 설문의 빌더 헤더 10초 폴링 OFF 폴백
  규약). `saveWithDetails` 만 관문이 procedure 가 아니라 **서비스 트랜잭션 안**에 있다 — 생성/갱신
  한 입구라 존재 판정과 쓰기를 갈라놓으면 tombstone 부활·생성 레이스가 된다. 무관문 예외는
  **둘뿐**이고 전부 사유가 주석에 있다 — 보관함(library, surveyId 없는 조직 공용)·
  `uploads.parsePreview`(무상태 엑셀 파싱). 둘 다 `authed` 라 내부 계정만 지난다.
  `media.deleteMailAttachmentTmp` 는 셋째였는데 티켓 21 이 `scoped`→`authed` 로 옮겼다 —
  메일은 게스트에게 항상 차단이라, 관문을 달 수 없는 문(입력에 surveyId 가 없다)을 비내부
  계정에 열어 둘 이유가 사라졌다. **그래서 scoped 베이스에는 무관문 표면이 하나도 없다.**
  billing 은 설문 스코프가 아닌 전역 정산이라 범위 밖. 옛 `assertSurveyAccess`(orpc.ts)·
  `SurveyOwnershipError`(require-survey-ownership)는 걷었다. **REST 표면(티켓 11)**: export 3종
  (export·split-preview·contacts export)은 `server/rest-survey-access.ts` 의
  `checkScopedSurveyCapabilityRest`(not_found→404 존재 은닉·forbidden→403)로 `export.download` 를
  진다. **게스트·실사에게 export 는 항상 차단**이다(티켓 21) — `requireAuth` 가 비내부 계정을
  들이지 않고, 설령 들어와도 게스트 열에 `export.download` 가 없다. 업로드 REST 3종은 surveyId 없는 tmp 네임스페이스 전용이라 의도된 면제
  (`lib/upload/route-guard.ts` 주석) — 영구 승격 경로(설문 저장·템플릿 저장·media.*)가 관문을 진다.
- **관문 배선의 검증은 라우터 열거가 진다**(티켓 15, B 검증 게이트). 손으로 적은 목록만 도는
  음성 스위트는 새로 붙은 표면을 영원히 초록으로 두므로, `tests/helpers/rpc-surface.ts` 가
  `@/server/router` 를 런타임에 훑어 표면 목록을 만든다 — 베이스는 **미들웨어 동일성**으로
  (authed·account·scoped 는 길이가 같지만 두 번째 미들웨어가 서로 다른 객체다), 입력 키는
  zod object 의 shape 으로 읽는다. **`surveyId`·`surveyIds` 를 받는 authed·scoped procedure 를
  새로 만들면 `tests/integration/cross-team-idor-rpc.test.ts` 의 인벤토리에 등재해야 한다** —
  등재하지 않으면 그 파일이 즉시 빨개진다(그것이 「누락 표면 없음」의 증명이다). 키 이름이
  다르거나(`id`) 입력이 zod object 가 아닌 표면은 자동 탐지가 못 보므로 별칭 목록에 적는다.
  음성 스위트는 두 축이다 — **타 팀 설문 id 주입**(전 표면 NOT_FOUND + 요구 capability 고정,
  db mock 이 서비스 도달을 사고로 만든다)과 **내 설문 + 남의 하위 행**
  (`cross-team-idor.realdb.test.ts` — 관문이 통과한 뒤 남는 축이라 실 DB 로만 보인다).
  같은 열거 위에 **게스트 축 둘**이 더 서 있다(티켓 21·23) — `guest-account-denial.test.ts`
  가 authed·superadmin 전수를, `guest-cross-survey.realdb.test.ts` 가 **scoped 전수**를 각각
  인벤토리로 고정한다. 후자가 실 DB 인 이유는 팀 축과 다르다: 게스트의 자격은 참여 행 조인의
  결과라, 목의 `rowsFor` 가 어떤 id 에도 같은 행을 주는 한 「부여됐는가」가 검증되지 않는다.
  후자에서 **거부와 「조용한 무동작」을 갈라 적는다**: 응답 관리 4종·질문 삭제·문항 그룹 삭제는
  WHERE 에 surveyId 가 함께 걸려 0행이 영향받고 표면은 그대로 `{ok:true}` 를 준다. 보안상으로는
  거부와 같지만 부류를 적어 두지 않으면, 나중에 누가 `surveyId` 조건을 빼도 「원래 ok 를 주던
  표면」으로 보여 리뷰를 통과한다. RSC 콘솔 페이지·REST export 라우트는 라우터가 없어
  파일 시스템을 훑는다(`tests/repo/survey-boundary-guards.test.ts` — `rsc-page-guards`(인증)·
  `analytics-page-guards`(렌더 내용)와 분담이 갈린다: 이쪽은 **어느 설문인가**를 본다).
  **정적 가드는 「관문 이름이 파일에 있다」까지만 증명한다** — 그 호출이 민감 조회보다 먼저
  서는지는 못 본다. 실제로 티켓 15 에서 컨택·응답 상세 RSC 가 관문을 지난 뒤 하위 행을
  **설문 경계 없이 읽어 복호화**하고 있었다.
- **관문이 통과한 뒤에도 남는 축이 있다 — 「내 설문 + 남의 하위 행」**(티켓 15). 관문은 경로의
  설문만 보므로, 서비스의 WHERE 에 `surveyId` 가 함께 들어 있지 않으면 남의 팀 컨택·응답·
  템플릿·캠페인이 그대로 움직인다. **하위 행 id 는 전역 PK 라 FK 도 설문 경계를 모른다.**
  세 가지가 이 축의 규칙이다.
  ① **조회는 조건이지 사후 확인이 아니다** — `getContactDetailById`·`getResponseById` 는
  `surveyId` 를 WHERE 로 받는다. 사후 비교로 두면 그 사이에 PII·응답 원문이 이미 복호화된다.
  ② **payload 가 들고 오는 참조도 검사한다** — `question.groupId`·`group.parentGroupId` 는
  `assertGroupReferenceBelongsToSurvey`(단건)와 survey-save 의 배치 판이 본다. **없는 id 도
  같은 사유로 접는다**(갈라 두면 FK 오류 500 과 거부의 차이가 존재 오라클이 된다).
  ③ **거부는 RPC 어휘로 나가야 한다** — 문자열 `Error` 로 던지면 rpc-error-policy 가 500 으로
  마스킹해, 정확히 거부된 요청이 화면에는 「내부 오류」로 보인다. 컨택·회차·캠페인·단건 발송·
  reorder 가 그랬다(티켓 15 가 매핑). 이 축의 음성 검증은 목으로는 못 한다 — 목이 돌려주는 행은
  언제나 테스트가 정한 행이라 WHERE 절이 무엇이든 통과하므로 `*.realdb` 로 간다.
- **RSC 페이지는 자기 가드를 갖는다.** App Router 는 소프트 내비게이션에서 상위 레이아웃을
  다시 돌리지 않는다 — 콘솔 RSC 는 procedure 가 아니라 service 를 직접 부르므로 레이아웃만
  믿으면 세션이 폐기된 뒤에도 데이터를 읽는다. 서버 데이터를 부르는 `page.tsx` 는 전부
  `requireAuth`·`requireAdminPage`·`assertSurveyConsolePageAccess` 중 하나를 부르고,
  `tests/repo/rsc-page-guards.test.ts` 가 빠뜨림을 잡는다(무인증 응답자 표면만 허용 목록).
  설문 콘솔 페이지의 capability 는 `[id]` 레이아웃이 survey.view 를 한 번 접고 leaf 가 자기
  정밀 관문을 가진다 — 게스트 허용 화면은 `assertSurveyConsolePageAccess(surveyId, cap)`,
  게스트 차단 화면(컬럼 스킴·결과코드·업로드·쿼터)은 `requireAdminPage` +
  `assertSurveyCapabilityPage` 짝. 구 `assertGuestSurveyPageAccess`(guest-page-guard)는 티켓 10
  이 걷었다.
- REST 라우트·RSC 는 `lib/auth.ts` 의 `requireAuth`(세션 + status='active' + userType='internal')를 쓴다 — oRPC `authed` 와
  같은 정책이라 REST 가 형제 우회 경로가 되지 않는다. admin 전용 RSC 는 `requireAdminPage` 가 게스트도 막고, 전역 관리 RSC 는 `requireSuperadminPage` 가 슈퍼어드민만 통과시킨다(둘 다 거부는 notFound).
- procedure 베이스 5종 (`server/orpc.ts`):
  - **`pub`** — 인증 불필요 (응답자 표면: 응답 mutation·공개 설문 조회·컨택 attrs·수신거부 lookup). 남용 방지가 필요한 표면은 `.use(withRateLimit(group))` 부착.
  - **`authed`** — 세션 + `status === 'active'` + `userType === 'internal'`. 비활성 계정은 세션이 이미 있어도 FORBIDDEN(발급 후 상태가 바뀐 경우). 티켓 21 전에는 env grant 보유자를 userId 로 한 번 더 걸렀는데, 게스트가 계정 유형이 되면서 그 줄이 사라졌다.
  - **`superadmin`** — `authed` + `isSuperadmin`. 전역 관리 표면(사용자 관리·계정 상태 전이·비밀번호 재설정·**실사 업체**) 전용. 페이지 쪽 짝은 `requireSuperadminPage`.
  - **`account`** — 세션 + active. **계정 유형을 보지 않는다.** 프로필처럼 "누구든 자기 것만 만지는" 표면 전용(`auth.getProfile`·`updateProfile`·`updatePassword`). 아바타 정책 상수는 `lib/upload/image-policy.ts` 의 `AVATAR_UPLOAD_POLICY` 한 곳에 있고 라우트와 화면이 같은 값을 본다. 자기 것만 만진다는 보장은 베이스가 아니라 handler 가 한다 — 대상 id 를 입력에서 받지 말고 `context.user.id` 를 쓸 것. REST 짝은 `requireActiveAccount`, 페이지 짝은 `requireAccountTypePage`.
  - **`scoped`** — 세션 + active (비내부 계정 포함) **또는 외주 실사 링크 세션**(ADR-0026). **베이스는 유형으로 막지 않지만 handler 관문이 막는다** — 판정은 capability 코어 하나이며, 게스트 열에는 이 표면들이 요구하는 capability(컨택·메일·응답 상세·export)가 하나도 없어 전부 거부된다. **링크 주체는 계정이 없어 `context.user` 가 null 이라, handler 는 `context.actor` 로 주체를 읽는다** — 계정이 있으면 계정이 이기고(연구원이 자기 링크를 눌러 본 브라우저에서 admin 콘솔이 조용히 깎이지 않게), 없으면 입력의 설문 id 로 `fw_<token>` 쿠키를 골라 링크 행과 대조한다. **이 문을 지나는 링크는 외주 실사 링크뿐이다** — 클라이언트 링크의 쿠키(`cl_<token>`)는 path 가 `/client/<token>` 이라 `/api/rpc` 에 실리지 않고, 실려도 세션 목록(`readFieldworkLinkSessions`)에 서지 않으며, 값을 외주 이름으로 바꿔 세워도 그 토큰의 행이 외주 종류가 아니라 무효다(세 겹 — `client-link.realdb` 가 scoped 전수를 그 위조로 두드린다). 거부가 셋으로 갈린다 — 다른 링크 세션은 있는데 이 설문의 것이 없으면 **NOT_FOUND**(그 주체에게 없는 설문), 세션이 없거나 더는 유효하지 않으면 **UNAUTHORIZED**, 자기 설문의 권한 밖은 **FORBIDDEN**. 계정 전용 scoped 표면(메일 탭 쓰기)이 세션 계정을 읽는 문은 `requireScopedAccount` 하나다 — 단건 발송·응답 수정은 ADR-0027 이 링크에 열어 주체에서 귀속을 파생한다(`attributionOf`). **실사는 티켓 25 가 컨택 축을 열어 이 베이스를 실제로 지나는 첫 비내부 유형이 됐다** — 그래서 「어디까지 열렸는가」의 경계를 `fieldwork-account-denial` 이 어휘 전수로 고정한다. 인증 가드가 `account` 와 더는 같지 않지만 **별개의 베이스로 둔다**는 이유는 그대로다 — 지는 계약이 달라서(이쪽은 설문 일치 강제, 저쪽은 자기 것만), 별칭으로 묶으면 한쪽을 조일 때 다른 쪽 전 표면이 조용히 따라 바뀐다. **이 베이스를 쓰는 procedure는 핸들러 첫 줄에서 `assertScopedSurveyCapabilityRpc(context.actor, input.surveyId, '<cap>')` 호출 필수** — 예외 없음(티켓 21 이 마지막 예외를 `authed` 로 옮겼다). 그 사실은 `cross-team-idor-rpc`·`guest-account-denial`·`fieldwork-account-denial`·`fieldwork-link-denial` 네 스위트가 각각 목록으로 고정한다 — 마지막 것이 링크에게 열리는 scoped 표면이 **정확히 열**(회차 3 · attrValues 2 — list·nonNumericCount · idLists · setMemo · 응답 수정 저장 · 단건 발송 · 단건 미리보기 contactSample)임을 라우터 열거 위에 세운다(`tests/helpers/scoped-surface-inputs` 의 `LINK_OPEN_SCOPED_PATHS`). 같은 스위트가 **pub 인 링크 세션 표면이 넷**(`accessLinkSession.authenticate`·`signOut` + 클라이언트 짝 `authenticateClient`·`signOutClient`)임도 고정한다 — 종류별로 표면을 가른 것은 로그가 적는 것이 RPC 이름이라서다.
- **위임만 하는 가드 셋(`requireAdminPage`·`assertScopedSurveyCapabilityRpc`·`checkScopedSurveyCapabilityRest`)이
  남아 있는 이유는 하나다** — 이름이 **표면의 청중**을 적기 때문이다. 티켓 21 이 게스트 분기를
  걷으면서 셋 다 본문이 한 줄 위임으로 줄었지만, 「이 페이지는 관리 화면이다」·「이 문은 비내부
  계정도 지난다」는 사실은 호출부에서 읽혀야 하고 `tests/repo` 의 정적 가드도 그 이름으로 목록을
  만든다. 합치면 어느 문이 누구에게 열려 있는지가 코드에서 사라진다. 실사(티켓 24)가 코어에
  자기 열을 얻으면 이 셋의 본문은 그대로 둔 채 판정만 늘어난다.
- **계정 유형 게이트**: `authed`·`requireAuth` 는 `userType === 'internal'` 만 통과시킨다(`isInternalUser`,
  세션에 실려 오는 값). 사용자 관리에서 발급한 guest·fieldwork 계정은 로그인은 되지만 내부 표면
  (설문·운영·export·업로드)에는 들어오지 못한다. 각자의 콘솔은 `scoped` 등 자기 가드로 열린다.
  `readSessionUser` 의 안전 기본값은 'guest' — 값이 없으면 내부를 열지 않는 쪽으로 접는다.
- 게스트·실사 콘솔과 **링크 둘(외주 실사 · 클라이언트)**은 전역 테스트 모드와 무관하게 항상 실데이터를 본다 —
  술어는 「내부가 아닌가」 하나이고, 계정은 `isExternalViewer`(세션), 주체를 받는 자리는
  `isExternalActor`(`server/data-scope`)가 답한다.

---

## 테스트 모드

두 겹이다(2026-10-16). **설문의 테스트 환경**(`surveys.testModeEnabled` + `testToken`)은 모두에게 같고 테스트 링크·테스트 대상자 링크가 사는지만 정한다(응답자 쪽 판정은 그대로 이 플래그). **콘솔이 테스트 파티션을 보는지는 브라우저마다** 쿠키 `ops-test-view-<surveyId>`(`lib/operations/test-view-cookie.ts`)로 정한다 — 전에는 한 사람이 켜면 모든 사람의 콘솔이 테스트 데이터로 바뀌었다. 파티션 키는 `is_test` 컬럼(`contact_targets`, `survey_responses`, `mail_campaigns`)이며, `contact_targets`의 resid UNIQUE도 `(surveyId, isTest, resid)`다.

- 읽기/쓰기 파티션은 `server/data-scope.ts`가 단일 결정한다 — `resolveWriteScopeIsTest(전역 플래그, 외부 주체 여부, 브라우저 쿠키)` 가 **전역 ON ∧ 쿠키 ON ∧ 외부 주체 아님**일 때만 test 다. 읽기 `loadOperationsDataScope`·쓰기 `lockWriteScope` 둘 다 쿠키를 `readBrowserTestView` 로 읽는다(요청 밖이면 false). 신규 집계·목록 쿼리는 이 스코프를 반드시 태울 것. **`testModeEnabled` 를 직접 읽어 콘솔 파티션을 정하지 말 것** — 실데이터 업로드 가드(`contact-uploads`)도 그래서 이 함수를 쓴다.
- 토글(`features/operations/test-mode-control.tsx`, 시안 `pencil/테스트모드_드롭다운_시안.pen`): 버튼 자체는 아무 동작이 없고 호버·클릭으로 메뉴 넷을 연다 — 「테스트 모드」 스위치(설문 단위, 끌 때 보관/삭제 확인 창) · 테스트 링크 복사 · 「테스트 데이터 보기」 스위치(브라우저 단위 쿠키) · 테스트 조사 대상자 생성. 테스트 모드가 꺼져 있으면 아래 셋은 막힌다. **테스트 모드를 켜도 보기는 자동으로 켜지지 않는다**(따로 켠다). 대상자 생성은 테스트 파티션에 쓰므로 실데이터를 보는 채로 누르면 보기를 함께 켠다. 버튼 모양: 꺼짐=회색 · 켜짐=주황 테두리+ON · 이 브라우저가 테스트 데이터를 보는 중=꽉 찬 주황 「테스트 데이터 보는 중」. 테스트 모드가 꺼졌는데 쿠키가 남으면 콘솔이 지운다(다시 켜질 때 묻지 않고 테스트 보기로 돌아가지 않게).
- **외부 주체(게스트·실사 계정·외주 실사 링크·클라이언트 링크)는 항상 real 파티션**(읽기/쓰기 모두) — read/write 비대칭을 막기 위한 의도적 처리. 판정은 「내부가 아닌가」 하나이고 접근제어가 아니라 **파티션** 축이다. 계정은 `isExternalViewer`(세션을 읽는다), 주체를 받는 자리는 `isExternalActor` — 링크 세션에는 계정이 없어 앞의 것이 던지기 때문이다(`loadOperationsDataScope(surveyId, actor?)`). 티켓 25 에서 게스트 전용이던 이 규칙이 넓어졌다: 실사가 `contacts.view`·`contacts.writeAttempts` 를 얻으면서 컨택 표면이 실제로 열렸는데, 게스트만 고정하면 담당 연구원이 테스트 모드를 켠 설문에서 **실사원이 test 파티션을 읽고 결과코드를 test 로 쓴다** — 밖에서 전화를 돌리는 사람이 실데이터를 못 본다. 술어를 「게스트인가」가 아니라 **「내부가 아닌가」**로 적는 것이 요점이다.
- 테스트 응답 회차는 `test_response_attempts`가 추적(활성 회차는 responseId당 1개).
- **테스트 버전**(2026-10-23, 0141 — CONTEXT.md 「테스트 버전」이 정본): 테스트 링크 · 테스트 대상자 링크 · 관리자 미리보기(`(internal)/surveys/[id]/preview`)는 배포본이 아니라 **저장본으로 만든 스냅샷**을 본다 — 저장만으로 응답 확정 · 자격미달 · 종료 이동 · Raw 내보내기까지 테스트하고, 실응답 링크와 공개 미리보기는 배포본 그대로다. 한 번도 배포하지 않은 설문도 테스트 버전이 생긴다. `server/workflows/test-version.ts` 의 `ensureTestVersion` 이 테스트 화면에 들어올 때(`getSurveyForResponse` 의 유효 테스트 세션 · `useTestVersion` · 테스트 응답의 관리자 수정 화면)와 **테스트 응답을 저장할 때마다**(`syncTestVersionBeforeWrite` — 답 저장 · 임시 저장 · 제출, 실응답은 건너뜀) 저장본 스냅샷(배포와 같은 `buildSurveySnapshot`)의 리비전을 지금 테스트 버전과 비교해, 다르면 `survey_versions` 에 `status='test'`·음수 번호 행을 **새로 만들고** `surveys.test_version_id` 를 옮기고 직전 테스트 버전의 snapshot 을 비운다(`pruneVersionSnapshots`, 설문당 advisory lock 으로 한 줄 세움). 행은 배포 스냅샷처럼 불변이라 R2 참조는 만들 때 한 번 기록한다. 빌더 저장 경로마다 장치를 달지 않고 테스트 쪽에서 본다 — 그래서 빌더에서 저장만 해도 진행 중인 테스터의 다음 저장이 멈춘다(배포와 같다). 빌더·응답 두 도메인이 부르므로 workflows 에 있다. 비용은 테스트 응답 저장마다 저장본 스냅샷을 한 번 만드는 것이다(실응답 무관). 테스트 응답이 보는 버전은 `testVersionId ?? currentVersionId` 다(`shared/contracts/survey` 의 `pinnedVersionId` — **테스트는 테스트 버전에만 있다**) — 생성(`loadValidatedVersionGateRow` 의 `{ isTest }` — 실응답이 테스트 버전 id 를 보내도 배포본으로 재핀) · 테스트 대상자(`acquireTestTargetResponse`) · 재개 이관(`lifecycle.ts` 의 `resumeTargetVersionId`) · 관리자 응답 수정(렌더 버전과 `saveAdminEdit` 의 낙관 버전 가드) · 테스트 대상자에게 보내는 개인정보 열(`lookupContactAttrs`) · 테스트 파티션 집계(이탈 퍼널 · 페이지 체류 · 수요 집계 — `read-models/version-snapshot` 의 `loadPinnedVersionSnapshot`). 버전 id 가 바뀌는 것만으로 기존 장치가 돈다: 테스트 중 저장본이 바뀌면 옛 테스트 버전 위의 답 저장 · 임시 저장 · 제출(빈 complete 포함)이 `TEST_VERSION_REPUBLISHED`(「설문이 수정되었습니다 — 새로고침하면 바뀐 곳부터 이어집니다」)로 멈추고, 새로고침하면 재개 이관이 구조 생존 판정으로 답을 거르고 **바뀐 문항**(지문 비교 `lib/survey/test-version-fingerprint` 의 `changedQuestionIds` — 문구·조건 포함, 새 문항, 설정이 바뀐 그룹과 하위 그룹의 문항, 순서만 바뀐 것은 제외)과 지운 문항 중 가장 앞 페이지로 데려간다. 실응답 이관은 지문이 없어 종전과 같다. 배포 번호(`Math.max(최신, 0) + 1`) · 버전 목록(`getSurveyVersions` 두 벌) · 보존 정리(`findPrunableVersionIds` — 지금 테스트 버전 제외)는 테스트 버전을 뺀다. 테스트 응답으로 쿼터를 확인하는 것은 여전히 안 된다(테스트 응답은 쿼터 계산에서 빠진다).

---

## 응답 화면이 보는 명단 값

프리필 토큰·표시 조건이 읽는 명단 값(attrs + 개인정보 열 복호화 값)을 합치는 곳은 `server/read-models/respondent-contact-attrs` 한 곳이다(CONTEXT.md 「이월 값과 본문 프리필 토큰의 우선순위」). 서버 재평가(제출의 숨은 문항 · 계산 칸 · 자격미달, 관리자 수정, 프리필 강제 복원)와 관리자 화면 · 빌더 미리보기는 개인정보 열 전부를 합치고, 응답자 브라우저로 가는 명단 조회(`contacts.attrs.lookup` · `/i/<code>`)만 발행본이 실제로 읽는 열로 좁힌다(`collectReferencedContactKeys`).

**새로 "응답 화면이 보는 명단 값"을 읽는 자리를 만들면 `contactTargets.attrs` 를 직접 읽지 말고 이 로더를 쓸 것** — 서버만 개인정보 값을 못 보면 그 열을 읽는 표시 조건이 서버에서 거짓이 되어 응답자가 본 문항의 답이 제출에서 지워진다. 메일 본문 변수 · 쿼터 속성형 차원 · 내보내기는 합치지 않는다(attrs 만).
