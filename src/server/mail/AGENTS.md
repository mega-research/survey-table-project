# 메일 발송

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·CI 게이트)은 루트 `AGENTS.md` 에, 마이그레이션 번호는 `supabase/AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 발송 주소 · 대체 발송

**메일 발송 주소 · 대체 발송** (0135·0137): 이메일 열이 여럿일 때의 발송 주소 순서(`mailOrder`)와 반송·거부 시 다음 순위 주소로 한 통 더 보내는 대체 회차(`kind='fallback'`, cron `mailFallbackSweeper` — 새 Inngest 함수라 배포 뒤 수동 Resync)는 `lib/contacts/mail-email-order.ts` · `lib/mail/send-address.ts` · `server/mail/services/campaign-fallback.ts` 머리 주석이 정본이다(용어는 CONTEXT.md 「발송 주소」). 새로 "이 대상의 이메일"을 읽는 자리를 만들면 `field_type='email'` 을 직접 거르지 말고 `lib/mail/send-address`(규칙)·`server/read-models/send-address`(DB)를 쓸 것.

## 테스트 발송

템플릿 미리보기(`preview.sample`)와 「테스트 발송」(`preview.testSend`)은 설문의 테스트 모드가 켜져 있고 테스트 조사 대상자가 있으면 **첫 테스트 대상자**(`read-models/contact-sample` 의 `getFirstTestTargetSample`)의 값과 초대 링크를 쓴다 — 브라우저가 실데이터를 보는 중이어도 같다. 아니면 그 파티션의 첫 조사 대상 값이고, 테스트 발송의 초대 링크는 견본(`/i/__test__`)이다. **실제 조사 대상의 초대 링크를 테스트 메일에 넣지 말 것.** 수신거부 링크는 늘 견본 토큰이고, 게스트는 테스트 대상자를 쓰지 않는다. 용어는 CONTEXT.md 「테스트 발송」, 배선은 `server/mail/services/preview.ts` 머리 주석.

## 링크 클릭

수신자가 메일 본문의 링크를 누른 기록이다(용어·경계는 CONTEXT.md 「링크 클릭」, 결정 배경은 ADR 0042). 수신 상태와 별도이고 클릭 한 번이 `mail_link_clicks` 한 줄이다.

- **경로**: 웹훅 라우트가 `email.clicked` 알림의 클릭 정보를 `domain/link-click` 의 `parseResendClick` 으로 읽어 `processResendWebhookEvent` 에 넘긴다. 서비스는 상태 알림과 **같은 함수**(`lockRecipientForEvent` — 회차 행 → 수신자 행)로 수신자를 잠근 뒤 줄을 넣고 수신 상태를 「열람」으로 올린다(`applyClickEvent`). 장부 · 클릭 줄 · 전이 · 회차 집계가 한 트랜잭션이다. 잠금 순서를 따로 만들지 말 것 — 상태 알림과 엇갈린다.
- **링크 종류는 주소로 정한다**(`classifyClickedLink`): 앱 주소(`NEXT_PUBLIC_APP_URL`)와 같은 호스트의 `/survey/…` · `/i/…` 는 설문 링크, `/unsubscribe/…` 는 수신거부, 나머지는 그 밖의 링크. 발송 서비스는 글자 링크와 이미지 링크를 구분하지 않는다. 「그 설문」의 주소인지는 따지지 않는다. **앱 주소를 모르면 판정하지 않고 던진다**(500 → 발송 서비스 재시도) — 판정 없이 저장하면 초대·수신거부 주소가 그 밖의 링크로 남는다.
- **주소는 그 밖의 링크만 저장하고, 그 사람 전용 토큰은 어느 경우에도 남기지 않는다.** 초대 링크·수신거부 링크의 주소에는 토큰이 들어 있다. 그 밖의 링크라도 경로가 우리 주소 모양(`/survey`·`/i`·`/unsubscribe`)이면 사이트 주소만 남기고(발송 뒤 앱 주소가 바뀌면 옛 메일의 링크가 다른 호스트로 온다), `invite` 매개변수는 어디에 붙어 와도 뺀다. 저장할 주소를 만드는 자리를 새로 두지 말 것 — `classifyClickedLink` 한 곳이다. IP 는 원문 없이 응답의 `ip_hash` 와 같은 식의 해시만 남긴다(`lib/duplicate-detection/salted-hash.server` — 식을 바꾸면 2단계에서 응답과 맞춰 볼 수 없다).
- **화면에 나가는 것은 링크 종류 · 첫 클릭 시각 · 그 밖의 링크 주소뿐이다.** IP 해시와 브라우저 정보는 어느 읽기 서비스·내보내기에도 싣지 않는다(2단계 재료). 로그·Sentry 에도 주소·IP·브라우저 정보를 싣지 않는다.
- **수신자당 200줄 상한**(`MAX_CLICKS_PER_RECIPIENT`): 수신자 행 잠금 아래에서 세고 넘으면 버린다(경고 로그). **그 수신자의 첫 설문 링크 클릭은 상한과 무관하게 남긴다** — 다른 링크로 상한이 찬 뒤 설문에 들어온 사람이 「없음」으로 남아 독촉을 받으면 안 된다. 메일 보안 장비의 자동 클릭을 추측해 걸러내지는 않는다 — ADR 0042. 클릭 정보를 읽지 못한 알림은 줄 없이 열람으로만 올리고 경고 로그를 남긴다(알림 모양이 바뀌면 여기서 드러난다).
- **회차 목록의 「클릭」은 집계 열이 아니라 조회 때 센다**(`campaigns-read` — 설문 링크를 누른 수신자 수, 보관된 수신자 제외). 집계 열을 만들지 말 것.
- **조사 대상 목록 · 단체 메일 위저드의 「링크 클릭」 열**(`system.link_click`): 칸·열 머리 필터·검색 조건·엑셀이 `lib/operations/contacts-filter-sql.server` 의 `linkClickStateExpr` 하나를 쓴다 — 눌렀다 / 받았지만 누르지 않았다 / 발송 이력 없음(NULL). 「발송 이력」의 범위는 수신 상황(`latestMailStatusExpr`)과 같아야 한다(보관 제외·같은 파티션). 설문 링크 클릭만 본다. 글자는 `filter-shared` 의 `linkClickLabel`·`LINK_CLICK_FILTER_OPTIONS` 한 곳이고 「응답」이라는 글자를 쓰지 않는다. 기존 설문의 열 스킴에는 읽을 때 「메일」 열 뒤로 끼운다(`contacts-format` 의 `withLinkClickColumn` — DB 는 고치지 않는다). 위저드는 고정 열 목록(`CAMPAIGN_HEADER_FILTER_COLUMNS`)에 있어 스킴과 무관하게 걸린다. **필터 후보는 켠 표면만 받는다**(`buildColumnCandidates` 의 `includeLinkClick` — 조사 대상 목록·위저드). 컨택원 교체 적용 조건(`surface: 'assignments'`)과 응답 내역은 받지 않는다 — 후보가 새 화면으로 저절로 퍼지면 그 화면이 값을 다루는지 아무도 보지 않는다. 선택 상자 열을 고른 직후의 값은 `defaultFilterValueForSource` 한 곳이다 — 비워 두면 화면에는 골라진 것처럼 보이는데 조건이 전송 전에 빠진다.
- **지난 회차를 채우지 않는다.** 구독을 켜기 전에 보낸 회차에는 기록이 없다 — 그 회차에서 누른 대상도 「없음」으로 보인다.
- **배포**: 마이그레이션 0170 을 먼저 적용하고, 앱 배포 **뒤**에 Resend 웹훅 구독에 `email.clicked` 를 더한다. 먼저 켜면 그 사이 알림은 장부에 「지원하지 않는 알림」으로만 적히고 다시 오지 않는다. Inngest Resync 없음.
