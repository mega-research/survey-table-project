# 앱 라우트 — src/app

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 디렉터리 구조

```
src/
├── app/                        # Next.js App Router
│   ├── (internal)/             # 내부 직원 콘솔 — **라우트 그룹이라 괄호는 주소에 없다**
│   │   │                       # `/surveys`·`/users`·… 가 곧 루트다(옛 `/admin` 접두 제거).
│   │   │                       # 그래서 1차 게이트가 접두 하나가 아니라 **루트 목록**을 본다 —
│   │   │                       # 어휘는 `lib/auth/protected-paths`, 완전성은
│   │   │                       # `tests/repo/proxy-matcher-coverage.test.ts` 가 디렉터리에서 확인
│   │   ├── surveys/
│   │   │   ├── create/         # 설문 생성
│   │   │   └── [id]/
│   │   │       ├── edit/       # 설문 편집
│   │   │       ├── preview/    # 빌더 미리보기
│   │   │       ├── analytics/  # 설문별 분석
│   │   │       └── operations/ # 운영 콘솔 (아래 라우트 섹션 참조)
│   │   ├── billing/mail-cost/  # 메일 비용 정산
│   │   ├── file-cleanup/       # R2 유예 삭제 큐 관리
│   │   ├── login/              # 로그인
│   │   └── profile/            # 프로필
│   ├── api/                    # API 라우트 (루트 AGENTS.md 의 "API 엔드포인트" 참조)
│   ├── _operations/            # **두 라우트 트리가 공유하는 페이지 본문** (ADR-0026)
│   │                           # overview-screen·report-screen·contact-detail-screen·profiles-screen
│   │                           # ·response-edit-screen(+ 클라이언트 admin-response-editor) — 조립이
│   │                           # 여러 서버 도메인을 가로질러 읽어(operations+quota+mail+read-models)
│   │                           # 도메인도 UI 도 소유할 수 없다. `_` 접두라 라우팅에서 제외된다
│   │                           # (선례: api/.../export/raw-export-load.ts). 조사 대상 목록은 조립이
│   │                           # read-model 하나로 닫혀 features 로 올라갔다 — 여기 오는 기준은
│   │                           # 「가로질러 읽는가」다
│   ├── _client-console/        # **두 입구가 공유하는 클라이언트 열람 본문** (ADR-0029) — overview·report·contacts
│   │                           # ·quota·preview-screen. 게스트 계정 입구(`/guest/surveys/[surveyId]`)와 클라이언트
│   │                           # 링크 입구(`/client/[token]`)의 page 는 관문과 주소 접두만 준다. **세션을 읽지 않는다** —
│   │                           # 받는 것은 설문 id 뿐이고 파티션은 실데이터 상수다(계정 없는 링크 세션에서도 돈다)
│   ├── client/[token]/         # 클라이언트 링크 (ADR-0029) — 고객사가 계정 없이 그 설문의 현황을 본다
│   │   ├── page.tsx            # 비밀번호 화면 + 닫힘 안내 (가드 없음). **조사 이름을 받지 않는다** — 접속된
│   │   │                       # 세션은 허용된 첫 탭(없으면 미리보기)으로 보낸다. 「탭 없는 주소」가 곧 이 화면이다
│   │   └── (console)/          # 셸(화면 머리·탭·나가기) + overview·report·contacts·quota·preview. 라우트 그룹인
│   │                           # 이유는 입구 화면에 셸이 서면 비밀번호 전에 조사 이름이 그려지기 때문이다.
│   │                           # QueryProvider 를 열지 않는다(부를 데이터 RPC 가 없다)
│   │                           # **얼굴은 운영 콘솔과 한 벌이다** — 화면 머리는 `OperationsPageHeader`(internalShell=false:
│   │                           # 새로고침·설문 보기·나가기 셋), 탭 줄은 같은 모양의 `GuestTabStrip`(판정만 탭 화이트리스트).
│   │                           # 설문 미리보기는 탭이 아니라 「설문 보기」가 연다. 기간·진행 상태는 탭 줄 오른쪽 한 줄.
│   │                           # 쿼터 현황 탭은 칩이 켜져 있어도 쿼터가 있는 설문에서만 선다(탭 줄만 감춘다 — 관문은 그대로)
│   ├── fw/[token]/             # 외주 실사 링크 콘솔 (ADR-0026) — 계정이 아니라 **링크**가 연다
│   │   ├── page.tsx            # 비밀번호 화면 + 닫힘 안내 (가드 없음 — 세션을 만드는 자리)
│   │   ├── preview/            # 설문 보기 — 콘솔 셸 밖의 열람 전용 화면(내부 /surveys/[id]/preview 의 짝)
│   │   └── operations/         # 깎인 헤더·탭 + contacts·contacts/[contactId]·overview·report·quota(읽기 전용 현황판)
│   │                           # ·profiles·profiles/[responseId]/edit (ADR-0027). 레이아웃이 QueryProvider 를 연다
│   ├── survey/[id]/            # 공개 설문 응답 페이지 (?invite=<uuid>)
│   ├── i/[code]/               # 짧은 초대 링크 (inviteCode → 응답 페이지)
│   ├── preview/[token]/        # 토큰 미리보기 (previewToken)
│   ├── analytics/              # 분석 대시보드
│   └── unsubscribe/            # 메일 수신거부 (+ /restored)
│
```

---

## 운영 콘솔 라우트

```
/surveys/[id]/operations/
├── (탭 없는 주소)                # 응답 현황으로 리다이렉트 — 없으면 404 다(옛 /admin 북마크가 접두를 걷고 닿는 자리)
├── overview                      # 응답 현황 (slice 1)
├── profiles                      # 응답 내역 (slice 2)
│   ├── [responseId]/edit         # 응답 상세/수정
│   └── columns                   # 응답 내역 컬럼 픽커
├── contacts                      # 조사 대상 = 컨택리스트 (slice 3)
│   ├── [contactId]               # 컨택 상세
│   ├── columns                   # 컬럼 스킴 편집
│   ├── new                       # 컨택 수동 추가
│   ├── result-codes              # 결과코드 설정
│   ├── assignments               # 컨택원 관리 → [assignmentId] 컨택원 수정(교체 적용) — 내부 계정·contacts.manage 전용, 아래 「컨택원 배정」
│   ├── prior-answers             # 이월 응답 임포트 (추적조사) — src/server/contacts/AGENTS.md 참조
│   ├── upload                    # 업로드 이력
│   └── upload/new                # 엑셀 업로드 마법사
├── report                        # 전시회/그룹별 진척률 리포트 (slice 4)
│   └── columns                   # 리포트 컬럼 픽커
├── quota                         # 쿼터 플랜 + 실시간 달성 현황
├── demand                        # 문항 수요 집계 (조사표가 붙은 설문에서만 탭이 나온다)
└── mail/                         # 메일 캠페인
    ├── templates                 # 템플릿 목록 → new, [mid]/edit
    └── campaigns                 # 캠페인 목록 → new, [cid]

/surveys?group=<groupId>    # 그룹 화면 (티켓 12 — 브레드크럼 + 폴더 제목 + 「그룹 편집」, 목록 툴바는 그룹 범위로)
/users                      # 사용자 관리 (슈퍼어드민 전용 — 유형·상태 필터 + 계정 직접 생성 + 행 케밥의 상태 전이·비밀번호 재설정)
                                  # 만들 수 있는 유형은 **내부 하나**다 — 실사·게스트는 설문별 링크로 바뀌어 발급 입구를 닫았고
                                  # 「실사 업체」 탭도 걷었다(ADR-0029). 목록의 유형 필터와 기존 계정의 상태 전이·재설정은 그대로다
/teams                      # 팀 관리 (슈퍼어드민 전용 — 메가리서치 카드 + 팀 카드 + 새 팀)
/teams/[teamId]             # 팀 상세 (슈퍼어드민 + 그 팀 소속 — 멤버 표·직책 인라인·역할·제외·팀원 추가)
/reassignment               # 재배치 센터 (슈퍼어드민 전용 — 미배치 사용자 / 배치 대기 설문 두 탭 + 일괄 배치 바)
/reassignment/surveys/[surveyId]  # 단건 설문 재배치 (새 소유자·목적지 팀·공개 범위 원자 확정)
/profile                    # 내 프로필 — **세 계정 유형 공통**. 내부 콘솔 트리에 있지만 내부 전용이 아니다(ACCOUNT_PAGES)
/billing/mail-cost          # 메일 비용 정산
/file-cleanup               # R2 유예 삭제 큐 (대기/이력/취소)

/guest                            # 게스트 홈 — 부여 설문 카드 (티켓 22, .pen FLOW 5-2)
/guest/surveys/[surveyId]         # 탭 없는 주소 — 첫 화면으로 리다이렉트(허용 탭 없으면 미리보기)
/guest/surveys/[surveyId]/preview   # 설문지 미리보기 — 화이트리스트 밖(부여됐으면 언제나)
/guest/surveys/[surveyId]/overview  # 응답 현황  · report 진척 보고 · contacts 조사 대상(마스킹) · quota 쿼터 현황
                                  # 넷은 전부 탭 화이트리스트가 연다 (.pen FLOW 5-3)
/client/[token]                   # 클라이언트 링크의 입구 — 비밀번호 화면 + 닫힘 안내 (ADR-0029). 가드가 없는 것이 정의다.
                                  # **조사 이름이 없다**(외주 입구와 다르다). 닫힘은 링크 종료·설문 종료·삭제·배치 대기 —
                                  # **설문 중단은 닫힘이 아니다.** 접속된 세션은 허용된 첫 탭(없으면 미리보기)으로 보낸다
/client/[token]/overview          # 응답 현황 · report 진척 보고 · contacts 조사 대상(마스킹) · quota 쿼터 현황 —
                                  # 연구원이 켠 탭만 열린다. 게스트 콘솔과 **같은 본문**(app/_client-console)
/client/[token]/preview           # 설문지 미리보기 — 탭 화이트리스트 밖(링크가 열려 있으면 언제나)
                                  # 관문은 assertClientLinkPageAccess(token, tab?) — 접속 전·닫힘은 입구로, 탭 밖은 notFound
/fw/[token]                       # 외주 실사 링크의 입구 — 비밀번호 화면 + 닫힘 안내 (ADR-0026)
                                  # 가드가 **없는 것이 정의**다(세션을 만드는 자리). 없는 토큰과 틀린
                                  # 비밀번호가 같은 화면이고, 닫힘(중단·종료·삭제·배치 대기)만 갈라 말한다
/fw/[token]/preview               # 설문 보기 — 배포 스냅샷을 열람 전용으로(응답이 남지 않는다). 콘솔 헤더의 「설문 보기」가 연다.
                                  # 미리보기 링크 복사는 없다 — previewToken 주소는 링크를 닫아도 열리는 pub 경로다
/fw/[token]/operations            # 탭 없는 주소 — 조사 대상으로 리다이렉트
/fw/[token]/operations/contacts   # 조사 대상 목록 — **내부 콘솔과 같은 화면 정의**(ContactsListView)
                                  # 다운로드·업로드·이월 임포트·대상 추가·컬럼 설정은 그려지지 않고
                                  # 메일 열은 열·필터 후보·정렬 셋이 로더에서 함께 닫힌다
/fw/[token]/operations/contacts/[contactId]  # 단건 상세 — 연락처 복호 평문 + 회차·메모(저장 버튼이 다르다)
                                  # + 응답 수정 진입·편집 이력(연구원 이메일은 걷는다)·단건 메일·그 사람의 발송 이력 (ADR-0027)
                                  # 명단 수정 폼·삭제·응답 초기화·재응답 허용은 없고, 그리지 않는 것은 읽지도 않는다
/fw/[token]/operations/profiles   # 응답 내역 — 내부 콘솔과 같은 본문(profiles-screen). 삭제·복원·초기화·휴지통 보기·
                                  # 컬럼 설정은 없다 · [responseId]/edit 응답 수정 (ADR-0027)
/fw/[token]/operations/overview   # 응답 현황 · report 진척 보고 — 운영 위젯을 그대로 쓴다(같은 숫자)
/fw/[token]/operations/quota      # 쿼터 현황 — **읽기 전용 현황판 하나**(2026-10-12). 플랜 편집은 없다(`survey.edit` 축).
                                  # 본문은 클라이언트 콘솔과 같은 것(app/_client-console/quota-screen), 관문은 operations.view —
                                  # 새 capability 를 세우지 않았다(링크의 여섯 칸 그대로). 탭 이름은 「쿼터 현황」이고
                                  # **쿼터가 없는 설문에서는 탭이 서지 않는다**(`hasQuotaPlan` — 현황 화면의 빈 상태와 같은 술어)
                                  # 관문은 assertFieldworkLinkPageAccess 이고 leaf 마다 자기 capability 를 준다

/fieldwork                        # 실사 홈 — 초대 설문 목록 (.pen FLOW 10-1, 티켓 25)
                                  # 실사원은 초대 설문만, 실사 팀장은 「업체 전체」 세그먼트로 소속원 초대까지
/fieldwork/surveys/[surveyId]     # 탭 없는 주소 — 조사 대상으로 리다이렉트
/fieldwork/surveys/[surveyId]/contacts   # 조사 대상 — 원본 전체(복호 PII)·결과 기록·메모 (티켓 26, .pen 10-2)
/fieldwork/surveys/[surveyId]/overview   # 응답 현황 — 운영 위젯 그대로
                                  # 탭은 **고정**이다(게스트의 화이트리스트 축이 없다). 관문은
                                  # assertFieldworkSurveyPageAccess 이고 leaf 마다 자기 capability 를 준다
```

응답 페이지 진입 경로: `/survey/[id]?invite=<uuid>` 또는 짧은 링크 `/i/<inviteCode>`. 실사 대행은 같은 주소에 `&fw=1` 힌트가 붙는다(티켓 27) — 배너를 물을지만 정하고 **권한은 주지 않는다**. invite 해석 → contact_targets lookup → survey_responses.contactTargetId 매칭. 토큰 무효 시 안내 화면 + 익명 응답 폴백. **수신거부(unsubscribed_at)·부정 결과코드는 초대 링크 응답을 막지 않는다** (2026-09-01 결정 — 수신거부는 메일 채널 해지일 뿐; 단체 메일 제외·모수 제외는 각자 경로가 담당). 완료 응답이 있는 토큰만 `token_already_used` 로 차단. surveyId가 UUID인 경우 private_token fallback 필요. 빌더 미리보기는 `/preview/<previewToken>`.

> 운영 집계는 `server/operations/services` 에서 SQL 집계로 수행 (aggregate + format + wrapper 패턴 — 공유 format 짝은 `lib/operations/*-format.ts`, UI 도 소비하므로 lib 이 정답). 정확한 통계는 `question_responses` JSONB 기준 (response_answers는 saveResponse/saveAdminEdit 에서만 채워짐).
> 콘솔 조회·쓰기는 `loadOperationsDataScope`가 결정한 실/테스트 파티션(`is_test`)에 갇힌다. 엑셀·SPSS export 라우트도 같은 스코프를 탄다. 신규 집계 쿼리는 스코프 필터를 빠뜨리지 말 것.
> **메일 발송 주소 순서** (2026-10-14): 명단에 이메일로 암호화된 열이 여럿이면(대표자 e-mail · 실무자 e-mail …) 컬럼 설정(`contacts/columns`)의 「발송 주소 순서」로 어느 열의 주소로 보낼지 정한다 — 이메일 열이 둘 이상일 때만 열이 나온다. 저장은 컬럼별 `mailOrder`(1부터)이고 파티션마다 스킴이 따로라 순서도 따로다. **순위를 준 열만 후보**이고 순위 오름차순으로 값이 있는 첫 열의 주소를 쓴다(1순위가 비면 다음 순위). 순위 밖 열에만 주소가 있는 대상은 발송되지 않고 사전 점검이 「이메일 누락」으로 센다. **어느 열에도 순위가 없으면 종전대로 `column_key` 오름차순 첫 열**이다 — 그래서 미설정 설문은 `대표자 e-mail` 이 `실무자 e-mail` 을 이긴다. 해석은 `lib/contacts/mail-email-order.ts` 의 `resolveMailEmailOrder`(→ `MailEmailOrder`, null = 미지정) 한 곳이다. 이 순서를 타는 자리는 일곱이다 — 발송(`createCampaign`, 스코프 SHARE 잠금으로 스킴을 같이 읽는다) · 사전 점검(`preflightRecipients`) · 후보 목록·제외 집계(`hasEmailCandidateSql`) · 반송 제외 예고(`listBouncedContactIds` — 파티션을 가리지 않는 함수라 `is_test` 로 순서를 갈라 쓴다) · 단건 선검증 · 미리보기 샘플 · 수신거부 화면(`loadSendEmailForTarget`). 일곱 모두 아래 「발송 주소 모듈」을 거친다. 교체 업로드는 스킴을 다시 만들지만 순서는 열 이름이 같은 이메일 열에 이어 붙인다(`carryOverMailOrder`) — 빠지면 재업로드 한 번에 조용히 대표자 주소로 돌아간다. 이미 만든 캠페인은 `email_snapshot` 이 고정이라 영향이 없다. 대상별 지정(컨택 상세에서 한 명만 다른 열로)은 미구현이다.
> **발송 주소 모듈** (2026-10-19 — CONTEXT.md 「발송 주소」가 정본): 「이 대상에게 어느 주소로 보내는가」 — 이메일 열 · 발송 주소 순서 · 복호화 실패 · 칸 안 여러 주소 · 반송 주소 — 를 한 곳이 소유한다. 규칙(순수)은 `lib/mail/send-address.ts`(`resolveSendAddress` → `send`/`bounced`/`missing`, `pickSendAddress`, `sendableValue`, `remainingSendValue`)이고 DB 얼굴은 `server/read-models/send-address.ts` 다 — 순서 로더(`loadMailEmailOrder(s)`) · 반송 주소(`loadBouncedAddresses` → `BouncedAddresses`, 칸 값 그대로 + 주소 하나로 보낸 메일의 주소) · 행 얼굴(`selectEmailPiiRows`·`decryptSendAddressCells`·`resolveSendAddresses`·`loadSendAddressCells`·`loadSendEmailForTarget`) · SQL 얼굴(`emailCandidateSql`·`emailOrderSql`·`hasEmailCandidateSql`·`allCandidatesBouncedSql`). **행 얼굴은 정확하고 SQL 얼굴은 칸 단위 근사다** — 암호문은 SQL 이 나눌 수 없어, 칸 안 주소가 하나씩 따로 반송된 대상은 마법사 목록 위 「반송 이력 제외」 예고에서 빠진다(2026-10-19 결정 — 예고는 근사, 발송 직전 사전 점검은 발송과 같은 판정으로 정확). 발송 · 사전 점검 · 대체 발송이 같은 `resolveSendAddress`/`pickSendAddress` 를 써서, 칸째 반송된 칸(여러 주소 한 통의 반송)은 대체 발송도 건너뛴다. 단건 발송·미리보기 샘플·수신거부 화면·마법사 목록 마스킹은 반송을 보지 않는다 — 순서상 첫 주소를 보인다(같은 날 결정, 단건이 실제로 쓰는 주소). **새로 "이 대상의 이메일"을 읽는 자리를 만들면 `field_type='email'` 을 직접 거르지 말고 이 모듈을 쓸 것.** `lib/crypto/contact-pii-repo.ts` 는 PII 저장·복호화만 남았다.
> **메일 대체 발송** (2026-10-16, 0135): 수신자가 **반송**(webhook·reconcile)되거나 메일 서비스가 주소를 **거부**(발송 시 영구 실패)하면, 발송 주소 순서의 **다음 이메일 열**로 자동으로 한 통을 더 보낸다. 원래 회차 아래 `kind='fallback'` 회차를 하나 붙여 그 수신자로 넣고 `mail/campaign.queued` 를 다시 낸다 — 발송·lease·webhook·집계는 기존 장치 그대로. 대체 발송이 또 반송되면 그 대체 회차의 자식 회차(「· 대체 발송 2차」)로 3순위 …. 수신자 한 줄 = (회차, 조사 대상) 유일 제약 때문에 같은 회차에 쌓지 않는다. 다음 주소 판정은 `lib/mail/fallback-address.ts` 의 `pickFallbackAddress`(쓴 열의 다음 열 · 사슬에서 보낸 주소와 이 설문 반송 주소는 건너뜀 · 쓴 열을 모르면 값으로 찾음), 서비스는 `server/mail/services/campaign-fallback.ts` 의 `requestRecipientFallbacks` 이고 **상태 전이가 커밋된 뒤** webhook·reconcile·dispatch(영구 실패 settle 직후) 세 곳이 부른다. 응답 완료·수신거부·스팸 신고(complained — 수신거부로 수렴)·연락 금지 결과코드·회차 취소/보관이면 보내지 않는다. 끝난 대체 회차에 늦은 반송이 오면 회차를 `queued` 로 다시 연다. 단건 발송도 같다. 대기 중에 응답을 마치면 발송 직전 확인(claim)이 대체 회차에 한해 건너뛴다(`skipped_unsubscribed` + 사유 「응답 완료로 대체 발송 생략」 — 단체·단건은 응답자에게 일부러 보내는 경우가 있어 거르지 않는다). **대체 발송 등록 자체가 빠지는 경우**(전이 커밋 뒤 DB 오류·프로세스 종료 — webhook 은 중복 제거로 다시 오지 않는다)는 0137 `fallback_pending_at` 이 막는다: 반송·거부 전이(`applyRecipientTransition`·dispatch 영구 실패 settle)와 **같은 트랜잭션**에서 표식을 찍고, `queueRecipientFallback` 이 대체 회차에 넣거나 보내지 않기로 판정하면서 같은 트랜잭션에서 지운다(표식이 없으면 아무것도 안 한다 — 즉시 경로와 점검이 겹쳐도 한 번). 표식이 2분 넘게 남은 수신자는 Inngest cron `mailFallbackSweeper`(10분마다)가 `retryPendingRecipientFallbacks` 로 다시 처리하고, 3일이 넘은 표식은 늦은 발송이 되므로 건너뛴다. 대체 수신자를 커밋한 뒤 큐 발행이 실패해도 같은 점검이 대기 수신자가 2분 넘게 그대로인 대체 회차를 다시 큐에 올린다 — **배포 뒤 Inngest 대시보드 수동 Resync 필요**. 반송·이미 보낸 주소 비교는 칸이 아니라 **주소 하나하나**로 한다(`lib/mail/send-address` 의 `remainingSendValue`) — 「a / b」 칸이면 반송된 a 만 빼고 b 로 보낸다. 반송 주소로 확정하는 것은 주소 하나로 보낸 메일의 반송뿐이다(여러 주소 한 통의 반송은 어느 주소인지 몰라 칸 값 통째로만 막는다). 한 통에 담기는 주소는 `lib/mail/split-email-addresses.ts` 가 칸 하나의 여러 주소(`/` `,` `;` 줄바꿈)를 나눈 것이다. **반송 제외 규칙** — `listBouncedContactIds` 는 후보 이메일 열이 **전부** 반송 주소인 컨택만 빼고, `createCampaign`(bulk)은 반송된 열을 건너뛰고 다음 순위 열을 쓴다.
> **컨택원 배정** (2026-10-19, 0136 — CONTEXT.md 「컨택원 배정」이 정본): 컨택원은 계정이 아니라 이름 붙은 배정 묶음이고 한 대상은 지금 컨택원 하나에만 속한다(마지막 배정이 이긴다, 응답 상태 무관). **내부 실사 운영 도구라 외부 주체(외부 계정·외주 실사 링크·클라이언트 링크)에게 열지 않는다.** procedure `contacts.assignments.*` 는 베이스가 전부 `authed`(내부 계정 전용)이고 핸들러 첫 줄이 `assertSurveyCapabilityRpc(context.user, surveyId, …)` 다 — `list` 는 `contacts.view`, 나머지는 `contacts.manage`(외부 주체는 이 칸을 갖지 않는다). 전부 IDOR 인벤토리 `tests/integration/cross-team-idor-rpc.test.ts` 에 등재돼 있다. 관리 화면(`(internal)/surveys/[id]/operations/contacts/assignments` + `[assignmentId]`)은 `requireAdminPage()` + `assertSurveyCapabilityPage(viewer, surveyId, 'contacts.manage')` 가 막고, 주소는 `operationsPaths(base).contactsAssignments` / `.contactsAssignment(id)`(`features/operations/operations-paths.ts`), 탭 「컨택원 관리」는 `contacts.manage` 아래에만 선다. 외부 주체가 보는 화면은 컨택원을 전부 받지 않는다 — 조사 대상 목록의 「컨택원」 열·값·필터 후보·정렬(`loadContactsListPage` 의 `includeContactOwner` — 내부 페이지 `true`, `/fw` 링크 페이지 `false`. 끄면 로더 `includeAssignment:false` + `withoutContactOwnerColumn`), 외부 계정·클라이언트 링크 목록(`read-models/guest-contacts`)과 실사 계정 목록(`read-models/fieldwork-contacts`)의 `includeAssignment:false`, 단건 상세 드롭다운(`app/_operations/contact-detail-screen.tsx` 의 `includeContactOwner` — 내부 페이지만 켜고 `contacts.manage` 도 있어야 그린다), 진척 보고 칩(`app/_operations/report-screen.tsx` 의 `includeContactOwner` — 내부 `true`, `/fw` `false`). 쓰기는 `lockWriteScope` 파티션 아래서 하고 대상과 컨택원의 `is_test` 가 같아야 한다. 서비스는 `server/contacts/services/contact-assignments.ts`(만들기·이름·순서·지우기·한 명 바꾸기·관리 목록 통계 — 응답 상태는 목록 web 열과 같은 `matchedResponseSubquery`) · `contact-assignment-apply.ts`(교체 적용·미리보기·오른쪽 대상 목록) · `contact-assignment-facets.ts`(오른쪽 값 목록). **교체 적용**은 컨택원 행 `FOR UPDATE` 로 같은 컨택원 동시 적용을 직렬화하고 조건을 적용 시점에 다시 평가한다 — 조건 줄 0개 거부, 결과 0명 허용, **해석이 안 되는 절이나 읽지 못한 `list:` 토큰은 거부**(목록 검색처럼 조용히 버리면 조건이 넓어져 남의 배정을 끌어온다). 조건 밖 판정은 `COALESCE(filter, FALSE)` 로 감싼다(3값 논리로 빠지는 행이 없게). **들어옴·빠짐은 한 UPDATE 문장**(`CASE WHEN match THEN 이 컨택원 ELSE NULL`)이다 — 두 문장으로 나누면 조건이 「현재 컨택원」·「배정 없음」일 때 뒤 문장이 앞 문장이 바꾼 값을 다시 읽어 방금 옮긴 대상을 도로 푼다. 교체 적용·지우기는 서로 다른 컨택원끼리 겹치는 대상을 다른 순서로 잠가 교착(40P01)이 날 수 있어, 충돌이면 처음부터 다시 실행한다(`retryAssignmentWrite` → `lib/pg-error` 의 `retryOnTxConflict`, 3번까지 — 다시 돌 때 조건도 새로 계산하므로 나중에 끝난 쪽이 이긴다). 배정은 교체 적용과 상세 한 명 바꾸기로만 한다(조사 대상 목록 위의 「검색 결과 N명을 컨택원에 배정」은 걷어냈다). 목록 주소·스냅샷·조건 줄을 서버에서 읽는 자리는 아래 「조사 대상 필터 해석」을 거친다 — 그 결과로 대상을 고르거나 쓴다면 `mode: 'write'` 로 해석해 해석되지 않는 조건을 거부한다. 스킴에 `system.contact_owner` 열이 없는 옛 설문은 컨택원을 처음 만들 때 그 파티션 스킴 끝에 붙인다(`ensureContactOwnerColumn`). 교체 업로드 경고는 풀릴 배정 수(`countAssignedTargets`)를 보이고, 테스트 모드를 삭제로 끄면(`disableTestWorkspace`) 테스트 컨택원도 지운다. 컨택원 열은 엑셀 내려받기 제외 목록에 그대로 있다.
>
> **필터 확장** (컨택원 배정과 함께): ① 「현재 컨택원」 `FILTER_SOURCE.CONTACT_OWNER`(`system.contact_owner`) — 값은 컨택원 id, 배정 없음은 `FILTER_NONE_VALUE`. 해석 모듈이 이 설문·세션 파티션 컨택원 id 로 검증하고(하위 파서의 `ParseExtraHooks.assignmentIds`, 외부 주체 컨텍스트는 넘기지 않아 절이 만들어지지 않는다) 다른 설문·파티션 id 는 0건이 아니라 조건 미적용. 열 후보는 `buildColumnCandidates(scheme, { includeContactOwner: true })` 로 켠 표면만 받는다 — 조사 대상 목록·컨택원 수정·**단체 메일 위저드**(「이메일 갱신」처럼 컨택원으로 묶은 명단에 보내기) 셋이고 셋 다 외부 주체에게는 끈다(위저드의 「필터 결과 전체 선택」 `fetchCandidateIds` 도 procedure 가 넘긴 `isExternalActor(context.actor)` 로 같다). **주소·스냅샷의 절이 지금 해석되지 않으면**(지워진 컨택원·빠진 열·읽지 못한 `list:` 토큰) 읽기 해석은 버려 명단이 넓어지므로 결과의 `unresolved` 로 알린다 — 위저드는 경고를 띄우고 「미응답자 재발송」 자동 전체 선택을 하지 않으며, `fetchCandidateIds` 는 write 해석이라 `BAD_REQUEST` 로 거부한다. 컨택원 열에도 「메일 표시」 스위치가 있다 — 켜면 위저드 미리보기·캠페인 상세 수신자 표·수신거부 명단에 지금 컨택원 이름이 나오고, 외부 주체 화면은 켜 두어도 싣지 않는다(단체 메일 페이지가 `isExternalViewer()` 로 정해 `resolveMailDisplayColumns(scheme, { includeContactOwner: !isExternal })` → 로더 `includeAssignment`). 열 정렬 키 `owner`(컨택원 순서 → 이름, 배정 없음 끝). ② `짝수`/`홀수` — 시스템ID·attrs ID 목록 입력이 **그 한 단어일 때만** 키워드(`parseParityKeyword`, `FilterCondition.parity`). attrs 는 값 전체가 숫자인 행만(앞자리 0 허용) 나머지 연산, 숫자 아닌 값·빈 값은 어느 쪽에도 안 걸린다 — 상태줄의 「숫자가 아닌 값 N명 제외」는 `contacts.attrValues.nonNumericCount`(`scoped` + `contacts.view`, `attrValues.list` 와 같은 권한이라 외주 실사 링크에도 열린다 — `LINK_OPEN_SCOPED_PATHS`). 진척 보고 필터(`progress-filters` 의 `mode:'parity'`)도 같다. ③ 조건 줄 값 하나에 여러 값 — `encodeMultiClauseValue`(양끝까지 `\u001f` 구분자, trim 이 값 앞뒤 공백을 못 지우게)로 담으면 파서가 헤더 체크박스와 같은 in 절로 읽는다(컨택원 수정 화면 오른쪽 값 목록이 만든다).
>
> **조사 대상 필터 해석** (2026-10-19 — CONTEXT.md 「조사 대상 필터 해석」이 정본): 조사 대상 목록 · 단체 메일 위저드 · `fetchCandidateIds` · 교체 적용(미리보기·오른쪽 목록 포함) · 컨택원 수정 화면이 `server/read-models/contact-filter-resolution.ts` 한 곳으로 조건을 읽는다. `loadContactFilterContext(surveyId, scope, { isExternal, surface: 'contacts' | 'mail', canViewMail?, executor? })` 가 스킴(외부 주체면 컨택원 열 제거, `canViewMail:false` 면 메일 열 제거 — 외주 실사 링크 목록)·결과코드·컨택원 선택지(외부 주체면 빈 배열)·검색바 후보·열 머리 후보(`mail` 이면 미리보기 고정 열 `CAMPAIGN_HEADER_FILTER_COLUMNS` 를 덧붙임)를 읽고 — 페이지는 같은 컨텍스트를 UI props 에도 쓴다 — `resolveContactFilter(ctx, input, { mode })` 가 ID 목록을 읽어 해석한다. 입력은 캠페인 스냅샷 모양(`{ clauses: {source,value,op}[]; headerClauses?: {source,mode,hv}[] }`)이고 주소는 `contactFilterInputFromUrl(sp)` 로 바꾼다. 결과 `ResolvedContactFilter<'read'|'write'>` 는 이 모듈만 만드는 브랜드 타입이고 `{ clauses, builderClauses, headerClauses, unresolved }` 다. 서버 코드가 직접 조립한 절(검색 축이 화면에 고정된 실사 계정·클라이언트 링크 목록 — `read-models/fieldwork-contacts`·`guest-contacts`)은 같은 모듈의 `contactFilterFromServerClauses(clauses)` 로 감싼다 — 사용자가 고른 열 이름을 읽는 주소·스냅샷 입력에는 쓰지 않는다. `listContactsForSurvey`·`previewCampaignCandidates`·`countCampaignCandidates` 는 이 결과(`filter`)만 받고, 교체 적용 같은 **쓰기 서비스는 `ResolvedContactFilter<'write'>` 만 받는다** — write 해석은 해석 안 되는 조건이 하나라도 있으면 `ORPCError BAD_REQUEST`(문구는 모듈 소유: 「조건 N을(를) 지금 적용할 수 없습니다…」 · 「저장된 ID 목록을 찾을 수 없습니다…」). 조사 대상 목록 조립은 `server/read-models/contacts-list-page.ts` 의 `loadContactsListPage({ …, canViewMail, includeContactOwner })` 한 곳이고 화면은 `features/operations/contacts/contacts-list-view.tsx` 다 — 내부 콘솔과 `/fw` 링크 콘솔이 같은 조립을 쓰고 두 칸만 다르다(해석 컨텍스트의 `isExternal` 은 `!includeContactOwner`). 하위 파서는 `read-models/contacts-filter-parse.ts` 이고 ESLint 가 해석 모듈 · 응답 내역(`profiles-filters`, 응답 행 위 다른 열을 보는 표면이라 하위 파서 + 훅을 직접 쓴다) · 서버 트리 테스트 밖의 import 를 막는다(`eslint.config.mjs` 의 `CONTACT_FILTER_PARSE_PATTERN`). `listAssignmentOptions` 는 `read-models/contact-assignment-options.ts` 에 있다. `buildContactsFilterSql` 은 lib 공용이라 `FilterClause[]` 를 그대로 받는다. 테스트에서 해석이 관심사가 아니면 `tests/helpers/resolved-contact-filter.ts` 의 `resolvedFilterForTest` 를 쓴다.
>
> **필터 바 구조**: `features/operations/filters/filter-bar-core.tsx` 의 `FilterBarCore` 는 제어형(`rows`/`onRowsChange`, router·searchParams 를 모른다, `as:'div'` 로 다른 폼 안에, `variant:'stack'` 은 조건 줄 전부 펼침)이고, 주소 직렬화·헤더 필터 상호배타·page 초기화는 `url-filter-bar.tsx` 의 `UrlFilterBar` 가 맡는다(조사 대상·응답 내역·단체 메일 위저드). 2,000개 넘는 ID 목록 토큰 변환은 `prepareContactClauseValue`(contacts-filter-bar)로 검색바와 컨택원 수정 화면이 같이 쓴다. 진척 보고 검색바(`progress-filter-bar`)는 별개 단일 검색바다.
>
> **진척 보고 분류 키는 태그 키**다(`lib/operations/report-progress-format` 의 `ProgressGroupKey` — attrs 키는 접두 없이 그대로 직렬화해 옛 `groupBy=` 주소가 열리고, 시스템 기준은 `system:<이름>`, 어휘 `PROGRESS_SYSTEM_GROUP_KEYS`, 읽기·쓰기는 `parseProgressGroupKey`/`formatProgressGroupKey`). 집계(`report-progress` 의 `groupKeySql`)는 기준마다 값·표시·정렬 식을 따로 내고, 행의 `groupValues` 는 표시 값이다. 「컨택원」 칩은 `includeContactOwner` 를 켠 화면에서 컨택원이 있을 때만 맨 끝에 **기본 꺼짐**(`defaultOff`)으로 나오고 — `resolveActiveGroupKeys` 가 `groupBy` 미지정이면 `defaultOff` 가 아닌 기준만 켠다 — 배정 없음은 「(배정 없음)」 한 줄이다. 클라이언트 링크 진척 보고(`app/_client-console/report-screen.tsx`)는 attrs 기준만 넘긴다.

> 조사 대상·단체 메일 위저드의 시스템ID/attrs 컬럼 검색은 **엑셀 열 붙여넣기 ID 목록**을 받는다 (`lib/operations/range-list.ts` — 공백·개행·탭·콤마 구분, 중복 제거). 단일 컬럼 인라인 상한 2,000개(URL 헤더 한계), 초과분은 `contacts.idLists.create` 로 `contact_id_lists` 에 저장하고 `q=list:<uuid>:<count>` 토큰으로 검색한다. 토큰은 조사 대상 필터 해석이 읽는다(`loadIdListsForValues`, `server/read-models/contact-id-lists.ts`) — 호출자가 따로 읽을 일이 없다. 「전체」 컬럼 검색의 200개 상한은 컬럼 곱연산 SQL 보호용으로 별개다.
