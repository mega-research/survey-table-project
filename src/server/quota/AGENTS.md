# 쿼터

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 쿼터

`surveys.quota_config` (JSONB, NULL = 쿼터 없음) + `features/operations/quota` + `lib/quota/`.

- 차원 × 카테고리 조합 셀에 목표치를 둔다. 셀은 sparse — 목표가 있는 조합만. 차원 유형은 넷(`QUOTA_DIMENSION_KINDS`): 문항 바인딩 `choice`(보기값)·`numeric`(구간)·`text`(키워드 포함), 그리고 명단 attrs 열 바인딩 `attr`(값 완전 일치, `questionId` 는 빈 문자열). JSONB 라 마이그레이션 없음.
- **분류 입력은 응답값이 아니라 판정 대상 `QuotaSubject`(응답값 + 조사 대상 attrs)다.** attrs 는 서버가 응답 행의 `contactTargetId` 로 읽은 값만 싣는다 — 클라이언트 입력 금지. 모수 로더 `loadCompletedQuotaSubjects` 는 `needsContactAttrs(config)` 일 때만 조사 대상을 한 번 더 읽는다. 집행·완료 시점 초과 감지·현황판 셋이 같은 `deriveCategoryIds` 를 쓴다.
- **텍스트형**: 표 문항이면 `cellIds` 의 input 칸들, 단답형이면 응답 문자열 하나를 본다. 칸별로 공백 제거·소문자화 후 키워드 포함(카테고리 안 OR, 칸은 이어 붙이지 않는다). `isElse` 카테고리(「그 외」)는 놓인 자리와 무관하게 키워드가 전부 빗나간 뒤에만 받고, 대상 칸이 전부 비면 미분류다. 오탈자는 「그 외」로 들어가 미분류 수로는 안 보인다.
- **미분류**(차원 하나라도 카테고리 없음)는 쿼터에 걸리지 않고 통과한다. 속성형에서는 익명 응답이 항상 미분류라 `requireInviteToken` 을 켜는 것이 관례다(편집 화면이 경고, 코드 강제 없음). 현황판 요약 `unclassified` 가 그 수를 보인다.
- **쿼터 게이트**(`lib/quota/quota-gate-build.ts` → `Survey.quotaGate`): 속성형은 게이트 문항을 만들지 않는다. 텍스트형 표 문항은 `cellIdsByQuestion` 의 대상 칸에 값이 있어야 "답변됨"이다 — 표 응답은 다른 칸만 채워도 객체가 생겨, 객체 존재로 판정하면 응답당 1회뿐인 확인이 주소를 적기 전에 소진된다. 문항 기반 차원이 없는 플랜은 `checkWithoutQuestions` 로 첫 전환에서 확인한다.
- `enabled=false`면 정의·집계만 하고 응답자를 차단하지 않는다. 마감 차단 시 응답 status는 `quotaful_out`.
- **publish 없이 즉시 반영되는 라이브 컬럼** (`isPaused`/`pausedMessage`와 동일 취급).
- 실시간 달성률은 완료 응답 기준 — `docs/adr/0002-quota-realtime-from-completed-answers.md`.
- **쿼터마감 다시 열기** (2026-10-22, CONTEXT.md 「쿼터마감 다시 열기」): `quotaful_out` 응답자가 같은 링크로 다시 들어오면 그 응답의 셀에 지금 자리가 있을 때(목표 증가·쿼터 끔·셀 소멸) 마감을 풀고 남긴 답으로 이어 간다 — `quotaful_out → drop → in_progress`, 답 보존, `metadata.quotaReopenedAt` 표식. 판정은 입장 판정과 같은 사슬(`read-models/quota-cell`)이고 `server/survey-response/services/quota-reopen.ts` 의 `reopenQuotaClosedResponse` 하나를 재개(`resumeOrCreateResponse` — 설문이 응답을 받는 중일 때만)와 첫 답 저장(`settleReuseCandidate`)이 부른다. 자리를 예약하지 않으므로 초과는 페이지 재확인·제출 하드 차단이 막는다. 테스트 응답 제외. 마이그레이션 없음. 실DB 테스트 `tests/integration/quota-closed-reopen.realdb.test.ts`.
- **「진행 중 마감」** (`midSurveyClose`, 기본 꺼짐 — ADR 0025, CONTEXT.md 「진행 중 마감」): 셀 완료 수가 목표를 넘으면 안 되는 조사(완료자 전원 사례 지급)용. 켜면 두 가지가 바뀐다.
  - **제출 시점 하드 차단(유일한 강제 지점)** — `completeResponse` 가 트랜잭션 첫 문장으로 셀 advisory lock 을 잡고(응답 행 잠금보다 **먼저** — 교착 방지) 잠금 아래에서 셀 완료 수를 다시 센다. 목표 이상이면 답은 저장하되 `quotaful_out`, 결과 `{ kind: 'quota_closed' }`. 빈 complete 도 판정한다. 잠금 사이 셀이 바뀌는 경합·fail-closed 는 CONTEXT.md 「진행 중 마감」, 경합 테스트는 `complete-response-quota-hard-close.realdb.test.ts`.
  - **페이지마다 백그라운드 재확인** — 게이트에 `recheckOnEachStep` 이 실리고(집행 중 + 옵션 켜짐, `buildQuotaGate`), 응답 화면은 첫 판정(기다림) 이후의 모든 「다음」에서 `quota.check` 를 기다리지 않고 발사한다. blocked 면 마감 화면으로 갈아 끼우고, 실패·429 는 통과, 마지막 「제출」에서는 보내지 않는다(제출이 판정을 받는다). 제출 뒤 도착한 늦은 결과는 버린다. `checkQuota` 는 그래서 **재호출 멱등**이다 — `quotaful_out` 이면 모수를 세지 않고 blocked, 그 밖의 종결 상태면 아무것도 안 한다. 알림 속도를 위한 것이라 빠져도 불변식은 깨지지 않는다.
  - **문구 구분**: 입장 판정에서 막힘 = `closedMessage`, 입장 뒤 막힘 = `midSurveyClosedMessage`(비면 `closedMessage`, 둘 다 비면 사과 톤 상수 `QUOTA_MID_SURVEY_CLOSED_FALLBACK`). 폴백 사슬·상수·본문 헬퍼 `midSurveyClosedBody` 는 `lib/quota/closed-message.ts` 한 곳이고 응답 화면·편집 화면 미리보기가 같이 쓴다(기존 `QUOTA_CLOSED_FALLBACK` 의 값 복제 관례와 다르다 — 이번엔 양쪽이 이미 그 lib 을 import 한다). `quota.check` 결과는 둘 다 싣되 어느 단계인지는 클라이언트가 안다.
  - **면제**: 운영자가 만드는 완료 — 관리자 응답 수정의 이탈→완료(`saveAdminEdit`)와 재응답 허용으로 되돌려진 응답(`metadata.reeditPendingSince`)의 재제출 — 는 차단하지 않고(`checkQuota` 의 입장·재확인 판정도 같은 표식으로 면제 — 없으면 되돌린 응답이 첫 「다음」에서 곧장 쿼터마감으로 떨어진다) 기존 초과 표식 `metadata.quotaOverflow` 만 남긴다(재응답 표식은 재제출 뒤에도 남지만 완료 행은 재응답 허용으로만 다시 열린다). 미분류·목표 없는 셀·테스트 응답은 종전대로 통과.
  - **꺼진 설문의 제출 경로는 종전과 같다** — 잠금 없음, 동시 제출 초과는 표식만(2026-08-11 정책). 자리 예약(진행중 응답을 셀 인원으로 세기)·일시 만원 화면은 검토 후 미채택이라 구현에 없다.
  - 부하 메모: 재확인마다 완료 응답 전체를 읽어 센다. 완료 수천 건 설문에서 켜면 부하가 되니 그때 셀 카운트 질의로 바꾼다. 레이트리밋 `quota-check` 는 응답당 30·IP 당 300/분 그대로다 — 호출이 응답당 1회에서 페이지마다로 늘었으니 대형 공용 IP(콜센터급)에서 켜면 429 fail-open 이 늘 수 있다(불변식은 제출 판정이 지킨다).
