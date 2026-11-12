# 메일 발송

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 발송 주소 · 대체 발송

**메일 발송 주소 · 대체 발송** (0135·0137): 이메일 열이 여럿일 때의 발송 주소 순서(`mailOrder`)와 반송·거부 시 다음 순위 주소로 한 통 더 보내는 대체 회차(`kind='fallback'`, cron `mailFallbackSweeper` — 새 Inngest 함수라 배포 뒤 수동 Resync)는 CONTEXT.md 「발송 주소」가 정본이다. 새로 "이 대상의 이메일"을 읽는 자리를 만들면 `field_type='email'` 을 직접 거르지 말고 `lib/mail/send-address`(규칙)·`server/read-models/send-address`(DB)를 쓸 것.

## 테스트 발송

템플릿 미리보기(`preview.sample`)와 「테스트 발송」(`preview.testSend`)은 설문의 테스트 모드가 켜져 있고 테스트 조사 대상자가 있으면 **첫 테스트 대상자**(`read-models/contact-sample` 의 `getFirstTestTargetSample`)의 값과 초대 링크를 쓴다 — 브라우저가 실데이터를 보는 중이어도 같다. 아니면 그 파티션의 첫 조사 대상 값이고, 테스트 발송의 초대 링크는 견본(`/i/__test__`)이다. **실제 조사 대상의 초대 링크를 테스트 메일에 넣지 말 것.** 수신거부 링크는 늘 견본 토큰이고, 게스트는 테스트 대상자를 쓰지 않는다. 용어·규칙은 CONTEXT.md 「테스트 발송」.

## 회신 전달

보낸 사람 주소(`보낸이 계정@발송 전용 도메인`)로 들어온 메일을 회신 주소로 넘긴다 — 답장을 회신 주소가 아니라 보낸 사람 주소로 보내는 메일 시스템이 있어서다. 용어·규칙은 CONTEXT.md 「회신 전달」. 화면도 회신 기록도 없고, DB 쓰기는 웹훅 장부뿐이다(넘길 메일의 자리 줄과 결과 줄).

- **경로**: 웹훅 라우트가 `email.received` 알림을 `services/reply-forward` 의 `forwardReceivedReply` 로 보낸다(수신자 상태 전이 `resend-webhook` 을 타지 않는다). 순수 규칙은 `domain/reply-forward`, 회신 주소 조회는 `services/reply-address-lookup`, 장부는 `services/reply-forward-ledger`.
- **전달 주소는 DB 에 적힌 회신 주소에서만 나온다.** 받은 메일의 어떤 값(받는 사람·참조·답장 주소·본문)도 전달 주소가 되면 안 된다 — 그러면 누구나 우리 도메인으로 임의 주소에 메일을 보내게 된다. 받은 메일에서 쓰는 것은 「어느 보낸이 계정으로 왔는가」와 「누가 보냈는가」(어느 발송 회차의 회신 주소인지 고르는 재료)뿐이다.
- **찾는 순서**: 보낸이 계정마다 먼저 응답자 주소로(`findReplyAddressByRespondent` — 그 계정 발송 회차 수신자의 발송 스냅샷 주소와 일치하는 것 가운데 가장 최근에 보낸 회차의 회신 주소 **한 곳**, 기간 제한 없음, 회신 주소가 비었거나 발송 전용 도메인인 회차는 건너뜀), 못 찾으면 계정 기준(`loadAccountReplyAddresses` — 최근 1년 회차의 회신 주소 ∪ 그 계정을 쓰는 삭제되지 않은 템플릿의 회신 주소 **전부**, 중복 없이 회차 것이 앞). 회차가 있다고 템플릿을 건너뛰지 말 것 — 같은 계정으로 새 설문의 템플릿을 만들어 「테스트 발송」만 한 단계에서는 그 회신 주소가 어느 회차에도 없다. 응답자 주소 비교에서 SQL 은 후보만 좁히고(`strpos`, 부분 문자열도 걸림) 판정은 발송과 같은 `splitEmailAddresses` 로 칸을 나눠 주소 하나하나와 정확히 한다 — LIKE 로 바꾸거나(`_` 가 와일드카드) 주소 나누기 규칙을 SQL 로 옮기지 말 것.
- **발송 전용 도메인의 주소는 전달 주소가 될 수 없다.** 회신 주소가 빈 옛 회차는 발송 때 보낸 사람 주소를 회신 주소로 썼다 — 그리로 넘기면 메일이 다시 들어와 고리가 된다. 같은 이유로 보낸 사람이 발송 전용 도메인이거나 전달 주소와 같은 도메인이면(회사 메일함 자동응답) 넘기지 않는다.
- **고리 표식**: 전달 메일에 `X-Survey-Reply-Forward` 와 `Auto-Submitted: auto-forwarded` 헤더를 붙인다(`REPLY_FORWARD_HEADERS`). 받은 메일이 그 표식을 달고 있거나 배달 상태 통지(`multipart/report` 의 delivery-status, 보낸 사람이 `mailer-daemon`·`postmaster`)면 넘기지 않는다(`detectForwardLoop`) — 조회 응답의 보낸 사람·헤더로 먼저 보고, 원본을 푼 뒤 한 번 더 본다. 응답자의 부재중 자동응답(`auto-replied`)과 읽음 확인은 넘긴다 — 여기에 넣지 말 것.
- **SDK 의 전달 도우미(`emails.receiving.forward`)를 쓰지 말 것.** 답장 주소와 보낸 사람 이름을 넣지 못해 담당자의 「답장」이 응답자에게 가지 않는다. 원본을 내려받아 `postal-mime` 으로 직접 풀고 발송 API 로 보낸다. 원본은 글자가 아니라 바이트(`arrayBuffer`)로 읽는다.
- **장부 확인과 기록이 한 트랜잭션이 아니다.** 그 사이에 외부 호출(조회·내려받기·발송)이 끼기 때문이다 — 틈은 발송 멱등 키(`reply-forward/<받은 메일 id>`)가 덮는다. 실패는 던져서 500 으로 답하고 장부에 적지 않는다(Resend 재시도가 처음부터 다시 한다). 넘기지 않은 것은 실패가 아니라 200 이다. 「같은 키에 내용이 다르다」 거절은 이미 보낸 것으로 보되 Sentry 경고(`reply_forward_idempotency_mismatch`)를 낸다 — 추정이라 사람이 확인한다. 「같은 알림이 처리 중」 거절(`concurrent_idempotent_requests`)은 장애가 아니라 표식을 달아 던진다(500, Sentry 이벤트 없음).
- **넘기지 않을 메일은 조회 전에 거른다**: 라우트가 알림에 실린 받는 주소·보낸 사람을 넘기고, 서비스는 받은 메일을 조회하기 전에 셋(발송 전용 도메인의 받는 주소 없음 · 보낸 사람이 발송 전용 도메인 · 쓴 적 없는 보낸이 계정)을 걸러 발송 서비스 API 를 한 번도 부르지 않는다. 알림 값은 거르는 데만 쓴다 — 넘길 메일의 판정과 전달 메일의 모양은 조회한 값으로 한다.
- **시간 제한**: 조회·내려받기·발송마다 제한 시간이 있고(`REPLY_FORWARD_STEP_TIMEOUTS_MS` — SDK 가 중단 신호를 받지 않아 바깥에서 건다) 그 합이 웹훅 라우트의 `maxDuration` 안에 든다. 값을 바꾸면 `route-exports.test.ts` 가 대조한다.
- **받은 그대로 못 보내면 첨부 없이 본문과 안내만 넘긴다**(`deliverForwardMail`). 인코딩한 첨부 합계 + 본문이 `FORWARD_SIZE_BUDGET_BYTES`(40MB 에서 여유를 둔 35MB)를 넘으면 처음부터, 한도 안쪽인데 발송 API 가 크기 초과로 거절하면 한 번 더. 다시 해도 결과가 같을 검증 계열 거절(400·422 — 막힌 파일 종류 등, `isPermanentRejection`)도 첨부 없이 한 번 물러나되 안내는 크기를 탓하지 않는다(「첨부 파일을 함께 전달하지 못했습니다」). 그것도 거절되면(또는 뺄 첨부가 없으면) 500 을 되풀이하지 않고 장부에 「넘기지 않음」으로 적고 Sentry 경고(`reply_forward_rejected`, 오류 이름·상태만)를 낸 뒤 200 으로 끝낸다 — 메일은 수신 목록에 남는다. **`isPermanentRejection` 을 넓히지 말 것**: 429·5xx·401·403(403 은 도메인 인증 문제인데 이름이 `validation_error` 다)이 들어가면 한도·설정 문제 동안 온 메일이 재시도 없이 버려진다. 본문 속 이미지도 함께 빠지고 안내의 목록에 든다. 파일 이름은 응답자가 정한 글자라 발송 요청과 안내 양쪽에서 줄바꿈·제어 문자를 걷어내고(비면 대체 이름), 안내에서는 HTML 이스케이프한다. **첨부를 뺀 메일은 멱등 키가 다르다**(`reply-forward/<받은 메일 id>/no-attachments`) — 같은 키로 내용이 다른 요청은 거절된다. 크기 초과 거절의 오류 이름은 발송 서비스 문서에 없어 `isSizeRejection` 이 413 과 「크기를 말하는 검증 오류」 둘을 본다 — 실제 모양을 보면 그 함수 한 곳을 고친다.
- **내용 ID 는 본문 속 이미지에만 넘긴다**(`isInlineImage`): HTML 본문이 있고, 원본 풀기가 본문 속(related) 파트라고 했거나 본문이 그 `cid:` 를 실제로 참조할 때만. 내용 ID 가 붙었을 뿐인 일반 PDF 에 넘기면 받는 쪽 메일 프로그램이 첨부를 감춘다. 안내의 「본문 속 이미지」 표시도 같은 판정이다.
- **장부의 이벤트 종류 칸**: 결과 줄 `email.received:forwarded`(넘김) · `email.received:skipped`(넘기지 않음) — id 가 알림 id 라 「이미 처리한 알림」 판정에 쓰인다. 자리 줄 `email.received:slot` — 시간당 상한이 세는 줄이고 id 는 알림 id 에서 파생한다(`replyForwardSlotId`). 자리 줄을 결과 줄과 같은 id·종류로 합치지 말 것 — 자리만 잡고 실패한 알림이 처리된 알림으로 보여 재시도가 그 메일을 버린다. 배포 전에 온 알림은 기존 경로가 `email.received` 그대로 적는다.
- **시간당 상한**(`REPLY_FORWARD_HOURLY_CAP` 200통): 넘기기로 한 메일만, 원본을 내려받기 **전에** 자리를 잡는다(`reserveForwardSlot`). 짧은 트랜잭션 하나에서 `pg_advisory_xact_lock` 으로 줄을 세우고 최근 한 시간의 자리 줄을 센 뒤 상한 아래면 넣는다 — 세기와 넣기가 한 덩어리라 동시에 몰려도 상한을 넘지 않는다(외부 호출은 이 트랜잭션 밖). 발송 뒤에 적히는 결과 줄을 세는 방식으로 되돌리지 말 것. 같은 알림의 재시도는 자기 자리를 다시 쓰고, 자리는 돌려주지 않는다(발송이 실패해도 한 시간 동안 센다). 못 잡으면 `ReplyForwardCapExceeded` 를 던져 500 으로 답하고 결과 줄을 적지 않는다(Resend 재시도가 뒤로 미룬다). 넘기지 않는 메일은 자리를 잡지 않는다. Sentry 경고는 서비스가 내고 오류에 표식(`markSentryCaptured`)을 달아 라우트가 장애로 또 보내지 않는다.
- **전달 메일의 상태 알림**: 발송 태그 `kind=reply-forward` 로 가려낸다(`hasReplyForwardTag`). `resend-webhook` 은 이 알림을 장부에만 적고 수신자 전이 경로를 타지 않는다 — 발송 회차 집계·메일 비용 집계가 회신 전달로 바뀌면 안 된다(`tests/integration/reply-forward-safeguards.realdb.test.ts` 가 못박는다). `email.bounced`·`email.failed`·`email.suppressed`·`email.complained` 는 Sentry 경고(`operation: reply_forward_bounce`, 종류는 태그 `eventType`)이고 나머지는 조용히 지나간다 — 한 번 반송된 회신 주소는 그 뒤로 반송이 아니라 `suppressed` 로만 알려 온다. 전달 메일의 `kind` 태그를 빼거나 값을 바꾸면 이 분기가 죽는다.
- **로그·오류 문구·Sentry 에 주소·이름·제목·본문·파일 이름을 싣지 않는다.** 발송 서비스가 돌려준 오류 문구도 주소를 담을 수 있어 분류값(`error.name`·상태 코드)만 옮긴다. 웹훅 라우트가 서비스에 넘기는 받는 주소·보낸 사람도 로그에는 싣지 않는다(식별자만). 원본 내려받기 주소는 서명된 URL 이라 그 요청만 `Sentry.suppressTracing` 안에서 보낸다 — Sentry 는 나가는 요청의 쿼리를 breadcrumb·span 에 싣고 기본 가림 목록에 서명 칸(`X-Amz-Signature`)이 없다.
- **배포**: 마이그레이션·Inngest Resync 없음. 앱 배포 뒤 Resend 웹훅 구독에 `email.received` 를 더하고, `email.failed`·`email.suppressed`·`email.complained` 가 구독에 들어 있는지 본다(전달 메일이 닿지 못했다는 경고의 재료).
