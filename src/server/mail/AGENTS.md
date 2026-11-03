# 메일 발송

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 발송 주소 · 대체 발송

**메일 발송 주소 · 대체 발송** (0135·0137): 이메일 열이 여럿일 때의 발송 주소 순서(`mailOrder`)와 반송·거부 시 다음 순위 주소로 한 통 더 보내는 대체 회차(`kind='fallback'`, cron `mailFallbackSweeper` — 새 Inngest 함수라 배포 뒤 수동 Resync)는 CONTEXT.md 「발송 주소」가 정본이다. 새로 "이 대상의 이메일"을 읽는 자리를 만들면 `field_type='email'` 을 직접 거르지 말고 `lib/mail/send-address`(규칙)·`server/read-models/send-address`(DB)를 쓸 것.
