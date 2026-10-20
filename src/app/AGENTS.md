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
│   ├── assignments               # 컨택원 관리 → [assignmentId] 컨택원 수정(교체 적용) — 내부 계정·contacts.manage 전용, src/server/contacts/AGENTS.md 「컨택원 배정」
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

> 운영 집계·파티션은 `src/server/operations/AGENTS.md`, 메일 발송 주소·대체 발송은 `src/server/mail/AGENTS.md`, 컨택원 배정·조사 대상 필터 해석·ID 목록 검색은 `src/server/contacts/AGENTS.md`, 필터 바 구조는 `src/features/operations/AGENTS.md` 에 있다.

---

## 외주 링크 콘솔이 와이어프레임과 다르게 간 곳

ADR-0026 머리말이 「CONTEXT.md 「외주 실사 링크」 절의 구현 상태」로 넘기던 근거다(CONTEXT.md 를 용어집으로 줄이면서 여기로 옮겼다). **외주 링크 콘솔은 와이어프레임(`pencil/팀_워크스페이스_와이어프레임_v2.pen` FLOW 10·11)과 두 곳에서 다르게 갔다 — 그림에 맞춰 「고치지」 말 것.**

1. 10-4 의 **평문 조사 대상 목록** → 운영 콘솔과 같은 **마스킹 목록**을 쓴다. 그 그림은 옛 실사 콘솔(`read-models/fieldwork-contacts`)의 잔재이고 같은 파일의 11-2(사내 실사, 마스킹)와 어긋나 있었다 — 통화 동선이 어차피 단건 상세를 지나므로(거기서 복호 평문을 본다) 목록 마스킹이 추가 비용을 만들지 않는다.
2. 10-2 의 토큰 예시 `7Kq2xVb9`(8자) → **16자 이상**. 그림은 자리 표시이고 길이는 추측 저항이 정한다.
