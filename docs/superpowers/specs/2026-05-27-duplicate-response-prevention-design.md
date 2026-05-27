# 중복 응답 차단 설계 (Duplicate Response Prevention)

- 작성일: 2026-05-27
- 작성자: 브레인스토밍 세션 결과
- 상태: 디자인 확정, 구현 대기

## 1. Context & Problem

현재 설문 응답 시스템은 동일인의 중복 응답을 사실상 차단하지 못한다.

- `survey_responses.sessionId` UNIQUE 제약만 존재. 쿠키/스토리지 삭제로 즉시 무력화.
- `surveys.allowMultipleResponses` 필드는 스키마에 정의되어 있으나 enforcing 코드가 없다.
- `contact_targets.respondedAt` 은 응답 완료 후처리에서만 세팅. 진입 시점 가드 없음 → 같은 invite token으로 무한 재응답 가능.

공공 설문 운영자가 데이터 신뢰성을 확보하려면 다음이 필요하다.

1. invite token이 있는 경우: 토큰 1장당 1응답.
2. invite token이 없는 경우(공개·비공개 링크): "동일인" 의심 시 응답 차단.

동시에 IP는 한국 개인정보보호법(PIPA)상 단독으로 개인정보로 분류되므로, raw로 영구 저장하지 않는 방식이 필요하다.

## 2. Goals & Non-Goals

### Goals

- 동일 invite token 재응답 hard block (진입 시점, server-rendered).
- 공개/비공개 링크에서 다중 신호 기반 동일인 판정 후 hard block.
- raw IP를 DB에 영구 저장하지 않는다. salted hash만 영구 저장.
- 사무실/학교 NAT 환경에서 무고한 사용자를 차단하지 않는다(보강된 알고리즘).
- **진행 중(미완료) 응답은 차단 근거로 보지 않는다.** 응답자가 탭 닫고 돌아와도 재진입·재시도 가능. 완료된 응답(completed_at)만 차단.
- 미래 "응답 삭제·복구" 기능을 위한 hook(`deleted_at` 컬럼 + 알고리즘 조건)을 함께 박는다.

### Non-Goals

- **응답자 동의 UI 자동 추가 X.** admin이 `notice` 질문 타입(기존 기능)으로 직접 배치.
- **삭제·복구·오버라이드 UI 자체는 이 spec 범위 밖.** 별도 spec에서 다룬다. 본 spec은 hook만 박는다.
- **canvas/audio fingerprint 같은 정밀 추적 신호는 사용하지 않는다.** PIPA에서 회색지대.
- **rate limiting / CAPTCHA 같은 봇·DoS 방어는 이 spec 범위 밖.**
- **기존 응답에 대한 소급 차단 X.** 백필되지 않은 신호 컬럼이 NULL이라 비교 불가 — 정상 동작으로 간주.

## 3. Architecture Overview

```
응답자 진입 GET /survey/[id]?invite=...
    │
    ├─ page.tsx (server component)
    │   └─ Track A: invite token 있는 경우만 즉시 검사
    │       ├─ token invalid             → <InvalidTokenView> server-rendered
    │       ├─ token + respondedAt 존재  → <AlreadyRespondedView> server-rendered
    │       └─ 통과                       → 아래로
    │
    └─ <SurveyResponseClient> (client component) 마운트
            │
            ├─ useEffect on mount:
            │   1. 클라이언트 신호 수집 (deviceId, screen, tz, lang, platform)
            │   2. server action checkDuplicateOnEntry({ surveyId, signals })
            │   3. 그동안 "확인 중..." 오버레이 표시 (200–500ms 예상)
            │
            ├─ blocked: true  → <AlreadyRespondedView> 상태 전환 (같은 URL, redirect X)
            │                   surveys.contact_email 기반 mailto 링크
            │
            └─ blocked: false → 정상 응답 진행
                                signals를 useRef에 보관
                                → 첫 답변 시 createResponseWithFirstAnswer 인자로 전달
                                → server 측에서 동일 checkDuplicate() 재실행 (이중 안전망 / 위조 방어)
```

## 4. Data Model

### 4.1 `survey_responses` 변경

**제거**:
- `ipAddress text` — raw IP는 더 이상 저장하지 않는다.

**추가**:
| 컬럼 | 타입 | NULL | 용도 |
|------|------|------|------|
| `ip_hash` | `text` | YES | `sha256(ip + APP_SECRET_SALT)`. 중복 판정에 사용 |
| `fp_hash` | `text` | YES | `sha256(UA + screen + tz + lang + platform + salt)`. 강한 신호 |
| `device_id` | `text` | YES | LocalStorage UUID. 가장 끈질긴 신호 |
| `deleted_at` | `timestamptz` | YES | 미래 soft delete hook. 본 spec에선 항상 NULL |

**유지 (평문)**: `userAgent`, `platform`, `browser`, `sessionId`. admin 화면 표시(PC/Chrome 등)에 필요. UA 단독은 PIPA 직접 식별 X.

**인덱스 신규** (partial index — 완료된 응답만 lookup 대상):
- `idx_responses_survey_device ON (survey_id, device_id) WHERE device_id IS NOT NULL AND completed_at IS NOT NULL AND deleted_at IS NULL`
- `idx_responses_survey_fpip   ON (survey_id, fp_hash, ip_hash) WHERE fp_hash IS NOT NULL AND ip_hash IS NOT NULL AND completed_at IS NOT NULL AND deleted_at IS NULL`

### 4.2 `surveys` 변경

**추가**:
| 컬럼 | 타입 | NULL | 용도 |
|------|------|------|------|
| `contact_email` | `text` | YES | 차단 페이지 mailto 링크. NULL이면 링크 표시 안 함 |

### 4.3 `contact_targets` 변경

없음. 기존 `respondedAt`, `responseId` 그대로 사용.

## 5. Client Signal Collection

**위치**: `src/hooks/use-client-signals.ts` (신규).

**수집 항목**:
```ts
interface ClientSignals {
  deviceId: string | null;  // LocalStorage UUID. 차단 시 null
  screen: string;            // "1920x1080"
  dpr: number;               // window.devicePixelRatio
  tz: string;                // "Asia/Seoul"
  lang: string;              // "ko-KR"
  platform: string;          // navigator.platform
}
```

**deviceId 관리**:
- key: `"__sd_device_id"` (LocalStorage)
- 없으면 `crypto.randomUUID()` 생성·저장
- LocalStorage 차단 시 try/catch로 잡고 `null` 반환 — 알고리즘이 fallback

**전송**:
- 별도 API 호출 추가하지 않음.
- 진입 시점에 한 번: `checkDuplicateOnEntry` server action 호출
- 첫 답변 시점에 한 번: `createResponseWithFirstAnswer` 인자로 함께 전송

## 6. Server-side Signal Processing

**위치**: `src/lib/duplicate-detection/signals.ts` (신규).

```ts
import { createHash } from "node:crypto";
import { headers } from "next/headers";

const SALT = process.env.DUPLICATE_DETECTION_SALT;
if (!SALT) throw new Error("DUPLICATE_DETECTION_SALT not set");

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function extractIp(h: Headers): string | null {
  const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff ?? h.get("x-real-ip") ?? null;
}

export interface ServerSignals {
  ipHash: string | null;
  fpHash: string | null;
  deviceId: string | null;
}

export function computeSignals(
  h: Headers,
  client: ClientSignals,
): ServerSignals {
  const ip = extractIp(h);
  const ua = h.get("user-agent") ?? "";

  const fpInput = [
    ua,
    client.screen,
    client.tz,
    client.lang,
    client.platform,
  ].join("|");

  return {
    ipHash: ip ? sha256(ip + SALT) : null,
    fpHash: sha256(fpInput + SALT),
    deviceId: client.deviceId, // 그대로 (이미 UUID)
  };
}
```

**Salt 관리**:
- env: `DUPLICATE_DETECTION_SALT` (신규 필수 env var)
- 한 번 정해지면 절대 회전 X. 회전하면 기존 hash가 무용지물.
- env 누락 시 서버 부팅 실패 (fail-fast).

## 7. Duplicate Detection Algorithm

**위치**: `src/lib/duplicate-detection/check.ts` (신규).

### 7.1 Track A: invite token 있음

```ts
async function checkTrackA(inviteToken: string) {
  const contact = await findContactByInviteToken(inviteToken);
  if (!contact) return { blocked: true, reason: "invalid_token" as const };
  if (contact.respondedAt) {
    return { blocked: true, reason: "token_already_used" as const };
  }
  return { blocked: false, contactTargetId: contact.id };
}
```

### 7.2 Track B: 공개/비공개 (token 없음) — NAT 보호 룰 포함

```ts
async function checkTrackB({ surveyId, signals }: {
  surveyId: string;
  signals: ServerSignals;
}) {
  // 룰: deleted_at IS NULL AND completed_at IS NOT NULL AND (조건1 OR 조건2)
  //   완료된 응답만 차단 근거. 진행 중(미완료) 응답은 무시 (재진입 가능)
  //   조건1: R.device_id == signals.deviceId (둘 다 NULL 아님)
  //   조건2: R.fp_hash == signals.fpHash
  //          AND R.ip_hash == signals.ipHash
  //          AND (R.device_id IS NULL OR signals.deviceId IS NULL
  //               OR R.device_id == signals.deviceId)
  
  const cond1 = signals.deviceId
    ? eq(surveyResponses.deviceId, signals.deviceId)
    : sql`false`;
  
  // signals.deviceId가 NULL이면 row 측 deviceId는 무관 (sql`true`)
  // signals.deviceId가 값이 있으면: row.deviceId가 NULL이거나 같은 값일 때만 매칭
  const deviceConstraint = signals.deviceId == null
    ? sql`true`
    : or(isNull(surveyResponses.deviceId), eq(surveyResponses.deviceId, signals.deviceId));
  
  const cond2 = and(
    signals.fpHash ? eq(surveyResponses.fpHash, signals.fpHash) : sql`false`,
    signals.ipHash ? eq(surveyResponses.ipHash, signals.ipHash) : sql`false`,
    deviceConstraint,
  );
  
  const existing = await db.query.surveyResponses.findFirst({
    where: and(
      eq(surveyResponses.surveyId, surveyId),
      isNull(surveyResponses.deletedAt),
      isNotNull(surveyResponses.completedAt),
      or(cond1, cond2),
    ),
  });
  
  if (existing) {
    return { blocked: true, reason: "device_already_responded" as const };
  }
  return { blocked: false };
}
```

### 7.3 알고리즘 검증 케이스

| 시나리오 | 결과 | 근거 |
|----------|------|------|
| 같은 사람, 같은 기기 재진입 | 차단 | 조건 1 (deviceId 일치) |
| 같은 사람, 시크릿 모드(deviceId=NULL) 재진입 | 차단 | 조건 2 (fp+ip 일치 + deviceId 한 쪽 NULL) |
| 사무실 NAT, 같은 PC 모델 2명 (각자 deviceId 있음, 다름) | 통과 | 조건 1 X, 조건 2 마지막 AND 절 실패 |
| 같은 사람, IP만 바뀜 (셀룰러↔WiFi) | 차단 | 조건 1 (deviceId 살아있는 한) |
| 같은 사람, 시크릿 + IP 변경 동시 | 통과 (수용된 우회) | deviceId NULL + ip 다름 → 조건 2 ip 불일치 |
| 삭제된 응답이 존재하는 같은 사람 | 통과 | deleted_at IS NULL 조건에서 제외 |
| **진행 중(미완료) 응답만 존재하는 같은 사람 재진입** | **통과** | **completed_at IS NOT NULL 조건에서 제외 — 재시도 가능** |
| 같은 사람, 완료 응답 1건 + 미완료 진입 시도 | 차단 | 완료 응답이 차단 근거 |

## 8. Integration Points

### 8.1 진입 시점 가드 (Track A)

**파일**: `src/app/survey/[id]/page.tsx`

기존 `requireInviteToken` / `lookupContactAttrs` 호출 흐름에 `respondedAt` 체크 추가:
- inviteToken이 있을 때 contact lookup 후 `respondedAt != null`이면 `<AlreadyRespondedView>` 즉시 렌더 (server-rendered).
- 기존 `resumeOrCreateResponse` 호출은 통과 후에만 실행.

### 8.2 진입 시점 가드 (Track B)

**신규 server action**: `checkDuplicateOnEntry({ surveyId, signals })`

**파일**: `src/actions/duplicate-detection-actions.ts` (신규).

**클라이언트 호출 위치**: `<SurveyResponseClient>` mount useEffect.

**반환값**:
```ts
type CheckResult =
  | { blocked: false }
  | { blocked: true; reason: "device_already_responded" | "invalid_token" | "token_already_used" };
```

### 8.3 첫 답변 시점 재검증

**파일**: `src/actions/response-actions.ts:113-195` (`createResponseWithFirstAnswer`)

**변경**:
- 시그니처에 `clientSignals: ClientSignals` 추가.
- 함수 진입 직후 `computeSignals(headers(), clientSignals)` 호출.
- Track A 또는 Track B 검사 재실행 (위조 방어).
- 차단 시: `{ kind: "blocked", reason } as const` 반환 → 클라이언트가 `<AlreadyRespondedView>` 전환.
- 통과 시: 기존 INSERT 로직에 `ip_hash`, `fp_hash`, `device_id` 함께 저장.

### 8.4 createBlankResponse 처리

**파일**: `src/actions/response-actions.ts:230-234`

동일 패턴 적용 (시그니처에 `clientSignals` 추가 + 검사). 또는 사용 사례가 거의 없다면 deprecate. 구현 단계에서 사용처 확인 후 결정.

### 8.5 차단 페이지 UX

**컴포넌트**: `<AlreadyRespondedView>` (신규, `src/components/survey/already-responded-view.tsx`).

표시 내용:
- 메시지: 차단 사유별 (`invalid_token` / `token_already_used` / `device_already_responded`)
- `surveys.contact_email` 있으면 mailto 링크
- 설문 제목, 운영기관(있다면)

## 9. Privacy & Compliance (PIPA)

| 항목 | 처리 |
|------|------|
| 수집 정보 | IP(hash로만 저장), UA(평문), 화면/시간대/언어/플랫폼(fingerprint hash로만 저장), LocalStorage UUID |
| 수집 목적 | 중복 응답 방지 |
| 보유 기간 | 응답 데이터와 동일 (영구). 응답 삭제 시 함께 삭제 |
| 동의 절차 | admin이 설문 빌더에서 `notice` 질문 타입으로 직접 안내문 배치 (시스템 자동 추가 X) |
| 제3자 제공 | 없음 |
| 처리방침 명시 | 플랫폼 차원의 처리방침에 "중복응답 방지 목적 신호 해시 저장" 명시 (별도 작업) |

**raw IP 비저장 근거**:
- IP는 PIPA상 단독 개인정보. hash로만 저장하면 가명정보로 분류되어 유출 시 위험 ↓.
- 부정 응답 신고 등 raw IP가 필요한 시나리오는 발견 시 별도 spec으로 검토.

## 10. Migration Strategy

### 10.1 마이그레이션 (Supabase MCP `apply_migration` 사용)

[feedback_drizzle_migrate_journal](memory) 기준으로 Supabase MCP 또는 직접 SQL 패턴 사용. `pnpm db:push`는 `_journal.json`만 따라가므로 silent skip 위험.

마이그레이션 단계:
1. `survey_responses` ALTER TABLE: `ip_hash text`, `fp_hash text`, `device_id text`, `deleted_at timestamptz` 추가
2. `surveys` ALTER TABLE: `contact_email text` 추가
3. 인덱스 2개 생성
4. (백필) UPDATE: `ip_hash = encode(digest(ip_address || :salt, 'sha256'), 'hex') WHERE ip_address IS NOT NULL`
   - 주의: pgcrypto extension 필요. `CREATE EXTENSION IF NOT EXISTS pgcrypto;` 선행
   - salt는 마이그레이션 실행 시 env에서 주입 (Supabase MCP에 직접 박지 말 것)
5. `survey_responses` ALTER TABLE: `DROP COLUMN ip_address`
6. Drizzle schema 파일 동기화 (`src/db/schema/surveys.ts`)

### 10.2 코드 변경 순서

1. env var `DUPLICATE_DETECTION_SALT` 추가 + 검증 코드
2. Drizzle schema 갱신
3. 마이그레이션 실행
4. `lib/duplicate-detection/` 신규 모듈 (signals, check)
5. `hooks/use-client-signals.ts`
6. `actions/duplicate-detection-actions.ts`
7. `actions/response-actions.ts` 기존 함수 시그니처 변경
8. `app/survey/[id]/page.tsx` Track A 가드 + 클라이언트 컴포넌트 진입
9. `components/survey/already-responded-view.tsx`
10. admin 빌더에 `contact_email` 입력 필드 추가 (설문 설정 모달)
11. admin profiles 테이블의 "접속IP" 컬럼 제거 또는 "기기 식별" 텍스트로 변경
12. 테스트 작성

[feedback_survey_save_explicit_fields](memory) — `survey-save-actions.ts`에 `contact_email` 명시적 추가 필요.

## 11. Edge Cases

| 케이스 | 동작 | 비고 |
|--------|------|------|
| LocalStorage 차단 브라우저 | deviceId=NULL, fp+ip만으로 매칭 | 정상 fallback |
| JS 비활성화 | 신호 0, 클라이언트 검사 skip → 통과 | 명시적 trade-off 수용 (<0.5%) |
| Tor/VPN (IP 변동) | deviceId만 매칭 신호. 시크릿 동시면 우회 | 수용 |
| 사무실 NAT 같은 PC 모델 다수 | 보강 알고리즘으로 통과 | 검증 완료 |
| 응답 중 새로고침 | 기존 `sessionId` UNIQUE + `resumeOrCreateResponse`로 resume | 변경 없음 |
| 응답 중 탭 닫음 → 다른 브라우저로 재진입 | 통과 (미완료 응답은 차단 근거 X). 새 응답 생성 → 같은 사람의 미완료 응답 누적 가능 | 데이터 정합성 부담은 작음 (미완료라 통계에서 자동 제외). deviceId 기반 resume은 Future Work |
| 신호 위조 (클라이언트가 신호 빈 값 전송) | 진입 시 통과되어도 createResponseWithFirstAnswer에서 다시 검사 | 이중 안전망 |
| 진입 검사 server action 자체를 우회 (createResponseWithFirstAnswer 직접 호출) | 첫 답변 시점에 차단 | 이중 안전망 |
| 응답 진입 → 검사 도중 네트워크 실패 | 클라이언트는 첫 답변 시까지 통과 가정. 첫 답변에서 차단되면 그때 차단 페이지 전환 | 트레이드오프: 1차 검사는 best-effort |
| `surveys.contact_email` NULL | 차단 페이지에 mailto 링크 미표시. 메시지만 표시 | |
| 기존 응답(백필된 ip_hash만 있음)이 새 응답 차단 근거가 될 수 있는가 | NO. 조건 2의 fp_hash 비교 실패 → 매칭 안 됨 | 정상 |

## 12. Testing Strategy

[feedback_vitest_tests_dir_only](memory) — `tests/` 디렉토리만 vitest include. `src/` 옆 *.test.ts는 silent skip.

### 12.1 단위 테스트 (`tests/unit/duplicate-detection/`)

- `signals.test.ts`
  - `computeSignals` 결정성: 같은 입력 → 같은 hash
  - `extractIp` 우선순위: `x-forwarded-for` 우선, 다중 IP 시 첫 번째
  - salt 누락 시 부팅 실패 검증 (별도 부트 테스트)
- `check.test.ts`
  - 알고리즘 케이스 매트릭스 (§7.3 표 각 행마다 1 케이스)

### 12.2 통합 테스트 (`tests/integration/`)

[feedback_survey_save_explicit_fields](memory) 패턴 따르기.

- `track-a-invite-block.test.ts` — 토큰 사용 후 재진입 시 server action이 `token_already_used` 반환
- `track-b-device-block.test.ts` — 같은 deviceId 재응답 차단
- `track-b-secret-mode-block.test.ts` — 시크릿 모드 (deviceId=NULL) 재응답 시 fp+ip로 차단
- `track-b-nat-safe.test.ts` — 같은 fp+ip + 다른 deviceId 통과 (NAT 환경)
- `track-b-bypass-defense.test.ts` — checkDuplicateOnEntry 호출 없이 createResponseWithFirstAnswer 직접 호출 → 차단
- `soft-delete-hook.test.ts` — deleted_at IS NOT NULL 응답은 차단 근거에서 제외

## 13. Future Work

본 spec 범위 밖. 별도 spec으로 진행.

- **응답 삭제·복구·수정 UI** (admin 응답 내역)
  - soft delete: `deleted_at` 세팅 + 통계 쿼리에서 제외
  - Track A 응답 삭제 시 `contact_targets.respondedAt`, `responseId` reset
  - 복구 시 새 응답이 있는 경우 처리 (a/b/c 옵션 — 본 디자인 §B 참조)
  - audit log
- **rate limiting** (IP/세션 기반 분당 응답 횟수)
- **부정 응답 신고** 기능 시 raw IP 단기 보관 hybrid 검토
- **deviceId 기반 resume** — 진행 중 응답이 있는 같은 기기 재진입 시 sessionId가 달라도 이전 응답 이어서 작성. 현재 동작은 새 미완료 응답을 별도로 생성 (sessionId 기반 resume만 동작). admin 응답 내역에 미완료 행이 누적될 수 있는 정합성 이슈를 해결

## 14. Open Questions / Trade-offs

### 결정 완료
- ~~차단 강도~~ → Hard block 채택
- ~~신호 조합~~ → deviceId + (UA fp + IP) 표준 채택
- ~~Raw IP 보관~~ → hash만 영구 저장 채택
- ~~동의 UX~~ → admin이 `notice` 질문으로 직접 배치 채택
- ~~삭제 hook~~ → 포함 채택

### 명시적으로 수용된 트레이드오프
- JS off 사용자(<0.5%)는 차단 우회 가능 → 수용
- Tor/VPN + 시크릿 동시 사용 시 우회 가능 → 수용
- 진입 시점 검사는 클라이언트 호출이므로 우회 가능 → 첫 답변 server action 재검증으로 보완
- 진입 시 "확인 중..." 200-500ms 오버레이 노출 → 수용 (UX 비용 < 보안 이득)

### 구현 단계에서 결정
- admin 응답 내역 화면 "접속IP" 컬럼을 제거할지, "기기 식별" 같은 추상 표시로 바꿀지
- `createBlankResponse` deprecate 여부 (사용처 확인 후)
- 차단 페이지 디자인 시각적 톤 (현재 [feedback_brainstorming_design_guide](memory) 기준으로 디자인 시스템 토큰 적용)
