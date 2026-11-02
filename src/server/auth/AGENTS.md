# 계정

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 인증과 권한 — 계정 수명주기·프로필

> 설문 관문·procedure 베이스는 `src/server/AGENTS.md`, 세션·게이트·로그인은 `src/lib/auth/AGENTS.md` 에 있다.

- **계정 수명주기**는 `server/auth`(도메인 규칙 + 서비스)와 `/users` 행 케밥이 담당한다.
  허용 전이는 `shared/contracts/auth.ts` 의 `USER_STATUS_TRANSITIONS` 하나가 정하고, 서버 강제
  (`resolveUserStatusTransition`)와 화면 메뉴(`availableUserStatusActions`)가 같은 표를 본다 —
  화면이 표를 따로 들면 "메뉴엔 있는데 누르면 CONFLICT" 가 된다. 전이는 advisory lock + 행 잠금
  아래에서 처리하고(마지막 슈퍼어드민 동시 정지 경합 차단), **모든 전이·재설정이 대상 세션을 전부
  끊고 `user_status_events` 에 감사 행을 남긴다**(재설정은 상태가 그대로라 from=to). 마지막 active
  슈퍼어드민 가드는 "이 전이로 active 가 0명이 되는가"만 묻는다 — 대상이 이미 비활성이면 적용하지
  않는다(그러지 않으면 정지된 슈퍼어드민을 영영 정리할 수 없다). **퇴사의 소유권 승계는 티켓 19 가 붙였고**(멤버십은 일부러 그대로 둔다)
  **재입사의 팀 배정은 티켓 14 가 붙였다**(`server/workflows/user-rehire` — 상태 전이와 배정이 한 트랜잭션).
- **프로필은 세 유형 공통**(.pen FLOW 3-2, `/profile`). 본인이 바꾸는 것은 이름·아바타·비밀번호
  뿐이다 — `UpdateProfileInput` 에 이메일·직책·소속이 없는 것이 이 표면의 정의다. 내부 계정은
  이메일·직책을 읽기 전용으로 보고, 게스트·실사에게는 그 두 칸이 아예 보이지 않는다(스펙 §10). 비밀번호 변경은 **다른 기기 세션만 끊고 현재 세션은 남긴다**(슈퍼어드민 재설정이 전부 끊는
  것과 갈리는 지점). 아바타는 전용 라우트 `/api/upload/avatar` 가 정사각 WebP 로 깎아 저장하고,
  서비스가 그 URL 이 우리 R2 공개 URL 인지 확인한다(외부 주소면 남의 서버가 우리 화면에 그림을 그린다).
- **계정 행의 규약은 `provider_id='credential'` + `account_id = user id` 둘이다** — 직접 발급(`createUser`)·
  비밀번호 재설정(`writeCredentialPassword`)·시드(`scripts/seed-superadmin.ts`)가 어댑터와 같은 행을 만든다.
  better-auth 1.7.0~1.7.2 에만 있던 `accounts.issuer` 는 1.7.3 부터 쓰이지 않는다: 0151 이 NOT NULL 을 풀고
  (issuer, account_id) UNIQUE 를 (provider_id, account_id) UNIQUE 로 바꿨고 Drizzle 스키마에서는 뺐다.
  1.7.14 는 시작할 때 **Drizzle 스키마**를 대조해 「쓰지 않는 필수 컬럼」이 있으면 인증 전체를 거부한다 —
  스키마에 NOT NULL 컬럼을 더할 때는 better-auth 가 쓰는지 볼 것(단위 테스트는 실제 인스턴스를 만들지
  않아 못 잡는다, `better-auth-session.realdb` 가 잡는다). DB 의 `issuer` 컬럼 자체는 1.7.14 앱이 나간 뒤
  지운다(1.7.1 앱이 그 값을 읽던 시기와 겹치지 않게).
- **실사·게스트 계정의 발급 입구는 닫혀 있다**(ADR-0029, 2026-10-12). 발급 가능 유형 목록
  `creatableUserTypes`(`shared/contracts/auth-io`, 지금 값은 `['internal']`) 하나를 계정 생성 창과
  발급 표면 `auth.users.create` 가 함께 본다 — 모양이 완전한 raw 요청도 BAD_REQUEST 다. **닫은 것은 입구이고 옛 모델은
  남아 있다**: 입력 유니온의 변종·서비스 `createUser`·부여 RPC(`workspace.guests`·
  `workspace.fieldwork`·`workspace.fieldworkOrgs`)·콘솔(`/guest`·`/fieldwork`)·테이블.
  이미 있는 계정은 로그인도, 부여된 설문의 열람도 종전대로다. 옛 모델의 스위트가 계정을
  **서비스로** 만드는 이유가 그것이다(RPC 로 만들면 닫힌 문에 걸린다). **철거는 링크 모델로
  실제 조사 한 건을 프로덕션에서 끝낸 뒤의 일이다 — 그 전에 「안 쓰는 코드」로 보고 지우지
  말 것.** `src/server/workspace/AGENTS.md` 의 「[옛 모델 …]」 절들은 그 **옛 모델의 설명**이다.
  **철거 순서의 전제**: 공존 창 동안 실사 업체(`fieldwork_orgs`)·실사 계정 유형·실사 역할·팀장 파생 시야·
  `/fieldwork` 콘솔·`survey_participants.kind='fieldwork'` 가 코드에 남아 **동작하되 UI 입구를 잃는다** —
  공유 설정의 실사 블록이 새 모델로 바뀌어 새 실사 초대를 만들 화면이 없다. 관리 불가 상태에 빠지지
  않는 근거는 **역할 모델 v2 가 프로덕션에 없다**는 것이다(v2 마이그레이션이 `origin/main` 에 없고
  staging 에만 있다) — 즉 공존 창에 관리할 실사 계정·업체 데이터가 0 건이다. **철거 착수 시점에 그
  전제가 바뀌었다면**(v2 가 프로덕션에 올라갔다면) 철거 전에 옛 블록을 **읽기 전용으로 남기는 단계**를
  먼저 넣어야 한다 — 그러지 않으면 이미 발급된 실사 계정의 초대를 해제할 화면이 없다. 옛 게스트 부여
  해제 화면(`guests-block`)도 여는 화면이 없어 같은 처지다.
