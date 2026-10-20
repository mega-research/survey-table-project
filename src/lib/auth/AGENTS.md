# 인증 어댑터 — 세션·게이트

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 인증과 권한 — 세션·게이트·로그인

> 설문 관문·procedure 베이스는 `src/server/AGENTS.md`, 계정 수명주기는 `src/server/auth/AGENTS.md` 에 있다.

- **세션은 Better Auth**(ADR-0018). 인스턴스는 `lib/auth/server.ts` — email+password, UUID user id,
  30일 세션 + 하루 1회 사용 시 연장, `disableSignUp`(공개 가입 없음)·`autoSignIn` 없음·이메일 비밀번호
  재설정 없음(분실은 슈퍼어드민이 새 임시 비밀번호를 지정). sign-in 전 비활성 상태(active 외)를 차단하며
  실패 응답은 미존재 계정과 바디·타이밍까지 동일(더미 해시). 시드는 `pnpm auth:seed`.
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
- **유형별 목적지**(티켓 05): 홈 표의 SSOT 는 `lib/auth/account-home.ts` 의 `ACCOUNT_HOME_PATH`
  (internal→`/surveys` · guest→`/guest` · fieldwork→`/fieldwork`). 로그인 직후 목적지는
  `resolvePostLoginDestination` 이 정한다 — 게스트·실사가 요청한 내부 경로는 자기 홈으로 접는다
  (그대로 보내면 admin 게이트가 되돌려 보내 로그인 화면을 오가는 루프가 된다). admin·analytics
  레이아웃은 비내부 계정을 자기 홈으로 **리다이렉트**하고(존재를 감출 이유가 없어 notFound 가 아니다),
  `ACCOUNT_PAGES`(현재 `/profile`)만 비켜준다. **목적지 축은 하나다**(티켓 21) — 예전에는
  설문 단위 env grant 게스트가 먼저 갈라져 grant 설문 콘솔로 갔고 담당 아닌 설문을 향한 로그인은
  강제 로그아웃까지 했는데, 그 동선이 통째로 사라졌다.
