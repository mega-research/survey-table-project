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
│   ├── read-models/            # 여러 도메인 테이블을 **읽기만** 하는 projection (설문 구조 · 버전 스냅샷 · 응답 · 보관함 분류 · 컨택 read model · 초대 조회 · 결과코드 · 쿼터 모수 · 설문 제어 플래그 · 템플릿 변수 카탈로그 · 응답내역 컬럼 스킴 · ID 목록 토큰 조회 contact-id-lists · 앵커 행→스냅샷 매퍼 anchor-row · 팀 멤버십 · 활성 팀 목록 · 설문 소유자 이메일 · 실사 홈 설문 목록)
│   │                           # 자기완결 — 도메인을 import 하지 않는다(ESLint). 구 src/data
│   │                           # survey-structure 의 getSurveyById 는 React cache — **사본을 만들지 말 것**(cache 가 갈리면 RSC dedupe 가 깨진다)
│   │                           # version-snapshot 의 snapshotQuestions 는 비배열을 빈 배열로 접는다 — "구조가 깨졌다" 와 "질문이 없다" 를
│   │                           # 갈라야 하는 자리(응답 이관의 생존 판정 등)에서는 쓰지 말고 호출측이 직접 Array.isArray 로 볼 것
│   ├── workflows/              # 여러 도메인의 **쓰기를 조율**하는 흐름. 이 층만 도메인을 부를 수 있다
│   │                           # 결합을 없애는 게 아니라 한곳에 모아 보이게 하는 자리 — 파일이 늘면 그 자체가 신호다
│   │   ├── test-mail-archive.ts  # 테스트 파티션 메일 보관·삭제 흐름 (mail·contacts 쓰기를 함께 조율)
│   │   ├── user-rehire.ts        # 재입사 — 상태 전이(auth)와 팀 배정(workspace)을 한 트랜잭션으로 (티켓 14)
│   │   └── jobs/                 # Inngest 함수 4개 + index (구 lib/inngest/functions). 잡은 도메인을 부르므로 여기가 집이다
│   └── storage-lifecycle/      # R2 유예 삭제 큐·발송 장부·참조 인덱스 (자체 r2_* 테이블만 만지는 독립 모듈)
│
│   ※ "여러 도메인이 쓴다" 는 공용의 근거가 아니다 — 역할로 묶이지 않으면 제2의 lib 가 된다
│
```

---

## 인증과 권한

- **세션은 Better Auth**(ADR-0018). 인스턴스는 `lib/auth/server.ts` — email+password, UUID user id,
  30일 세션 + 하루 1회 사용 시 연장, `disableSignUp`(공개 가입 없음)·`autoSignIn` 없음·이메일 비밀번호
  재설정 없음(분실은 슈퍼어드민이 새 임시 비밀번호를 지정). sign-in 전 비활성 상태(active 외)를 차단하며
  실패 응답은 미존재 계정과 바디·타이밍까지 동일(더미 해시). 시드는 `pnpm auth:seed`.
- **계정 수명주기**는 `server/auth`(도메인 규칙 + 서비스)와 `/users` 행 케밥이 담당한다.
  허용 전이는 `shared/contracts/auth.ts` 의 `USER_STATUS_TRANSITIONS` 하나가 정하고, 서버 강제
  (`resolveUserStatusTransition`)와 화면 메뉴(`availableUserStatusActions`)가 같은 표를 본다 —
  화면이 표를 따로 들면 "메뉴엔 있는데 누르면 CONFLICT" 가 된다. 전이는 advisory lock + 행 잠금
  아래에서 처리하고(마지막 슈퍼어드민 동시 정지 경합 차단), **모든 전이·재설정이 대상 세션을 전부
  끊고 `user_status_events` 에 감사 행을 남긴다**(재설정은 상태가 그대로라 from=to). 마지막 active
  슈퍼어드민 가드는 "이 전이로 active 가 0명이 되는가"만 묻는다 — 대상이 이미 비활성이면 적용하지
  않는다(그러지 않으면 정지된 슈퍼어드민을 영영 정리할 수 없다). **퇴사의 소유권 승계는 티켓 19 가 붙였고**(멤버십은 일부러 그대로 둔다)
  **재입사의 팀 배정은 티켓 14 가 붙였다**(`server/workflows/user-rehire` — 상태 전이와 배정이 한 트랜잭션).
- **팀 멤버십은 소속의 단일 정본이다**(ADR-0008, 티켓 06). 팀 관리 표면은 `server/workspace` 가
  담당하고 관문은 두 겹이다 — procedure 의 `assertTeamManager` 가 **입력의 teamId 로** 팀장
  여부를 묻고(어딘가의 팀장이면 통과시키는 순간 A팀 팀장이 B팀 멤버를 만진다), 서비스가
  대상의 소속·상태·유형을 다시 본다. 특히 직책 수정은 **대상이 그 팀 소속인지** 확인해야
  한다 — 확인이 빠지면 팀장이 userId 만 갈아끼워 타 팀·미배치·슈퍼어드민의 직책을 바꾼다.
  팀 목록·생성·이름 변경은 조직 구조를 다루므로 `superadmin` 전용이고, 상세는 `authed` 로
  열되 **슈퍼어드민·그 팀 팀장**이 아니면 NOT_FOUND(존재를 알려주지 않는다). 팀원 추가는
  **pull 모델**이라 미배치 internal active 만 검색·추가되며, 타 팀 active 멤버를 당기는
  겸직 생성은 슈퍼어드민만 할 수 있다. 판정 경합은 팀 키 advisory lock(같은 사람을 두
  팀에서 동시에 당기는 경합은 사용자 키)으로 직렬화하고, 멤버 추가·역할 변경·제외는
  `team_lifecycle_events` 에 감사 행을 남긴다.
- **소유권 이전은 소유자·팀·그룹을 한 번에 움직인다**(티켓 19, 스펙 §4·§7, .pen FLOW 4-4·9-3).
  수동 이전(`workspace.ownership.transfer`, `survey.transferOwnership`)과 퇴사 승계가 같은
  `transferOwnershipInTx` 를 쓴다 — 불변식이 하나라서다: **소유자는 소유 팀 사람이어야 하고**
  (티켓 13 revocation), 팀이 움직이면 **그룹은 미분류로** 내려간다(0117 계약). 그래서 타 팀
  참여자에게 넘기면 설문이 그 사람 팀으로 따라가고, 활성 팀이 없거나 둘 이상이면 거부한다
  (시스템이 고르면 설문이 엉뚱한 팀 목록에 나타난다). 목적지 팀은 `lockTeamMembers` +
  `teams FOR SHARE` 로 **잠근 채** 확인한다 — 무잠금이면 그 사이 커밋된 해산을 못 보고
  archived 팀으로 옮긴다.
  **동시 이전은 기대 소유자 토큰(`expectedOwnerUserId`)이 막는다.** `FOR UPDATE` 는 두 요청을
  줄 세울 뿐이라 서로 다른 후임을 지목한 둘이 모두 성공하고 나중 것이 이긴다 — 잠긴 값과
  대조해야 「하나만 성공」이 참이 된다.
  **제안 규칙은 순수 함수다**(`proposeSuccessor`) — 참여자 **초대순** → 소유 팀 팀장 → 없으면
  승계 대기. 초대 시각이 같으면 userId 로 갈라 답이 흔들리지 않게 한다. **무확인 자동 이전은
  없다**: 미리보기는 아무것도 바꾸지 않고, 확정 입력은 **소유 설문 전수**를 요구한다(빠뜨린
  설문을 조용히 승계 대기로 흘려보내면 화면이 보여준 것과 결과가 달라진다).
  퇴사는 재입사와 같은 워크플로 층(`server/workflows/user-departure`)이 잇는다 — 상태 전이
  (auth)와 승계(workspace)가 한 트랜잭션이어야 하고 도메인끼리는 서로를 못 부른다. **전역 전이
  키를 트랜잭션 첫 줄에서 잡는다** — 재입사가 적어둔 「전역 키를 뒤에 잡는 경로는 없다」를
  지키기 위해서다(advisory xact 락은 재진입이 안전하다). 승계 루프는 **id 오름차순**으로 돈다
  (재배치·해산·담기와 같은 순서 — 입력 순서로 잠그면 사이클이 생긴다).
  **승계 대기는 재배치 인박스가 배치 대기와 같은 목록에서 받는다** — 처리자가 하는 일이 같다
  (새 소유자 지정). 해소할 때 그룹은 **팀이 실제로 바뀐 설문만** 미분류가 된다.
  **소유 설문이 남은 사람은 팀에서 제외되지 않는다**(`MemberOwnsSurveysError`). 그냥 빼면 그
  설문은 소유자조차 못 열고, 소유자가 살아 있어 승계 대기로도 안 잡혀 인박스에도 안 뜬다.
  스펙 §4 의 「팀 이탈 처리 모달 자동 제안」 화면은 아직 없어 **막고 안내하는** 쪽을 골랐다.
  **퇴사는 `team_members` 를 지우지 않는다** — 팀 상세가 비활성 멤버를 표식과 함께 보여줘야
  하고, 접근을 막는 것은 유효 소속이 아니라 계정 상태다.
- **참여자는 팀 경계를 넘는 유일한 접근 경로다**(티켓 18, 스펙 §4·§8, .pen FLOW 4-2).
  `survey_participants`(0119) 행 하나가 타 팀 사람을 **그 설문 하나에만** 들인다 — 팀 멤버십은
  만들지 않고 소유 팀의 다른 설문·그룹은 그대로다. 판정 코어가 참여 행을 **설문 행과 같은
  쿼리에서 LEFT JOIN** 으로 읽는다(따로 조회하면 관문이 도는 모든 표면에서 왕복이 하나씩 늘고,
  아끼려 캐시를 두면 초대를 뺀 직후에도 통과하는 창이 생긴다). 목록은 팀 조건과 **OR** 로
  잇되 **배치 대기를 함께 뺀다** — 코어가 `assignment_pending` 을 참여자 분기보다 먼저 막으므로
  목록만 넓히면 열리지 않는 카드가 그려진다.
  **관문이 표면마다 다르다**(스펙 §7·§11-5) — 조회·검색·추가는 `survey.invite`(그 설문에
  접근 가능한 내부인 누구나: 소유자·팀장·참여자·팀 공개면 팀원), 제외는 `survey.manageAccess`
  (소유자·소유 팀 팀장·슈퍼어드민). **검색이 관문을 지는 것이 특히 중요하다** — 후보 목록은
  조직의 내부 계정 명부라 관문 없이 열면 설문 id 하나로 전사 사용자 검색이 된다.
  대상 자격은 서비스가 본다: **internal + active 만**(guest·fieldwork 를 member 로 초대하면
  코어가 어차피 거부하지만 「추가는 됐는데 아무것도 안 되는」 유령 행이 남는다), 그리고
  **소유자는 참여자로 추가 불가**(이미 전권이라 행만 유령이고 목록에 「제외」 버튼이 생긴다 —
  티켓의 「소유자는 누구도 제외 불가」를 입구에서 지킨다). `kind` 와 `users.userType` 의 정합을
  DB CHECK 로 못 거는 이유는 두 테이블에 걸친 조건이라서다.
  화면은 공유 설정 모달의 참여자 블록이고 **제외 버튼만 서버가 준 `canRemove` 로 잠근다**.
  카드 노출 근사 셋이 여기서 처음 갈렸다 — 참여자는 `canEditSurveyCard`·
  `canViewSurveyAnalyticsCard` 는 통과하고 `canManageSurveyAccessCard` 는 못 넘는다(티켓 16 이
  예고한 분기점). 목록 행의 `isParticipant` 가 그 입력이다.
  음성 검증은 `tests/integration/survey-participants.realdb.test.ts` — 판정 입력을 조인으로
  읽고 목록은 exists 서브쿼리라 목으로는 무엇이든 통과한다.
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
- **공개 범위를 바꾸는 유일한 경로는 `workspace.sharing.setVisibility` 다**(티켓 16, .pen FLOW 4-2).
  요구는 `survey.edit` 이 아니라 **`survey.manageAccess`** — 편집은 팀 공개 설문의 팀원도 갖지만
  범위 변경은 소유자·소유 팀 팀장·슈퍼어드민뿐이다(스펙 §7). 같은 이유로 `UpdateSurveyDataSchema`
  의 allowlist 에 `visibility` 가 없다: 두 표면 중 하나만 조이면 다른 쪽이 우회로가 된다. 서비스는
  `updatedAt` 을 건드리지 않는다 — 공개 범위는 설문 내용이 아니고, 건드리면 「최신 수정순」 기본
  정렬이 공유 한 번에 뒤집힌다(그룹 이동과 같은 계약). 감사 행도 남기지 않는다:
  `survey_ownership_events` 의 어휘는 소유 **이동**이라 이 축이 아니다. 화면은
  `features/survey-builder/sharing` 의 공유 설정 모달이고, 여는 것은 막지 않고 **범위 세그먼트만**
  잠근다(추가는 접근 내부인 누구나가 스펙 §7). 노출 근사는 `canManageSurveyAccessCard` —
  오늘은 `canViewSurveyAnalyticsCard` 와 판정이 같지만 이유가 달라(참여자는 responses.view 는
  갖고 manageAccess 는 못 갖는다) 티켓 18 에서 갈린다. 음성 검증 둘:
  `tests/integration/invite-only-visibility.test.ts`(전환 전 열려 있었음 ↔ 전환 후 전 표면
  NOT_FOUND — 짝으로 물어야 관문 유무를 갈라낸다)와 `survey-sharing.realdb.test.ts`(목록 SQL·
  updatedAt 보존은 목으로는 증명되지 않는다).
- **설문 그룹은 접근 권한이 아니라 정리용 묶음이다**(티켓 12, .pen FLOW 2). 그래서 관문이
  두 갈래다 — **그룹 구조**(목록·생성·이름 변경·정렬·삭제·담기 후보 조회)는 팀 공용이라
  슈퍼어드민 또는 그 팀 active 멤버면 팀장·팀원을 가리지 않고, **설문을 넣고 빼는 것**만
  그 설문의 `survey.edit` + `surveyGroup.manage` 를 함께 요구한다. 전자만 보면 참여자
  (티켓 18)가 남의 팀 폴더를 재배치하고, 후자만 보면 팀원이 못 고치는 설문을 옮긴다.
  **그룹 mutation 은 트랜잭션 안에서 `teams` 행을 `FOR SHARE` 로 잡고 active 를 다시 본다** —
  관문의 확인은 별도 왕복이라 그 사이 해산이 커밋되면 감사 계보로 남겨야 할 archived 팀의 그룹
  행이 수정·삭제된다(`collect`·`move` 는 잠근 설문 행의 `teamId` 로 이미 잡힌다).
  판정은 `assertSurveyCapabilityBatchRpc` 로 한 왕복에 끝낸다(담기는 최대 200건이고
  하나라도 막히면 트랜잭션 하나라 전부 거부다). `groupId` 만 받는 표면(이름 변경·삭제)은
  **타 팀 그룹을 없는 그룹과 같은 NOT_FOUND 로 접는다** — 사유가 갈리면 id 스캔으로 타 팀
  그룹의 존재가 확인된다. 담기 후보의 `canMove` 는 근사가 아니라 서버 판정 그대로다
  (주체 한 번 + `resolveSurveyCapabilities` 를 행마다). 담기·이동은 그룹 행 → 설문 행
  순서로 `FOR UPDATE` 를 잡고 **잠긴 값으로** 팀 일치·미분류 여부를 다시 본다. 그룹 이동은
  `surveys.updatedAt` 을 건드리지 않는다 — 폴더에 넣는 일은 내용 수정이 아니고, 건드리면
  「최신 수정순」 기본 정렬이 담기 한 번에 통째로 뒤집힌다. 화면 쪽은 그룹 화면이 목록의
  다른 상태가 아니라 **주소**(`/surveys?group=<id>`)이며, 사이드바 그룹 트리가 그
  입구다. 지목한 그룹이 목록에 없으면(삭제됨·타 팀 id) 좁힘 자체를 하지 않아 빈 화면에
  갇히지 않는다.
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
  4~8번이 무의미하고 자격은 「이 설문에 부여됐는가」 하나뿐이다(아래 게스트 절). 실사는 부여
  모델이 붙기 전까지 기본 거부다(티켓 24).
  **매트릭스 검증은 두 파일이 방향을 나눠 진다.** `src/server/survey-access.test.ts` 는 분기를
  **열 단위**로 서술하고(왜 그렇게 되는가), `tests/integration/capability-matrix-spec.test.ts`
  는 스펙 §8 표를 **행 단위**로 옮긴다(티켓 23 C 검증 게이트). 어긋나면 표가 이긴다. 둘 다
  프리셋 상수를 다시 읽어 비교하지 않는다 — 그러면 구현이 스스로를 채점해 매트릭스가 바뀌어도
  GREEN 이 유지된다. 표 쪽에는 **완전성 가드 둘**이 함께 있다: 모든 capability 어휘가 정확히
  한 행에 있고(어휘가 늘면 행을 강요받는다), 각 열의 판정 결과가 그 열의 O 칸과 **정확히
  같다**(판정이 표에 없는 것을 더 줘도 잡힌다). 셀 단언만으로는 표가 자기 누락을 모른다.
- **작업 범위는 `server/work-scope.ts` 가 정한다.** 팀 | 시스템 전체 보기(메가리서치) | 없음 셋이며,
  폴백은 마지막 유효 팀 → 첫 active 팀 → 없음이다(.pen FLOW 6-1). 화면이 보내는 값은 편의일 뿐이라
  서버가 멤버십으로 다시 해석한다 — 내 팀이 아닌 teamId 는 **접고**(쿠키에 남은 해산 팀으로 화면이
  잠기지 않게), 일반 사용자의 `system` 요청은 **거부한다**(조용히 접으면 부분 목록을 전체로 착각한다).
  요청이 범위를 지목하지 않으면 `work_scope` 쿠키를 읽는다(이름 SSOT 는 `shared/contracts/workspace.ts`).
  설문 목록 응답은 **해석된 범위**를 함께 돌려준다 — 요청과 다를 수 있어 화면이 그것을 정답으로 삼는다.
  화면 쪽은 사이드바 팀 스위처(티켓 08)가 담당한다 — `app/(internal)/layout.tsx` 가 같은 판정 코어로 초기
  범위를 해석해 `AdminShell` 에 넘기고(무효 쿠키는 거부가 아니라 기본 범위로 접는다 — 쿠키는 편의값),
  전환은 쿠키 기록 + 전체 쿼리 캐시 무효화 + `router.refresh` 로 처리한다. 목록 쿼리 키에는 항상
  해석된 범위가 들어가 팀 간 캐시가 섞이지 않고, 팀 미배치는 조회 자체를 하지 않는다(.pen FLOW 9-1).
  **거부는 `server/rpc-work-scope.ts` 의 `toRpcWorkScopeError` 가 FORBIDDEN 으로 옮긴다**(티켓 15) —
  매핑이 없던 동안 그 「거부」는 실제로 500 이었다(rpc-error-policy 가 미지의 예외를 마스킹한다).
  지는 표면은 설문 목록과 생성 경로 넷이다. **거부와 접기를 가르는 것은 값의 출처다** —
  입력이 명시한 범위는 거부하고, **쿠키에서 온 범위는 `resolveWorkScope` 가 접는다**(티켓 15).
  화면(admin 셸·분석 목록)이 이미 접고 있었는데 쓰기 경로만 거부해서, 강등된 슈퍼어드민에게
  「스위처엔 팀이 보이는데 설문 생성만 막힌다」가 생겼다. 접는 쪽은 언제나 더 좁아 새지 않는다.
- **설문을 만드는 경로 넷(빌더 자동 생성·명시 생성·복제·전체 저장 생성 모드)은 전부
  `resolveNewSurveyOwnership` 로 소유·배치 컬럼을 채운다.** 시스템 전체 보기는 teams 행이 아니라
  조회 범위라 소유 목적지가 될 수 없고(.pen 6-2), 팀 미배치도 만들 수 없다 — 서버가
  `SurveyOwnershipRequiredError` 로 막고 화면은 버튼을 비활성으로 둔다. 복제본은 원본의
  팀·공개 범위를 잇는다(팀을 잇지 않으면 배치 대기로 떨어져 만든 사람조차 목록에서 못 본다).
  복제·기존 행 ensure 는 원본에 **survey.edit** 을 요구한다 — 열람만 가진 주체가 사본의 전권을
  얻거나 타 팀 설문의 존재를 확인하는 우회를 막는다.
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
- **팀 해산은 확정 즉시, 한 트랜잭션, 되돌릴 수 없다**(ADR-0011, 티켓 13, .pen FLOW 8-1).
  `workspace.teams.dissolve`(superadmin 전용, 팀 관리 목록의 카드 케밥이 유일한 진입점)가
  팀 `archived` + 소속 설문 배치 대기(`teamId=null`·`assignment_pending`·`surveyGroupId=null`)
  - 감사 행을 함께 쓴다. **`team_members` 행은 지우지 않는다** — 유효 소속 판정
    (`getActiveTeamMemberships`)이 active 팀만 조인하므로 팀원은 그 순간 자동으로 미배치가 되고,
    행을 지우면 "해산 시점 명부" 가 어디에도 안 남는다. 확인 문구(팀 이름 재입력) 대조는 화면과
    **서버 양쪽**에 있다 — 화면만 검사하면 raw RPC 한 번으로 팀이 사라진다. 잠금은 멤버 변경과
    **같은 팀 키**(`lockTeamMembers`)를 쓰고 최종 UPDATE 에 `status='active'` 조건을 함께 건다:
    잠금만으로는 앞선 해산 뒤에 락을 받은 두 번째가 감사 행을 더 쓰고 archivedBy 를 덮는다.
    **해산 취소 procedure 를 만들지 말 것** — 확인 모달의 "되돌릴 수 없습니다" 가 거짓이 되고
    정식 복구 경로는 재배치 센터(티켓 14)다. 해산 뒤에도 **공개 응답·예약 메일·Inngest 잡·
    게스트 콘솔은 계속 돈다**(그 경로들이 팀 컬럼을 읽지 않는 것이 근거다 — 새 응답 게이트를
    만들 때 `teamId`·`assignmentStatus` 를 끌어들이면 그 약속이 깨진다). 「해산이 끝이어야
    하는데 열려 있던」 경로 셋도 함께 닫혔다 — 슈퍼어드민은 관문을 소속 조회 없이 통과하므로
    archived 팀의 **멤버 명부**(members 3종에 `requireActiveTeam`)·**그룹 쓰기**
    (`getSurveyGroupTeamId` 가 active 팀만)·**새 설문 귀속**(`resolveNewSurveyOwnership` 이
    쓰기 직전 재확인)에 계속 닿을 수 있었다.
- **재배치 센터는 팀 경계로 좁힐 수 없는 목록이라 슈퍼어드민 전용이다**(티켓 14, .pen FLOW
  8-2~8-4·9-2). `/reassignment` 는 팀 관리의 「메가리서치」 카드가 유일한 입구고
  사이드바 항목도 `teamId` 딥링크도 없다 — 여기 있는 사람과 설문은 **어느 팀에도 속하지
  않아** 팀장에게 하나라도 열면 그 순간 전사 열람이 된다. `workspace.reassignment` 5종
  (`inbox`·`pendingSurvey`·`ownerCandidates`·`assignUser`·`assignSurveys`)이 전부 superadmin
  베이스이며, 페이지도 `requireSuperadminPage` 라 두 경로의 권한 축이 같다.
  - **새 소유자는 목적지 팀의 활성 멤버여야 한다**(`OwnerNotInTeamError`). 이것이 이 티켓의
    핵심 불변식이다 — `resolveSurveyCapabilities` 의 소유자 분기는 **소유 팀 소속일 때만**
    전권을 주므로(티켓 13 하드닝), 팀 밖 사람을 앉히면 배치는 성공하는데 그 소유자가 자기
    설문을 못 여는 설문이 만들어지고 화면에는 아무 경고도 뜨지 않는다. 후보 목록
    (`listOwnerCandidates`)과 서버 검증이 **같은 모집단**을 보는 것이 그 계약이다.
  - **단건(8-4)과 일괄(9-2)은 같은 RPC** 다. 단건은 목록 길이가 1 인 경우일 뿐이라 나누면
    「전부 아니면 전무」 규칙이 두 벌이 된다. 없는 id 와 「배치 대기가 아닌」 id 는 **같은
    사유**로 접는다 — 갈라 말하면 재배치 주소가 전체 설문의 존재 확인 창구가 된다.
  - 잠금 순서는 **팀 멤버 → 팀 행 `FOR SHARE` → 설문 id 오름차순**으로 해산·담기와 같다.
    맞추는 것이 목적이 아니라 배치가 해산의 **정확히 반대 방향 이동**이라 서로를 기다려야 한다.
    배치는 `survey_group_id` 를 NULL 로 둔다(그룹은 팀 소유물 — 새 팀에서는 미분류).
  - 인박스 목록은 **200건 상한, 지표는 전체 수**다. 0116 백필이 팀 도입 이전 설문 전부를
    배치 대기로 세워 초기 운영에서 수천 건일 수 있다 — 화면이 「상위 N건」임을 말한다.
  - **배치 취소 표면을 만들지 말 것.** 인박스는 처리하는 곳이지 되돌리는 곳이 아니다(해산에
    취소가 없는 것과 같은 이유). 되돌리려면 정식 이전(티켓 19)을 쓴다.
- **배치 대기 설문의 「출신 팀」은 `survey_ownership_events` 에만 남는다**(0118, 티켓 14).
  해산이 `surveys.team_id` 를 NULL 로 내리므로 설문 행에는 출처가 없고, 팀 쪽 `dissolve`
  감사는 **규모**(surveyCount)만 적을 뿐 어느 설문인지 적지 않는다. 그래서 `dissolveTeam` 이
  설문별 `unassign` 행을 함께 쓴다 — 이 행이 없으면 .pen 8-4 의 「현재 소유 팀 · 해산됨」도,
  "누가 이 설문을 저 팀으로 옮겼는가" 도 답할 수 없다. 티켓 19 승계가 `transfer` 로 이어 쓴다.
- **재입사는 상태 전이와 팀 배정이 한 트랜잭션이다**(티켓 14, .pen FLOW 9-4). 퇴사가 유효
  소속을 끊어놓았으므로 상태만 되돌리면 로그인만 되는 미배치로 되살아나 재배치 센터로 다시
  흘러간다 — 「새 소속으로 다시 시작합니다」라고 말하는 화면이 목적지를 안 받으면 그 문장이
  거짓이 된다. 두 도메인의 쓰기라 `server/workflows/user-rehire` 가 묶는다(도메인끼리는 서로를
  못 부른다). **순서가 계약이다** — ① 상태 전이 ② **옛 활성 소속 정리** ③ 새 소속 배정.
  - ①이 먼저인 이유: 배정의 `assertMemberAssignable` 이 대상의 재직 여부를 본다. 뒤집으면
    재입사가 자기 자신의 재직 검사(퇴사 상태)에 걸린다.
  - ②가 **없으면 기능이 통째로 죽는다**: 퇴사는 `team_members` 행을 지우지 않으므로(팀 상세가
    비활성 멤버를 표식과 함께 계속 보여줘야 한다) 팀이 있던 사람은 전원 「이미 다른 팀에
    소속됨」으로 막힌다. 정리는 `clearActiveMembershipsInTx` 가 `member_remove` 감사와 함께
    한다. **마지막 팀장 가드는 부르지 않는다** — 세는 것이 활성 팀장인데 대상은 이미 퇴사라,
    부르면 유일한 팀장이 퇴사한 팀에서 재입사가 영구히 막힌다.
  - `teamId`·`teamRole` 은 계약상 **nullable** 이고 **유형별로** 강제된다. guest·fieldwork 는
    멤버십이 금지고(스펙 §1) 슈퍼어드민은 팀 소속과 무관하므로, 필수로 두면 그 계정들은 한 번
    퇴사한 뒤 영영 돌아올 수 없다. 화면도 그 계정에는 두 칸을 아예 감춘다.
  - 배정 실패는 워크플로가 `RehireTeamAssignmentError` 로 **사유 문구만 보존해** 감싼다 —
    워크스페이스 도메인 에러를 그대로 올리면 auth procedure 가 그 도메인을 import 해야 한다.
- **마지막 팀장 가드가 지키는 것은 "관리자가 남는가" 이지 "leader 행이 남는가" 가 아니다.**
  세는 것은 **활성** 팀장이고, **대상이 비활성이면 아예 묻지 않는다** — 그러지 않으면 유일한
  팀장이 퇴사한 순간 강등도 제외도 거부되어(활성 팀장 0명) 팀이 유령 팀장에 잠긴다.
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
- **세션 폐기는 표식으로 경합까지 닫는다.** 재설정·상태 전이는 세션을 지우면서
  `users.sessions_revoked_at`(0114)을 갱신하고, 로그인은 시작 시점의 값을 읽어뒀다가 세션을
  만들기 직전에 다시 읽어 다르면 생성을 취소한다(`lib/auth/session-revocation.ts`).
  시각의 대소가 아니라 **같은 컬럼의 두 번 읽기**라 앱·DB 시계 오차와 무관하다.
  표식은 **먼저 찍힌 것이 이긴다** — 흐름 도중 다시 읽어 덮으면 막으려던 창이 그대로 열린다.
- **`/api/auth` POST 는 허용목록이다**(`sign-in/email`·`sign-out`). catch-all 이 전 엔드포인트를
  열어두면 `update-user` 로 아바타 URL 검증을, `change-password` 로 다른 기기 로그아웃을
  우회할 수 있다. 서버는 `auth.api.*` 를 직접 부르므로 목록을 좁혀도 앱 동작은 그대로다.
- **게이트는 2단이다.** `proxy.ts` 는 세션 쿠키 존재만 보는 1차 게이트(DB 미조회)로 내부 콘솔·
  `/analytics`·`/guest`·`/fieldwork` 진입을 거르고 `x-pathname` 요청 헤더를 넘긴다.
  **`/admin` 접두를 걷은 뒤(라우트 그룹 `app/(internal)/`) 이 게이트가 보는 것은 접두가 아니라
  루트 목록이다** — 어휘의 정본은 `lib/auth/protected-paths` 의 `SESSION_GATED_ROOT_SEGMENTS`,
  matcher 리터럴은 그 사본이고(Next 가 빌드 타임에 정적으로 읽어 배열을 못 쓴다), 대조는
  `proxy-gate.test.ts`(리터럴↔어휘)와 `tests/repo/proxy-matcher-coverage.test.ts`
  (어휘↔디렉터리)가 나눠 진다. **새 내부 루트를 만들고 등재를 빠뜨리면 그 구역만 1차 게이트
  밖에서 자라고 아무 에러도 나지 않는다** — 그래서 완전성의 출처를 사람이 아니라 파일 시스템에
  두었다. 루트마다 `'/x'` 와 `'/x/:path*'` 두 줄인 것도 계약이다(후자는 루트 자체를 매치하지
  않아 목록 화면이 무방비가 된다). 옛 주소는 `next.config.ts` 의 `/admin/:path*` → `/:path*`
  영구 리다이렉트가 받는다 — rewrite 가 아니라 redirect 다(두 주소를 살려 두면 접두를 걷은
  것이 아니다). **옛 운영 콘솔 주소(`/admin/surveys/<id>/operations[/…]`)만 예외다** — 직원과
  옛 게스트 계정이 함께 쓰던 주소라 접두만 걷으면 옛 게스트가 로그인 화면에 갇힌다. 그 주소는
  일반 규칙보다 **앞선** 임시(307) 규칙이 다리 라우트 `/api/legacy-guest-link/[surveyId]` 로
  보내고, 라우트가 세션 쿠키의 존재로 가른다: 직원은 `/surveys/<id>/operations/…`(종전의 답),
  세션이 없고 **옛 grant 에 오른 설문**(`GUEST_SURVEY_GRANTS` 의 설문 id — 계정 쪽은 더는 뜻이
  없다)이고 열린 외주 링크가 있으면 `/fw/<token>`. 목록 밖 설문은 링크가 있어도 조회하지
  않는다(설문 id 로 토큰을 알아내는 창구가 되지 않게). **전환기 장치다** — env 를 비우면 꺼지고,
  서 있는 동안 그 설문들의 링크는 비밀번호 하나로 지켜진다. 규칙의 순서는
  `tests/repo/next-config-redirects.test.ts` 가, 판정은 라우트 옆 `route.test.ts` 가 본다.
  쿠키 유효성·계정 상태(active)·**계정 유형**·게스트 경로 제한은 `app/(internal)/layout.tsx`·
  `app/analytics/layout.tsx` 가 서버에서 재검증한다. 유형 구역(`/guest`·`/fieldwork`)은 페이지의
  `requireAccountTypePage` 가 본다. 비로그인 접근을 허용하는 경로 목록은
  `lib/auth/protected-paths.ts` 의 `AUTH_PAGES` 한 곳에 있고(현재 `/login` 뿐), 유형과 무관하게
  열리는 내부 콘솔 경로는 같은 파일의 `ACCOUNT_PAGES`(현재 `/profile` 뿐)다.
- **로그인**은 `authClient.signIn.email`(클라이언트)로 세션을 만든 뒤 `/login` 으로 되돌아오고,
  목적지 해석은 그 페이지(RSC)가 한다 — 계정 유형이 세션에만 있어 클라이언트가 결정할 수 없다.
  복귀 경로는 `lib/auth/safe-redirect.ts` 가 정제한다(내부 절대경로만, 제어 문자 차단).
  로그아웃은 `components/auth/logout-button.tsx` 의 `authClient.signOut`.
- REST 라우트·RSC 는 `lib/auth.ts` 의 `requireAuth`(세션 + status='active' + userType='internal')를 쓴다 — oRPC `authed` 와
  같은 정책이라 REST 가 형제 우회 경로가 되지 않는다. admin 전용 RSC 는 `requireAdminPage` 가 게스트도 막고, 전역 관리 RSC 는 `requireSuperadminPage` 가 슈퍼어드민만 통과시킨다(둘 다 거부는 notFound).
- procedure 베이스 5종 (`server/orpc.ts`):
  - **`pub`** — 인증 불필요 (응답자 표면: 응답 mutation·공개 설문 조회·컨택 attrs·수신거부 lookup). 남용 방지가 필요한 표면은 `.use(withRateLimit(group))` 부착.
  - **`authed`** — 세션 + `status === 'active'` + `userType === 'internal'`. 비활성 계정은 세션이 이미 있어도 FORBIDDEN(발급 후 상태가 바뀐 경우). 티켓 21 전에는 env grant 보유자를 userId 로 한 번 더 걸렀는데, 게스트가 계정 유형이 되면서 그 줄이 사라졌다.
  - **`superadmin`** — `authed` + `isSuperadmin`. 전역 관리 표면(사용자 관리·계정 상태 전이·비밀번호 재설정·**실사 업체**) 전용. 페이지 쪽 짝은 `requireSuperadminPage`.
  - **`account`** — 세션 + active. **계정 유형을 보지 않는다.** 프로필처럼 "누구든 자기 것만 만지는" 표면 전용(`auth.getProfile`·`updateProfile`·`updatePassword`). 아바타 정책 상수는 `lib/upload/image-policy.ts` 의 `AVATAR_UPLOAD_POLICY` 한 곳에 있고 라우트와 화면이 같은 값을 본다. 자기 것만 만진다는 보장은 베이스가 아니라 handler 가 한다 — 대상 id 를 입력에서 받지 말고 `context.user.id` 를 쓸 것. REST 짝은 `requireActiveAccount`, 페이지 짝은 `requireAccountTypePage`.
  - **`scoped`** — 세션 + active (비내부 계정 포함) **또는 외주 실사 링크 세션**(ADR-0026). **베이스는 유형으로 막지 않지만 handler 관문이 막는다** — 판정은 capability 코어 하나이며, 게스트 열에는 이 표면들이 요구하는 capability(컨택·메일·응답 상세·export)가 하나도 없어 전부 거부된다. **링크 주체는 계정이 없어 `context.user` 가 null 이라, handler 는 `context.actor` 로 주체를 읽는다** — 계정이 있으면 계정이 이기고(연구원이 자기 링크를 눌러 본 브라우저에서 admin 콘솔이 조용히 깎이지 않게), 없으면 입력의 설문 id 로 `fw_<token>` 쿠키를 골라 링크 행과 대조한다. **이 문을 지나는 링크는 외주 실사 링크뿐이다** — 클라이언트 링크의 쿠키(`cl_<token>`)는 path 가 `/client/<token>` 이라 `/api/rpc` 에 실리지 않고, 실려도 세션 목록(`readFieldworkLinkSessions`)에 서지 않으며, 값을 외주 이름으로 바꿔 세워도 그 토큰의 행이 외주 종류가 아니라 무효다(세 겹 — `client-link.realdb` 가 scoped 전수를 그 위조로 두드린다). 거부가 셋으로 갈린다 — 다른 링크 세션은 있는데 이 설문의 것이 없으면 **NOT_FOUND**(그 주체에게 없는 설문), 세션이 없거나 더는 유효하지 않으면 **UNAUTHORIZED**, 자기 설문의 권한 밖은 **FORBIDDEN**. 계정 전용 scoped 표면(메일 탭 쓰기)이 세션 계정을 읽는 문은 `requireScopedAccount` 하나다 — 단건 발송·응답 수정은 ADR-0027 이 링크에 열어 주체에서 귀속을 파생한다(`attributionOf`). **실사는 티켓 25 가 컨택 축을 열어 이 베이스를 실제로 지나는 첫 비내부 유형이 됐다** — 그래서 「어디까지 열렸는가」의 경계를 `fieldwork-account-denial` 이 어휘 전수로 고정한다. 인증 가드가 `account` 와 더는 같지 않지만 **별개의 베이스로 둔다**는 이유는 그대로다 — 지는 계약이 달라서(이쪽은 설문 일치 강제, 저쪽은 자기 것만), 별칭으로 묶으면 한쪽을 조일 때 다른 쪽 전 표면이 조용히 따라 바뀐다. **이 베이스를 쓰는 procedure는 핸들러 첫 줄에서 `assertScopedSurveyCapabilityRpc(context.actor, input.surveyId, '<cap>')` 호출 필수** — 예외 없음(티켓 21 이 마지막 예외를 `authed` 로 옮겼다). 그 사실은 `cross-team-idor-rpc`·`guest-account-denial`·`fieldwork-account-denial`·`fieldwork-link-denial` 네 스위트가 각각 목록으로 고정한다 — 마지막 것이 링크에게 열리는 scoped 표면이 **정확히 아홉**(회차 3 · attrValues · idLists · setMemo · 응답 수정 저장 · 단건 발송 · 단건 미리보기 contactSample)임을 라우터 열거 위에 세운다(`tests/helpers/scoped-surface-inputs` 의 `LINK_OPEN_SCOPED_PATHS`). 같은 스위트가 **pub 인 링크 세션 표면이 넷**(`accessLinkSession.authenticate`·`signOut` + 클라이언트 짝 `authenticateClient`·`signOutClient`)임도 고정한다 — 종류별로 표면을 가른 것은 로그가 적는 것이 RPC 이름이라서다.
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
- **유형별 목적지**(티켓 05): 홈 표의 SSOT 는 `lib/auth/account-home.ts` 의 `ACCOUNT_HOME_PATH`
  (internal→`/surveys` · guest→`/guest` · fieldwork→`/fieldwork`). 로그인 직후 목적지는
  `resolvePostLoginDestination` 이 정한다 — 게스트·실사가 요청한 내부 경로는 자기 홈으로 접는다
  (그대로 보내면 admin 게이트가 되돌려 보내 로그인 화면을 오가는 루프가 된다). admin·analytics
  레이아웃은 비내부 계정을 자기 홈으로 **리다이렉트**하고(존재를 감출 이유가 없어 notFound 가 아니다),
  `ACCOUNT_PAGES`(현재 `/profile`)만 비켜준다. **목적지 축은 하나다**(티켓 21) — 예전에는
  설문 단위 env grant 게스트가 먼저 갈라져 grant 설문 콘솔로 갔고 담당 아닌 설문을 향한 로그인은
  강제 로그아웃까지 했는데, 그 동선이 통째로 사라졌다.
- **프로필은 세 유형 공통**(.pen FLOW 3-2, `/profile`). 본인이 바꾸는 것은 이름·아바타·비밀번호
  뿐이다 — `UpdateProfileInput` 에 이메일·직책·소속이 없는 것이 이 표면의 정의다. 내부 계정은
  이메일·직책을 읽기 전용으로 보고, 게스트·실사에게는 그 두 칸이 아예 보이지 않는다(스펙 §10). 비밀번호 변경은 **다른 기기 세션만 끊고 현재 세션은 남긴다**(슈퍼어드민 재설정이 전부 끊는
  것과 갈리는 지점). 아바타는 전용 라우트 `/api/upload/avatar` 가 정사각 WebP 로 깎아 저장하고,
  서비스가 그 URL 이 우리 R2 공개 URL 인지 확인한다(외부 주소면 남의 서버가 우리 화면에 그림을 그린다).
- **클라이언트(고객사)는 계정이 아니라 링크로 들어온다**(ADR-0029, 2026-10-12). 연구원이 공유 설정
  모달의 클라이언트 블록에서 이 설문 전용 **`/client/<token>` 주소 + 공유 비밀번호**를 발급하고
  볼 화면을 칩으로 고른다. 외주 실사 링크와 **같은 테이블·같은 관리 표면**이고(`survey_access_links`
  의 `kind='client'`, `workspace.accessLinks` — 입력의 `kind` 는 기본값 없는 필수) 갈리는 것은 넷이다.
  - **열이 둘뿐이다** — `survey.view` + `operations.view`. 아래 옛 게스트 열과 같은 집합이고
    (`CLIENT_LINK_CAPS`, 상수는 따로 — 두 모델의 수명이 다르다) 여기 없는 것이 「항상 차단」의
    정본이다. 탭 화이트리스트(`client_tabs`, 어휘·기본값·정규화는 `SurveyGuestTabs` 그대로)는
    capability 가 아니라 별도 축이라 **전부 켜도 열은 늘지 않는다**. 탭 저장은
    `accessLinks.setClientTab`(`survey.manageAccess`, 종류를 받지 않는다 — 서비스 WHERE 가
    클라이언트로 못 박혀 있다). **칩 하나와 그 값만 받는다** — 네 값을 통째로 받으면 화면이
    낡은 연구원의 저장이 남이 방금 끈 탭을 되살린다(넓어지는 쪽으로 조용히 틀린다, 2026-10-12
    리뷰). 서비스가 행을 `FOR UPDATE` 로 잠그고 나머지 셋을 잠근 행에서 읽는다. 옛 게스트
    계정의 탭 저장은 통째로 받는 모양 그대로다(입구가 닫힌 철거 대상이라 고치지 않았다).
  - **닫히는 조건이 다르다** — 아래 「닫힘 표」.
  - **입구가 조사 이름을 받지 않는다.** 토큰만 가진 사람에게 무슨 조사인지 알려 줄 이유가 없다.
    그리지 않는 것이 아니라 판정 코어가 돌려주는 모양(`ClientLinkEntry`)에 이름이 없다 — RSC
    payload 에도 실리지 않는다. 그래서 콘솔이 라우트 그룹 `(console)` 아래에 선다.
  - **쿠키가 자기 콘솔에만 실린다** — `cl_<token>`, path `/client/<token>`
    (`accessLinkCookieName`·`accessLinkCookiePath`). 외주 쿠키가 `/` 인 근거(대리 응답이
    `/survey/…` 로 나간다)가 클라이언트에게는 없다. RPC 주소에 실리지 않으므로 **scoped 표면에
    닿는 길이 capability 판정 이전에 없다**. 지울 때도 **심을 때와 같은 경로**를 줘야 한다.
  - **탭은 매 요청 링크 행에서 읽는다**(주체 `LinkActor` 의 `clientTabs` — 세션 판정이 싣는다).
    쿠키에 싣지 않으므로 연구원이 탭을 끄면 클라이언트의 다음 화면 이동에서 닫힌다.
    `LinkActor`·`LinkAccessSubject` 는 종류 유니온(`LinkKindFacet`)이라 「외주인데 탭이 있는」
    조합이 타입상 만들어지지 않는다. **`linkKind` 는 필수다** — 「없으면 외주」로 접으면 종류를
    빠뜨린 클라이언트 링크가 외주의 여섯 칸을 얻는다.
  - **종류가 어긋난 토큰은 없는 토큰이다.** `loadLinkRow` 가 종류를 WHERE 에 걸어, 클라이언트에게
    준 주소의 접두만 `/fw` 로 바꿔 넣어도 비밀번호 화면까지만 보이고 어떤 비밀번호도 통하지
    않는다(반대 방향도 같다). 닫힘 화면조차 보이지 않는 것이 요점이다 — 닫힘은 「이 주소가 한때
    링크였다」를 알려 준다.
  - 콘솔 관문은 `assertClientLinkPageAccess(token, tab?)` — **설문 id 를 받지 않고 돌려준다.**
    접속 전·끊김·닫힘·없는 토큰은 입구로 redirect, **탭 밖은 사유 구분 없이 notFound**(주소
    조작으로 탭 구성이 확인되면 안 된다). 화면은 게스트 콘솔과 한 벌이다(`app/_client-console`).
  - 음성 검증: `client-link.realdb`(세션 — 종류 칸막이·중단 중 열림·종료 닫힘·세션 폐기·탭 반영·
    조사 이름 미노출·scoped 전수 위조)와 `client-console.realdb`(관문 — 탭·거부의 두 갈래·
    마스킹 투영), `capability-matrix-spec` 의 클라이언트 링크 열.
- **닫힘 표 — 무엇이 어느 문을 닫는가**(ADR-0029·0030). 세션 판정(`server/access-link` 의
  `isClosed`)과 capability 판정(`resolveLinkCapabilities`)이 **같은 표를 따로 본다** — 한쪽만
  닫히면 선 세션이 계속 움직인다.

  | 사유                  | 외주 실사 링크 | 클라이언트 링크 | 내부 콘솔 |
  | --------------------- | -------------- | --------------- | --------- |
  | 설문 **중단**         | 닫힘           | **열림**        | 열림      |
  | 설문 **종료**         | 닫힘           | 닫힘            | 열림      |
  | 설문 삭제 · 배치 대기 | 닫힘           | 닫힘            | 닫힘      |
  | 그 링크의 종료        | 닫힘           | (자기 것만)     | —         |

  중단은 「실사를 멈춘다」이고 종료는 「조사가 끝나 외부를 전부 닫는다」다. 클라이언트가 결과를
  가장 보고 싶어 하는 시점이 응답이 멈춘 뒤라 중단에는 열어 둔다. **넷 다 링크 행을 건드리지
  않는다**(자기 링크 종료만 `closed_at`) — 재개·종료 취소·재발행이 같은 주소·같은 비밀번호·같은
  쿠키로 다시 연다.

- **설문 종료는 중단과 별개의 상태다**(ADR-0030). `surveys.status='closed'` — 전이는
  `published ⇄ closed` 뿐이고(`operations.control.setClosed`, **`survey.edit`**, 조건부 UPDATE 라
  그 밖의 상태에서는 CONFLICT) **재발행이 published 로 되돌린다**. `isPaused` 와 독립이라 둘이
  함께 설 수 있다. 종료가 닫는 것은 둘이다 — 외부 링크(위 표)와 **새 응답**(루트 AGENTS.md 주의사항 18).
  내부 콘솔·분석·내보내기는 그대로다. 「발행된 적 있는가」를 `status === 'published'` 로 묻던
  자리는 전부 고쳤고(`status_not_published` 술어·게스트 카드 진행 상태·발행 확인 문구),
  `tests/repo/survey-status-readers.test.ts` 가 `surveys.status` 를 읽는 서버 파일을 목록으로
  고정한다 — **새 독자가 붙으면 그 파일이 빨개지고, 종료를 어떻게 다룰지 정한 뒤 등재한다.**
- **실사·게스트 계정의 발급 입구는 닫혀 있다**(ADR-0029, 2026-10-12). 발급 가능 유형 목록
  `creatableUserTypes`(`shared/contracts/auth-io`, 지금 값은 `['internal']`) 하나를 계정 생성 창과
  발급 표면 `auth.users.create` 가 함께 본다 — 모양이 완전한 raw 요청도 BAD_REQUEST 다. **닫은 것은 입구이고 옛 모델은
  남아 있다**: 입력 유니온의 변종·서비스 `createUser`·부여 RPC(`workspace.guests`·
  `workspace.fieldwork`·`workspace.fieldworkOrgs`)·콘솔(`/guest`·`/fieldwork`)·테이블.
  이미 있는 계정은 로그인도, 부여된 설문의 열람도 종전대로다. 옛 모델의 스위트가 계정을
  **서비스로** 만드는 이유가 그것이다(RPC 로 만들면 닫힌 문에 걸린다). **철거는 링크 모델로
  실제 조사 한 건을 프로덕션에서 끝낸 뒤의 일이다 — 그 전에 「안 쓰는 코드」로 보고 지우지
  말 것.** 아래 게스트·실사 계정 절들은 그 **옛 모델의 설명**이다.
- **[옛 모델 — 발급 입구 닫힘, 철거 전] 게스트(클라이언트)는 계정이고, 자격은 설문 단위 부여 하나다**(티켓 21, 스펙 §5·§8, .pen FLOW 4-2).
  `survey_participants` 의 `kind='guest'` 행이 그 설문 **하나만** 열고 팀 멤버십은 만들지 않는다.
  판정은 코어의 게스트 분기이며 **팀·소유권 사슬을 타지 않는다** — 팀도 소유권도 없는 계정이라
  그 분기들이 무의미하고, 함께 막는 것은 배치 대기뿐이다(팀이 정해지기 전에는 아무도 못 연다).
  공개 범위도 관여하지 않는다: 부여가 유일한 자격이다.
  - **열리는 것은 둘뿐**이다 — `survey.view`(프리뷰) + `operations.view`(허용 탭). 게스트 열에
    없는 것이 곧 **「항상 차단」의 정본**이다: 분석·내보내기·응답 상세·컨택 원본·메일·편집.
    설문마다 달라지는 것은 이 집합이 아니라 `guest_tabs` 라, **탭을 전부 켜도 capability 는
    늘지 않는다**. 탭을 capability 로 쪼개면 매트릭스 열이 설문마다 갈려 판정이 프리셋이 아니게 된다.
  - **탭 화이트리스트**(`overview`·`progressReport`·`contactsMasked`·`quota`)는 설문마다 독립이고
    기본값은 **응답 현황 하나**다. 어휘·기본값·정규화 SSOT 는 `shared/contracts/workspace.ts`
    (`surveyGuestTabValues`·`DEFAULT_SURVEY_GUEST_TABS`·`normalizeSurveyGuestTabs`). 컬럼이 비어
    있으면 기본값, 객체인데 키가 없으면 false — 나중에 탭이 늘어도 옛 부여가 새 탭을 자동으로 얻지
    않는다. 판정은 `resolveSurveyAccess`/`loadSurveyAccess` 가 capability 와 **함께** 돌려주며
    `guestTabs === null` 은 「탭 축이 없는 주체」(내부·실사)다 — 전부 false 인 객체와 갈라 둔 이유는
    내부 계정에게 「모든 탭이 닫혔다」를 주면 콘솔이 자기 탭을 스스로 숨기기 때문이다.
  - **관문은 두 축**이다(스펙 §7·§11-5). 조회·검색·추가는 `survey.invite`, **해제와 탭 저장**은
    `survey.manageAccess`. 탭이 관리 쪽에 서는 것은 §11-5 의 「**초대** 제거·범위 변경」이 이
    둘이기 때문이다 — 새 부여는 언제나 기본 탭으로 서므로 「추가는 누구나」와 어긋나지 않지만,
    이미 선 부여를 넓히면 조사 대상(마스킹)·쿼터가 외부인에게 열린다. 화면도 같은 값
    (`canManage`)으로 칩과 「제외」를 함께 잠그되 칩은 **보여준다**(지금 무엇이 열려 있는지는
    초대한 사람도 알아야 한다). 검색이 관문을 지는 것이
    특히 중요하다 — 후보 목록은 발급된 클라이언트 계정 명부라 관문 없이 열면 설문 id 하나로 전
    고객사 계정을 훑을 수 있다. 대상 자격은 서비스가 본다: **guest + active 만**.
  - 서비스의 WHERE 에 `kind='guest'` 를 함께 거는 것이 칸막이다 — 참여자·게스트가 같은 테이블에
    살아, 조건이 빠지면 한 블록의 「제외」가 다른 블록의 목록을 비운다.
  - **env grant 모델은 은퇴했다**(`GUEST_SURVEY_GRANTS`·`lib/auth/guest-grants`·`/logout`).
    그 축이 사라지면서 scoped 어댑터 3형제의 게스트 분기도 함께 걷혔다 — 판정은 코어 하나다.
    env 값 자체는 **옛 주소 다리의 허용 목록**으로만 남아 있다(`lib/auth/legacy-guest-link` —
    설문 id 만 읽고 권한은 아무것도 주지 않는다. 위 「게이트는 2단이다」 참조).
  - 부여 화면 조각은 `features/survey-builder/sharing/guests-block` 인데 **지금 여는 화면이 없다**
    (클라이언트 블록이 링크 패널만 그린다 — 이미 부여된 행은 그대로 유효하다),
    **게스트가 보는 콘솔은 `/guest` 다**(티켓 22). 그 관문이 `server/page-guest-access.ts` 의
    `assertGuestSurveyPageAccess` — capability(`operations.view`)를 지난 뒤 **탭 축을 다시 묻는다**.
    `tab` 을 생략하면 탭을 묻지 않는다(미리보기는 화이트리스트 밖). **거부는 전부 notFound 이고
    사유를 갈라 말하지 않는다** — 「부여 안 됨」과 「탭 안 열림」이 다른 응답을 주면 주소 조작으로
    부여 사실과 탭 구성이 확인된다. 화면도 같은 판정을 하되(탭 바가 허용 탭만 그린다) 강제는
    서버가 한다.
  - **게스트 콘솔의 조사 대상은 서버에서 투영을 끝낸다**(`read-models/guest-contacts`). 운영 콘솔의
    `ContactsRow` 에는 `inviteToken`(그 사람의 응답 링크)과 컨택 id 가 실려 있어, 게스트에게 가면
    **열람이 대리 응답**이 된다 — 표시 문자열만 남긴 새 행을 만든다. 마스킹 단위는 컬럼 스킴의
    `piiType` 이고 **PII 로 매핑하지 않은 attrs 컬럼은 마스킹 대상이 아니다**(업로드 시점의 결정이
    곧 무엇이 개인정보인가의 정의다). 메일 컬럼은 아예 뺀다.
  - 현황·진척·쿼터는 **운영 콘솔 위젯을 그대로** 쓴다(게스트와 담당자가 같은 숫자를 봐야 한다).
    조립은 app 층이 한다 — 기능 묶음끼리는 서로 import 하지 않지만 라우트는 어느 묶음이든 쓴다.
    컨택 표만 새로 짠 이유는 저쪽 표의 헤더 필터 팝오버가 RPC 를 당기고(게스트에게 닫힌 표면)
    PII 컬럼 필터가 마스킹본 위에서도 오라클이 되기 때문이다.
  - 음성 검증 넷: `tests/integration/guest-account-denial.test.ts`(라우터를 열거해 authed·superadmin
    전수가 게스트에게 FORBIDDEN, 부여 설문에서 열리는 capability 가 정확히 둘 — 나머지 어휘 전수는
    관문 거부)와 `survey-guests.realdb.test.ts`(부여 왕복·설문별 탭 독립·대상 자격·권한 축 —
    조인과 WHERE 는 목으로 증명되지 않는다). 콘솔 축은 `guest-console.realdb.test.ts`
    (홈 목록·탭 관문·마스킹 투영 — 「초대 토큰과 컨택 id 가 직렬화 결과에 없다」를 직접 본다).
    **cross-survey 축은 `guest-cross-survey.realdb.test.ts`**(티켓 23) — scoped 전수에 미부여
    설문 id 를 넣고 **사유의 대비**를 본다: 부여=FORBIDDEN, 미부여·남의 부여=NOT_FOUND.
    갈리지 않으면 거부는 같아도 게스트 계정 하나가 조사 목록의 존재 확인 창구가 된다.
- **외주 실사 링크는 계정이 아닌 두 번째 주체다**(ADR-0026, 티켓 01\~10). 연구원이 설문마다
  **전용 URL + 공유 비밀번호**를 발급하고(`survey_access_links` 의 `kind='fieldwork'`, 0126·0134 —
  발급·조회·비밀번호 열람·변경·종료 전부 `survey.manageAccess`, 표면은 `workspace.accessLinks`)
  외주는 계정 없이 그 설문의 운영 콘솔에 들어온다. **링크의 종류는 둘이다** — 이 절은 외주 쪽이고
  클라이언트 링크는 위 절이다.
  열리는 capability 는 **정확히 여섯** — `survey.view`·`operations.view`·`contacts.view`·
  `contacts.writeAttempts`·`responses.view`·`mail.sendSingle`. 처음 넷(실사 초대 열과 같은
  집합)에 ADR-0027 이 **응답 목록·상세·수정**과 **조사 대상 단건 메일**을 더했다. 옛 칸을 그대로
  주면 딸려 오는 것이 있어 **칸을 쪼갰다** — 응답 삭제·복원·초기화·재응답 허용은
  `responses.manage`, 메일 탭(단체 메일·템플릿·테스트 발송)은 `mail.send`/`mail.view` 로 남아
  링크에게 닫혀 있다. 내부 열은 쪼갠 두 칸을 함께 얻어 권한이 줄지 않는다.
  - **링크에 만료일이 없고 설문의 상태가 그 일을 한다** — 중단과 종료가 닫는다(위 「닫힘 표」).
    재개하거나 종료를 취소하면 **같은 주소·같은 비밀번호**로 다시 열리므로 만료가 아니라
    「중단 중 차단」이다. `isPaused` 는 **링크 주체만 보는 축**이다: 계정 열이 함께 닫히면
    실사 중단이 곧 운영 중단이 된다(연구원은 중단 중에도 콘솔을 쓴다).
  - **비밀번호 변경이 선 세션을 즉시 끊는다.** 쿠키가 `password_updated_at` 을 들고 다니고 매
    요청 DB 값과 **문자열로 대조**한다 — 시각의 대소가 아니라 값의 일치라 앱·DB 시계 오차와
    무관하다(계정 쪽 `sessions_revoked_at` 과 같은 발상).
  - **쿠키 이름이 `fw_<token>` 이다.** 업체가 두 조사를 병행하면 한 브라우저에 세션이 여럿
    서므로 이름이 고정이면 나중 조사가 앞선 조사를 덮는다. path 는 `/` 다 — 대리 응답이
    `/survey/...` 로 나간다.
  - **화면 정의는 내부 콘솔과 한 벌이다.** `/fw/<token>/operations/*` 가 같은 본문을 다른
    접두·capability·파티션으로 렌더한다(`src/app/_operations/` + `features/operations`).
    ADR 의 「화면을 따로 짜면 두 벌이 되어 한쪽만 고쳐진다」가 라우트가 둘이어도 지켜진다.
  - **외주임을 알리는 배지·배너가 없다.** 대리 응답도 응답자와 글자 하나 다르지 않고, 그래서
    `?fw=1` 힌트가 사라졌다 — 그 파라미터의 유일한 목적이 배너였다.
  - **귀속은 옆 칸이다**(0127·0133) — `contact_attempts`·`survey_responses`·`mail_campaigns`·
    `response_edit_logs` 의 `fieldwork_link_id`. 계정 칸과 **배타 CHECK** 로 묶이고, 주체에서
    파생시키는 `attributionOf` 가 잘못된 조합을 타입 단계에서 막는다. 회차·응답·캠페인은 저장만
    하고 화면에는 표시하지 않는다(조사 대상 표에 「기록자」 열을 만들지 않는다). **편집 이력만
    예외**다 — 원래 표시되는 기록이라 링크 행을 「외주」로 읽고, 외주 콘솔로 넘길 때는 연구원
    이메일을 걷는다(`ContactDetailScreen` 의 `hideStaffEmails` — 이력을 볼 자격과 내부 명단을 볼
    자격이 달라 capability 가 아니라 라우트가 정한다).
  - **단건 발송 창의 미리보기는 별도 표면이다**(`mail.preview.contactSample`, `mail.sendSingle`).
    템플릿 편집기의 `mail.preview.sample` 은 「첫 컨택」 폴백이 있는 메일 탭 표면(`mail.view`)이라
    그대로 열면 임의 컨택을 들여다보는 문이 된다 — 대상 지목이 필수인 짝을 세웠다.
  - **사내 실사원은 전용 모델이 아니다** — 설문마다 **전체 권한 참여자**로 초대되어 연구원과
    같은 콘솔에서 일한다. 공유 설정 실사 블록의 「내부 실사원」 세그먼트가 참여자 블록과 같은
    RPC 를 쓰고, 실사팀 소속을 묻지 않는다(실사팀은 그냥 팀이다).
  - **옛 실사 계정 모델(ADR-0019)은 공존하되 UI 입구를 잃었다** — 초대 블록에 이어 계정 발급과
    업체 관리 탭도 닫혔다(위 「발급 입구는 닫혀 있다」). 철거는 별도 스펙이다.
- 게스트·실사 콘솔과 **링크 둘(외주 실사 · 클라이언트)**은 전역 테스트 모드와 무관하게 항상 실데이터를 본다 —
  술어는 「내부가 아닌가」 하나이고, 계정은 `isExternalViewer`(세션), 주체를 받는 자리는
  `isExternalActor`(`server/data-scope`)가 답한다.
- **[옛 모델 — 입구 닫힘, 철거 전] 실사 초대는 개인 단위이고, 팀장의 업체 시야는 파생이다**(티켓 25, 스펙 §6, ADR-0019,
  .pen FLOW 4-2 실사 블록·10-1). `survey_participants` 의 `kind='fieldwork'` 행 하나가 그
  설문 하나를 연다 — 업체 단위 초대도, 업체 측 배정 UI 도 없다(MVP 무게로 기각).
  - **초대 열**은 `survey.view` · `operations.view` · `contacts.view` · `contacts.writeAttempts`
    넷이다. **조사 대상 원본**에 닿는 것이 게스트의 마스킹 원칙과 갈리는 지점이고, 근거는
    대리 실사라는 업무 자체가 연락처를 전제한다는 것이다. `contacts.manage` 가 없어 명단은
    못 고치고, 편집·메일·export·응답 상세·분석은 항상 차단이다.
  - **팀장의 파생 시야**는 그 열에서 `contacts.writeAttempts` 하나만 뺀다. 그 한 칸이
    「본인이 초대돼야 기록한다」의 전부이고, 두 칸 이상 갈리기 시작하면 파생 시야가 별개
    역할이 된 것이라 열을 새로 세워야 한다. **초대 판정이 파생보다 먼저 선다** — 뒤집으면
    본인이 초대된 팀장이 자기 설문에서 결과코드를 못 쓴다.
  - 파생 시야의 축은 **참여 행 밖**이다(`SurveyAccessRelation.fieldworkOrgInvited`). 주어가
    다르기 때문이다: 저쪽은 「내 초대 행」, 이쪽은 「내 업체 사람이 초대돼 있다」. 로더의
    EXISTS 는 **팀장에게만** 켜지고(관문은 전 요청이 지나는 자리라 남의 축의 비용을 지우면
    안 된다) 조인 조건이 **업체**인 것이 그 경계다 — 빼면 타 업체 설문이 그대로 넘어온다.
    소속원의 `status='active'` 도 함께 본다: 초대 행은 계정 상태를 따라 지워지지 않으므로,
    조건이 없으면 아무도 뛰지 않는 설문이 팀장 시야에 계속 선다.
  - **관문은 두 축**이다 — 조회·검색·추가는 `survey.invite`, 해제는 `survey.manageAccess`.
    게스트 블록과 같되 **탭 저장이 없다**: 실사에는 설문마다 고르는 화면 축이 없다.
    검색이 관문을 지는 이유는 후보 목록이 **협력사 인력 명부**라서다.
  - **주체의 소속·역할은 세션이 아니라 DB 에서** 읽고 **활성 업체일 때만** 채운다
    (`loadAccessSubject`). 업체가 종료되면 판정이 통째로 닫힌다.
  - **배치 로더는 파생 시야를 세우지 않는다** — 좁은 쪽으로 틀리고(거부), 오늘 도달 경로가
    없다. 실사가 지나는 배치 표면이 생기면 그 자리에 축을 함께 세울 것.
  - 음성 검증 둘: `fieldwork-account-denial.test.ts`(라우터 열거 — authed·superadmin 전수
    FORBIDDEN, 초대 설문에서 열리는 capability 가 정확히 넷)와 `fieldwork-invites.realdb.test.ts`
    (**업체 둘을 심는 것이 뼈대** — 업체가 하나뿐인 시드에서는 조인 조건이 있든 없든 결과가
    같아 「타 업체는 안 보인다」를 증명하지 못한다. 대칭까지 함께 잰다).
- **[옛 모델 — 입구 닫힘, 철거 전] 실사 콘솔은 초대가 여는 화면 둘이고 탭은 고정이다**(티켓 26, 스펙 §6, ADR-0019,
  .pen FLOW 10-2). `/fieldwork/surveys/[surveyId]` 아래 조사 대상·응답 현황이며, 게스트의
  탭 화이트리스트에 해당하는 축이 **없다** — 초대되면 둘 다 열린다. 관문
  `assertFieldworkSurveyPageAccess` 가 그 짝이고 **leaf 마다 자기 capability 를 준다**
  (조사 대상 `contacts.view` · 응답 현황 `operations.view`). 오늘은 실사 열에서 두 칸이 함께
  켜져 결과가 같지만, 물어야 할 것을 묻지 않으면 한쪽이 닫히는 날 원본 연락처가 열린 채로
  남는다. 거부는 전부 notFound 이고 사유를 갈라 말하지 않는다.
  - **조사 대상은 원본 전체**다 — 암호화 PII 를 페이지 단위로 복호해 평문으로 그린다
    (`read-models/fieldwork-contacts`). 게스트 투영이 마스킹 힌트를 주는 자리와 정확히
    대칭이고, 그 차이가 두 콘솔의 정의다. 컬럼 스킴은 **라벨·순서에만** 쓰고 `hidden` 은
    무시한다(「실사용 스킴 없음」은 따로 설정할 스킴을 두지 않는다는 뜻이지 담당 연구원의
    배치를 버린다는 뜻이 아니다). 메일 열은 아예 뺀다. 스킴이 담지 못한 attrs 키는
    **설문 전체**에서 뽑는다 — 페이지 행에서 뽑으면 표 머리가 페이지·검색어마다 흔들린다.
  - **초대 토큰은 본인이 초대된 실사에게만 실린다**(`canProxyRespond`). 팀장의 파생 시야에서는
    투영이 null 로 접고 화면은 판정을 다시 하지 않는다 — 버튼만 감추면 토큰이 RSC payload 로
    나가고, 그 링크는 `pub` 경로라 서버가 다시 못 막는다. ADR-0019 의 「본인이 대리 응답·
    결과코드를 입력하려면 본인도 초대돼야 한다」는 **투영에서만** 강제된다.
  - **메모·연락 방법은 좁은 표면 하나**다(`contacts.targets.setMemo`, 티켓 25 가 넘긴 항목).
    형제 `targets.update` 와 요구 capability 가 다른 것이 존재 이유다 —
    `contacts.writeAttempts` ↔ `contacts.manage`. 두 필드를 `update` 에 옵셔널로 얹으면 한
    표면이 두 자격을 지고 실사에게 명단 수정이 함께 열린다. 서비스도 `attrs`·PII·group_value 를
    건드리지 않는다. 화면의 저장 버튼을 회차와 가른 것도 같은 축이다 — 회차는 누적, 메모는
    덮어쓰기라 한 버튼이면 메모만 고치려다 회차가 쌓인다.
  - **작성자는 이 티켓이 처음 채웠다**(0121). `contact_attempts.created_by` 와
    `contact_uploads.uploaded_by` 의 FK 가 아직 `auth.users` 를 가리켜 **채울 수 없는
    컬럼**이었다(티켓 01·02 가 계정을 `public.users` 로 옮긴 뒤로). 값을 넣으면 곧바로 FK
    위반이라 `addAttempt` 는 아예 쓰지 않고 있었다.
  - 응답 현황은 **운영 위젯을 그대로** 쓴다(실사와 담당자가 같은 숫자를 봐야 한다). 컨택 표만
    새로 짠 이유는 게스트 콘솔과 같다 — 저쪽 표는 헤더 필터 팝오버가 RPC 를 당기고 업로드·
    메일 진입점을 함께 그린다.
  - 음성 검증은 `fieldwork-contacts.realdb.test.ts` — 복호 평문·작성자·파티션 고정·파생 시야의
    토큰 null·차단 표면. 암호화·INSERT·WHERE 라 목으로는 무엇이든 통과한다.
- **대리 응답은 응답자와 같은 페이지이고, 구별은 귀속 컬럼 하나가 진다**(티켓 27, ADR-0019,
  .pen FLOW 10-3). 실사가 「응답 대행」으로 여는 것은 `/survey/[id]?invite=…&fw=1` 이며 그
  화면은 응답자가 보는 것과 배너 한 줄 말고는 같다. 다르게 만들면 실사가 응답자와 다른 것을
  보게 되어 대행의 의미가 사라진다.
  - 판정 코어는 **`server/fieldwork-proxy`** — `data-scope`·`survey-access` 와 나란하다.
    판정이 도메인 하나에 속하지 않아서다(응답 도메인이 묻고, 접근 코어가 답의 절반을 갖고,
    컨택이 나머지를 갖는다). RPC 어휘로 옮기는 짝은 `rpc-fieldwork-proxy` 다.
  - **입력은 초대 토큰과 세션 쿠키 둘뿐이다.** 화면이 `fieldworkUserId` 를 실어 보내면 누구든
    남의 이름으로 귀속을 위조하므로 그 값은 계약에서 아예 뺐다(`FieldworkProxyContext`).
    팀장의 파생 시야는 `contacts.writeAttempts` 가 없어 자동으로 걸린다 — ADR-0019 의
    「본인도 초대돼야 한다」에 대한 두 번째 자물쇠다(첫 번째는 티켓 26 이 그 세션에 초대
    토큰을 주지 않는 것).
  - **귀속은 행 id 가 확정된 뒤 한 번 찍는다**(`stampFieldworkAttribution`). 진입 서비스마다
    인자로 흘려보내면 분기가 늘 때마다 챙겨야 하고, 실제로 셋을 놓쳤다 — 버전 이관이 성공한
    재개·기존 행을 물려받는 생성·대상자 테스트 lane. 셋 다 배너는 뜨는데 귀속이 NULL 이었다.
    **컨택 일치를 함께 건다**(세션 폴백이 남의 행을 돌려줄 수 있다). **null 로 덮어쓰지
    않는다** — 실사가 시작한 행을 응답자가 이어받아도 그 응답은 실제로 일부가 대행이다.
  - **「응답자 화면 diff 0」은 `?fw=1` 힌트가 지킨다.** 초대 토큰만 보고 배너를 물으면 초대
    응답자 **전원**이 왕복을 하나씩 더 하고 `lookup` 레이트리밋 예산을 재개 호출과 나눠
    쓴다. 힌트는 `?test=` 와 같은 자리의 장치이고 권한은 아무것도 주지 않는다. 같은 이유로
    배너는 **TanStack Query 를 쓰지 않는다** — 응답 흐름 트리에 QueryClientProvider 가 없고,
    배너 하나 때문에 provider 를 끼우면 응답자 트리 전체가 바뀐다(dom 스위트가 그것을 잡았다).
  - **완료된 대상의 대행 진입은 서버가 거부한다** — 화면이 버튼을 지우고 티켓 26 이 토큰을
    안 주지만 그 둘은 화면의 약속이다. **응답자 본인에게는 적용하지 않는다**(재응답 정책
    불변). 판정은 **삭제되지 않은** 완료 응답만 본다 — 담당 연구원이 불량 응답을 지우고
    재실사를 지시하는 것이 정상 동선이라, 술어가 없으면 그 대상이 영구히 대행 불가가 된다.
  - 음성 검증은 `fieldwork-proxy.realdb.test.ts` — 귀속·응답자 null 2종·자격 5종·진입 분기
    4종(물려받기·버전 이관·컨택 불일치·삭제된 완료)·완료 거부 3종.
- **[옛 모델 — 입구 닫힘, 철거 전] 실사 업체는 소속 경계일 뿐 워크스페이스가 아니다**(티켓 24, 스펙 §6, ADR-0019, .pen FLOW 10-4).
  `fieldwork_orgs`(0120)는 이름·상태·메모만 갖고, 설문을 소유하지 않으며(`surveys.team_id` 는 이
  테이블을 가리키지 않는다) 팀 멤버십을 만들지 않고 재배치 목적지가 될 수 없다. 하는 일은
  「이 실사 계정이 어느 업체 사람인가」 하나이며, 그 경계가 없으면 실사 팀장의 파생 시야(티켓 25)가
  타 업체 설문까지 넘친다. 관리 표면 5종(`workspace.fieldworkOrgs`)은 **전부 슈퍼어드민**이다 —
  업체 목록은 협력사 명부라 한 업체 사람에게 열면 경쟁 업체의 존재와 인원이 드러난다. 판정 술어를
  따로 두지 않은 것도 그래서다: 베이스가 곧 정책이라 `canManage*` 가 낄 자리가 없다.
  - **정합은 `users_fieldwork_fields_check` 가 지킨다** — 실사면 소속·역할이 둘 다 있어야 하고,
    아니면 둘 다 NULL 이어야 한다. `survey_participants.kind` 와 달리 **한 행 안의 조건**이라
    CHECK 로 걸 수 있다. 「업체 없는 실사 계정 생성 거부」는 세 겹이다 — 경계(`CreateUserInput`
    유니온) · 서비스(활성 업체 확인) · CHECK.
  - **종료는 재직 중 계정이 0명일 때만 된다.** 팀 해산과 갈리는 지점이다: 팀은 해산해도 팀원이
    「미배치」라는 정의된 상태로 내려가지만(ADR-0011) 실사 계정에는 그런 상태가 없다(소속이
    NOT NULL). 같은 이유로 **종료된 업체의 소속 계정은 복귀·재입사도 막는다** —
    `applyUserStatusChange` 한 자리가 두 전이를 함께 막는다(둘이 같은 문을 지난다).
  - **잠금이 짝을 이룬다** — 발급·재활성화는 업체 행을 `FOR SHARE` 로, 종료는 `FOR UPDATE` 로
    잡는다. 짝이 없으면 「활성으로 읽은 뒤 종료가 커밋」되는 창에서 **활성 계정을 가진 archived
    업체**가 남는다. 전역 전이 키는 도움이 안 된다: 업체 종료는 그 키를 잡지 않고, 종료가 세는
    것은 **재직 중** 계정이라 정지 계정을 되살리는 트랜잭션과 서로를 보지 못한다.
    `fieldwork-orgs.realdb.test.ts` 의 동시 실행 테스트가 그 불변식을 잰다(잠금을 빼면 빨개진다).
  - **이 티켓 자체는 capability 를 하나도 열지 않았다** — 소속 경계만 세웠고, 실사 열을 실제로
    연 것은 티켓 25 의 초대다. **업체가 없는 실사 계정은 지금도 전 칸 차단**이며 그 사실이 여전히
    계약이다 — 로더가 **활성 업체일 때만** 소속을 채우므로 업체가 종료되면 판정이 통째로 닫힌다.
    `capability-matrix-spec.test.ts`(티켓 23)가 열과 파생 시야를 행 단위로 고정한다.

---

## 테스트 모드

설문 단위 토글(`surveys.testModeEnabled` + `testToken`)로 운영 콘솔 전체가 테스트 파티션으로 전환된다. 파티션 키는 `is_test` 컬럼(`contact_targets`, `survey_responses`, `mail_campaigns`)이며, `contact_targets`의 resid UNIQUE도 `(surveyId, isTest, resid)`다.

- 읽기/쓰기 파티션은 `server/data-scope.ts`의 `loadOperationsDataScope`가 단일 결정한다. 신규 집계·목록 쿼리는 이 스코프를 반드시 태울 것.
- **외부 주체(게스트·실사 계정·외주 실사 링크·클라이언트 링크)는 항상 real 파티션**(읽기/쓰기 모두) — read/write 비대칭을 막기 위한 의도적 처리. 판정은 「내부가 아닌가」 하나이고 접근제어가 아니라 **파티션** 축이다. 계정은 `isExternalViewer`(세션을 읽는다), 주체를 받는 자리는 `isExternalActor` — 링크 세션에는 계정이 없어 앞의 것이 던지기 때문이다(`loadOperationsDataScope(surveyId, actor?)`). 티켓 25 에서 게스트 전용이던 이 규칙이 넓어졌다: 실사가 `contacts.view`·`contacts.writeAttempts` 를 얻으면서 컨택 표면이 실제로 열렸는데, 게스트만 고정하면 담당 연구원이 테스트 모드를 켠 설문에서 **실사원이 test 파티션을 읽고 결과코드를 test 로 쓴다** — 밖에서 전화를 돌리는 사람이 실데이터를 못 본다. 술어를 「게스트인가」가 아니라 **「내부가 아닌가」**로 적는 것이 요점이다.
- 테스트 응답 회차는 `test_response_attempts`가 추적(활성 회차는 responseId당 1개).
