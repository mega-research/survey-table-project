# Duplicate Response Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 응답자(invite_token 또는 device+IP 신호 매칭)의 중복 응답을 hard block하고 raw IP를 DB에서 제거한다.

**Architecture:** Two-track 검사 — Track A(invite_token)는 token + `contact_targets.respondedAt` 체크, Track B(공개·비공개 링크)는 deviceId + (UA fingerprint + IP) hash 다중 신호 매칭. 응답 페이지가 이미 `'use client'`라 두 트랙 모두 단일 server action(`checkDuplicateOnEntry`)으로 통합 — mount 직후 호출 + 첫 답변 server action 재검증(이중 안전망). raw IP는 salted sha256 hash로만 영구 저장. 진행 중(`completed_at IS NULL`) 응답은 차단 근거에서 제외.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, Postgres (Supabase), TypeScript strict, vitest, node:crypto, React server actions, TanStack Query.

**Spec:** [docs/superpowers/specs/2026-05-27-duplicate-response-prevention-design.md](../specs/2026-05-27-duplicate-response-prevention-design.md)

---

## File Map

새로 만들 파일:
- `src/lib/duplicate-detection/signals.ts` — 서버 측 hash 생성, IP 추출, salt 검증
- `src/lib/duplicate-detection/check.ts` — Track A/B 알고리즘
- `src/lib/duplicate-detection/types.ts` — 공유 타입 (ClientSignals, ServerSignals, CheckResult)
- `src/actions/duplicate-detection-actions.ts` — `checkDuplicateOnEntry` server action
- `src/hooks/use-client-signals.ts` — LocalStorage UUID + 브라우저 신호 수집 hook
- `src/components/survey/already-responded-view.tsx` — 차단 페이지 UI
- `tests/unit/duplicate-detection/signals.test.ts`
- `tests/unit/duplicate-detection/check.test.ts`
- `tests/integration/duplicate-track-a-invite-block.test.ts`
- `tests/integration/duplicate-track-b-device-block.test.ts`
- `tests/integration/duplicate-track-b-secret-mode-block.test.ts`
- `tests/integration/duplicate-track-b-nat-safe.test.ts`
- `tests/integration/duplicate-track-b-bypass-defense.test.ts`
- `tests/integration/duplicate-completed-only.test.ts`
- `tests/integration/duplicate-soft-delete-hook.test.ts`
- `drizzle/migrations/<n>_add_duplicate_detection.sql` (Supabase MCP `apply_migration` 사용)

수정할 파일:
- `.env.example` — `DUPLICATE_DETECTION_SALT` 추가
- `src/db/schema/surveys.ts` (line 158-208) — 컬럼 추가/제거, line 17-45 surveys에 contact_email
- `src/actions/response-actions.ts` (line 113-218) — 시그니처 변경, INSERT 필드, 차단 분기
- `src/app/survey/[id]/page.tsx` (line 127 이후) — mount useEffect에서 checkDuplicateOnEntry 호출 + 차단 UI 전환 + signals 보관
- `src/components/survey-builder/survey-settings-panel.tsx` — contact_email 입력 필드
- `src/actions/survey-save-actions.ts` — explicit field set에 contact_email 추가 (memory: feedback_survey_save_explicit_fields)
- `src/components/operations/profiles/profiles-table.tsx` (line 129) — 접속IP 컬럼 제거
- `src/lib/operations/profiles.server.ts` (line 10, 25) — ipMasked 필드 제거

---

## Pre-flight checks (실행 전 1회)

- [ ] **현재 브랜치 확인** — `feat/duplicate-response-prevention` 브랜치에서 작업 중인지 확인

```bash
git branch --show-current
```

Expected: `feat/duplicate-response-prevention`

- [ ] **테스트 환경 동작 확인** — 기존 통합 테스트가 도는지 한 번 검증

```bash
pnpm vitest run --reporter=dot tests/integration/unsubscribe-no-get-mutation.test.ts
```

Expected: 통과. 실패하면 환경 setup 점검 (DB URL, env 변수).

---

## Task 1: 환경 변수 추가

**Files:**
- Modify: `.env.example` (root)
- Modify: `.env.local` (사용자 로컬 — 가이드만, 직접 편집은 사용자)

- [ ] **Step 1.1: .env.example에 변수 추가**

`.env.example` 끝에 추가:

```env

# Duplicate Detection — 한 번 정하면 절대 회전하지 말 것 (회전 시 기존 hash 무용지물)
DUPLICATE_DETECTION_SALT=
```

- [ ] **Step 1.2: 사용자에게 .env.local 설정 안내**

사용자에게 다음 명령으로 32바이트 random salt를 생성·복사하라고 안내:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

생성된 hex 문자열을 `.env.local`의 `DUPLICATE_DETECTION_SALT=<value>` 에 붙여넣는다. 사용자 확인 후 다음 step 진행.

- [ ] **Step 1.3: Commit**

```bash
git add .env.example
git commit -m "feat: DUPLICATE_DETECTION_SALT 환경 변수 추가"
```

---

## Task 2: 공유 타입 정의

**Files:**
- Create: `src/lib/duplicate-detection/types.ts`

- [ ] **Step 2.1: 타입 파일 작성**

```ts
// src/lib/duplicate-detection/types.ts

export interface ClientSignals {
  /** LocalStorage UUID. null이면 storage 차단 또는 시크릿 모드 */
  deviceId: string | null;
  /** "1920x1080" */
  screen: string;
  /** window.devicePixelRatio */
  dpr: number;
  /** "Asia/Seoul" */
  tz: string;
  /** "ko-KR" */
  lang: string;
  /** navigator.platform */
  platform: string;
}

export interface ServerSignals {
  ipHash: string | null;
  fpHash: string | null;
  deviceId: string | null;
}

export type CheckResultBlocked = {
  blocked: true;
  reason: 'invalid_token' | 'token_already_used' | 'device_already_responded';
};

export type CheckResultPassed = {
  blocked: false;
  /** Track A 통과 시 매칭된 contact id */
  contactTargetId?: string;
};

export type CheckResult = CheckResultBlocked | CheckResultPassed;
```

- [ ] **Step 2.2: Commit**

```bash
git add src/lib/duplicate-detection/types.ts
git commit -m "feat: 중복 감지 공유 타입 정의 추가"
```

---

## Task 3: signals.ts (서버 측 hash 생성) + 단위 테스트

**Files:**
- Create: `src/lib/duplicate-detection/signals.ts`
- Create: `tests/unit/duplicate-detection/signals.test.ts`

- [ ] **Step 3.1: 단위 테스트 먼저 작성 (TDD)**

```ts
// tests/unit/duplicate-detection/signals.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import type { ClientSignals } from '@/lib/duplicate-detection/types';

beforeAll(() => {
  process.env.DUPLICATE_DETECTION_SALT = 'test-salt-do-not-use-in-prod';
});

describe('extractIp', () => {
  it('x-forwarded-for의 첫 번째 IP 우선', async () => {
    const { extractIp } = await import('@/lib/duplicate-detection/signals');
    const h = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(extractIp(h)).toBe('1.2.3.4');
  });

  it('x-forwarded-for 없으면 x-real-ip 사용', async () => {
    const { extractIp } = await import('@/lib/duplicate-detection/signals');
    const h = new Headers({ 'x-real-ip': '9.9.9.9' });
    expect(extractIp(h)).toBe('9.9.9.9');
  });

  it('둘 다 없으면 null', async () => {
    const { extractIp } = await import('@/lib/duplicate-detection/signals');
    expect(extractIp(new Headers())).toBeNull();
  });

  it('x-forwarded-for 공백 trim', async () => {
    const { extractIp } = await import('@/lib/duplicate-detection/signals');
    const h = new Headers({ 'x-forwarded-for': '  1.2.3.4  , 5.6.7.8' });
    expect(extractIp(h)).toBe('1.2.3.4');
  });
});

describe('computeSignals', () => {
  const sampleClient: ClientSignals = {
    deviceId: 'dev-uuid-1',
    screen: '1920x1080',
    dpr: 2,
    tz: 'Asia/Seoul',
    lang: 'ko-KR',
    platform: 'MacIntel',
  };

  it('같은 입력 → 같은 hash (결정성)', async () => {
    const { computeSignals } = await import('@/lib/duplicate-detection/signals');
    const h = new Headers({
      'x-forwarded-for': '1.2.3.4',
      'user-agent': 'Mozilla/5.0 Chrome/120',
    });
    const a = computeSignals(h, sampleClient);
    const b = computeSignals(h, sampleClient);
    expect(a).toEqual(b);
  });

  it('IP가 다르면 ipHash 다름', async () => {
    const { computeSignals } = await import('@/lib/duplicate-detection/signals');
    const h1 = new Headers({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'X' });
    const h2 = new Headers({ 'x-forwarded-for': '5.6.7.8', 'user-agent': 'X' });
    const a = computeSignals(h1, sampleClient);
    const b = computeSignals(h2, sampleClient);
    expect(a.ipHash).not.toBe(b.ipHash);
    expect(a.fpHash).toBe(b.fpHash); // fp는 같아야 함 (IP 미포함)
  });

  it('UA만 다르면 fpHash 다름, ipHash 같음', async () => {
    const { computeSignals } = await import('@/lib/duplicate-detection/signals');
    const h1 = new Headers({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'Chrome' });
    const h2 = new Headers({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'Safari' });
    const a = computeSignals(h1, sampleClient);
    const b = computeSignals(h2, sampleClient);
    expect(a.ipHash).toBe(b.ipHash);
    expect(a.fpHash).not.toBe(b.fpHash);
  });

  it('deviceId는 그대로 통과 (hash X)', async () => {
    const { computeSignals } = await import('@/lib/duplicate-detection/signals');
    const h = new Headers({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'X' });
    const r = computeSignals(h, sampleClient);
    expect(r.deviceId).toBe('dev-uuid-1');
  });

  it('IP가 null이면 ipHash도 null', async () => {
    const { computeSignals } = await import('@/lib/duplicate-detection/signals');
    const h = new Headers({ 'user-agent': 'X' });
    const r = computeSignals(h, sampleClient);
    expect(r.ipHash).toBeNull();
  });

  it('client.deviceId가 null이면 결과 deviceId도 null', async () => {
    const { computeSignals } = await import('@/lib/duplicate-detection/signals');
    const h = new Headers({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'X' });
    const r = computeSignals(h, { ...sampleClient, deviceId: null });
    expect(r.deviceId).toBeNull();
  });
});
```

- [ ] **Step 3.2: 테스트 실행 → FAIL 확인**

Run:
```bash
pnpm vitest run --reporter=dot tests/unit/duplicate-detection/signals.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/duplicate-detection/signals'`

- [ ] **Step 3.3: signals.ts 구현**

```ts
// src/lib/duplicate-detection/signals.ts
import { createHash } from 'node:crypto';
import type { ClientSignals, ServerSignals } from './types';

function getSalt(): string {
  const salt = process.env.DUPLICATE_DETECTION_SALT;
  if (!salt) {
    throw new Error('DUPLICATE_DETECTION_SALT not set');
  }
  return salt;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function extractIp(h: Headers): string | null {
  const xff = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (xff) return xff;
  return h.get('x-real-ip') ?? null;
}

export function computeSignals(h: Headers, client: ClientSignals): ServerSignals {
  const salt = getSalt();
  const ip = extractIp(h);
  const ua = h.get('user-agent') ?? '';

  const fpInput = [
    ua,
    client.screen,
    client.tz,
    client.lang,
    client.platform,
  ].join('|');

  return {
    ipHash: ip ? sha256(ip + salt) : null,
    fpHash: sha256(fpInput + salt),
    deviceId: client.deviceId,
  };
}
```

**구현 노트**: salt 검증을 module-level이 아니라 함수 안으로 옮긴 이유 — 테스트에서 `beforeAll`이 module load 후에 실행되는 경우 module-level throw가 발생. lazy 검증이 안전.

- [ ] **Step 3.4: 테스트 실행 → PASS 확인**

Run:
```bash
pnpm vitest run --reporter=dot tests/unit/duplicate-detection/signals.test.ts
```

Expected: 7 tests passed.

- [ ] **Step 3.5: Commit**

```bash
git add src/lib/duplicate-detection/signals.ts tests/unit/duplicate-detection/signals.test.ts
git commit -m "feat: 중복 감지용 서버 측 신호 해시 생성 로직 추가"
```

---

## Task 4: Drizzle schema 수정 (컬럼 추가 — DROP은 마이그레이션 단계에서)

**Files:**
- Modify: `src/db/schema/surveys.ts` (line 158-208 surveyResponses 정의, line 17-45 surveys 정의)

- [ ] **Step 4.1: surveyResponses 컬럼 추가**

`src/db/schema/surveys.ts` line 175 (`sessionId: text('session_id'),` 다음) 에 컬럼 4개 추가. 기존 `ipAddress` (line 174)는 일단 유지 (마이그레이션 후 별도 제거).

```ts
  sessionId: text('session_id'),
  // 중복 감지 신호 (2026-05-27 추가)
  ipHash: text('ip_hash'),
  fpHash: text('fp_hash'),
  deviceId: text('device_id'),
  // 미래 soft delete hook
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<{
    // ...기존
  }>(),
```

`ipAddress` 컬럼은 Task 5에서 마이그레이션으로 DROP한 직후 Task 6에서 schema 파일에서도 제거.

- [ ] **Step 4.2: surveys에 contact_email 추가**

`src/db/schema/surveys.ts`의 surveys 테이블 정의에서 `updatedAt` 직전에 추가:

```ts
  contactEmail: text('contact_email'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
```

- [ ] **Step 4.3: tsc 통과 확인**

Run:
```bash
pnpm tsc --noEmit
```

Expected: errors 0.

- [ ] **Step 4.4: Commit**

```bash
git add src/db/schema/surveys.ts
git commit -m "feat: 중복 감지·차단 페이지용 컬럼을 schema에 추가"
```

---

## Task 5: 마이그레이션 작성 + 적용 (Supabase MCP)

**Files:**
- 마이그레이션: Supabase MCP `apply_migration` 사용 (memory: feedback_drizzle_migrate_journal — pnpm db:push는 silent skip 위험)

- [ ] **Step 5.1: 마이그레이션 SQL 준비**

SQL 본문:

```sql
-- pgcrypto extension (없으면 생성)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- survey_responses: 새 컬럼 + 컬럼 제거
ALTER TABLE survey_responses
  ADD COLUMN ip_hash text,
  ADD COLUMN fp_hash text,
  ADD COLUMN device_id text,
  ADD COLUMN deleted_at timestamptz;

-- surveys: contact_email
ALTER TABLE surveys
  ADD COLUMN contact_email text;

-- 백필: 기존 raw IP를 hash로 변환
-- 주의: 아래 'REPLACE_WITH_ACTUAL_SALT'를 실제 DUPLICATE_DETECTION_SALT 값으로 치환 후 실행
UPDATE survey_responses
SET ip_hash = encode(digest(ip_address || 'REPLACE_WITH_ACTUAL_SALT', 'sha256'), 'hex')
WHERE ip_address IS NOT NULL;

-- raw IP 컬럼 DROP
ALTER TABLE survey_responses DROP COLUMN ip_address;

-- partial index (완료 + 비삭제된 응답만 lookup)
CREATE INDEX idx_responses_survey_device
  ON survey_responses (survey_id, device_id)
  WHERE device_id IS NOT NULL
    AND completed_at IS NOT NULL
    AND deleted_at IS NULL;

CREATE INDEX idx_responses_survey_fpip
  ON survey_responses (survey_id, fp_hash, ip_hash)
  WHERE fp_hash IS NOT NULL
    AND ip_hash IS NOT NULL
    AND completed_at IS NOT NULL
    AND deleted_at IS NULL;
```

- [ ] **Step 5.2: 사용자에게 실제 salt 값으로 SQL 치환 확인**

`REPLACE_WITH_ACTUAL_SALT`를 `.env.local`의 `DUPLICATE_DETECTION_SALT` 값으로 치환한 최종 SQL을 사용자에게 보여주고 적용 승인 받음. **salt 값은 영구적 — 한 번 적용 후 변경 불가.**

- [ ] **Step 5.3: Supabase MCP `apply_migration` 실행**

`mcp__supabase__apply_migration` 도구로 위 SQL을 `name: 'add_duplicate_detection_signals'` 으로 적용.

- [ ] **Step 5.4: 적용 검증**

Supabase MCP `list_tables` 또는 `execute_sql`로 다음 확인:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'survey_responses'
  AND column_name IN ('ip_hash', 'fp_hash', 'device_id', 'deleted_at', 'ip_address');
```

Expected:
- ip_hash, fp_hash, device_id (text), deleted_at (timestamptz) 4행 반환
- ip_address 행 없음 (DROP됨)

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'surveys' AND column_name = 'contact_email';
```

Expected: 1행.

```sql
SELECT count(*) AS responses_with_iphash FROM survey_responses WHERE ip_hash IS NOT NULL;
```

Expected: 백필된 응답 수 (기존 ip_address 있던 응답 수와 동일).

- [ ] **Step 5.5: Commit (마이그레이션 메타 기록용 — 로컬 SQL 파일 없음)**

Supabase MCP가 자동 적용했으므로 로컬 변경은 없지만, 적용 이력을 기록하기 위해 spec과 plan을 참조하는 짧은 commit 메시지를 다음 task 끝에 함께 묶음. **이 step에서는 commit 안 함.**

---

## Task 6: schema에서 ipAddress 제거

**Files:**
- Modify: `src/db/schema/surveys.ts`

- [ ] **Step 6.1: ipAddress 라인 삭제**

`src/db/schema/surveys.ts` line 174 `ipAddress: text('ip_address'),` 삭제.

- [ ] **Step 6.2: 컴파일 에러 확인 → 사용처 모두 제거**

Run:
```bash
pnpm tsc --noEmit 2>&1 | head -40
```

Expected: `ipAddress` 참조하는 모든 곳에서 에러. 다음 step에서 차례로 제거.

- [ ] **Step 6.3: 사용처 grep + 제거**

```bash
grep -rn "ipAddress" src/ --include="*.ts" --include="*.tsx"
```

각 사용처를 검토:
- `src/actions/response-actions.ts`: `ipAddress` 추출/저장 코드 — 이후 Task 10에서 신호로 대체
- `src/lib/operations/profiles.server.ts`: SELECT 절에서 ipAddress 제거 (이후 Task 14에서 ipMasked 자체 제거)
- 기타 admin 분석/필터 코드: 사용 중이면 임시 주석 처리 + 미사용 import 제거

각 파일을 열어 ipAddress 참조를 제거하거나 임시 `null` 리터럴로 교체 (Task 10/14에서 정리).

- [ ] **Step 6.4: tsc 통과 확인**

Run:
```bash
pnpm tsc --noEmit
```

Expected: errors 0.

- [ ] **Step 6.5: Commit**

```bash
git add src/db/schema/surveys.ts src/actions/response-actions.ts src/lib/operations/profiles.server.ts
# 추가 사용처가 있었다면 함께 add
git commit -m "feat: raw ipAddress 컬럼을 스키마와 사용처에서 제거"
```

---

## Task 7: check.ts (알고리즘) + 단위 테스트

**Files:**
- Create: `src/lib/duplicate-detection/check.ts`
- Create: `tests/unit/duplicate-detection/check.test.ts`

알고리즘 단위 테스트는 DB lookup 없이 **SQL where-절 빌드 결과**만 검증하기 어렵다. 따라서 **알고리즘의 분기·반환 형태**를 vi.mock으로 db 호출을 가짜로 만들어 검증.

- [ ] **Step 7.1: 단위 테스트 작성**

```ts
// tests/unit/duplicate-detection/check.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// db.query.surveyResponses.findFirst 와 findContactByInviteToken 을 mock
const { mockFindFirst, mockFindContact } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockFindContact: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: { query: { surveyResponses: { findFirst: mockFindFirst } } },
}));

vi.mock('@/actions/response-actions', () => ({
  findContactByInviteToken: mockFindContact,
}));

describe('checkTrackA (invite_token)', () => {
  beforeEach(() => {
    mockFindContact.mockReset();
  });

  it('토큰 없음 → invalid_token', async () => {
    mockFindContact.mockResolvedValue(null);
    const { checkTrackA } = await import('@/lib/duplicate-detection/check');
    const r = await checkTrackA('survey-1', 'bad-token');
    expect(r).toEqual({ blocked: true, reason: 'invalid_token' });
  });

  it('토큰 + respondedAt 있음 → token_already_used', async () => {
    mockFindContact.mockResolvedValue({ id: 'c1', respondedAt: new Date() });
    const { checkTrackA } = await import('@/lib/duplicate-detection/check');
    const r = await checkTrackA('survey-1', 'used-token');
    expect(r).toEqual({ blocked: true, reason: 'token_already_used' });
  });

  it('토큰 미사용 → 통과 + contactTargetId', async () => {
    mockFindContact.mockResolvedValue({ id: 'c1', respondedAt: null });
    const { checkTrackA } = await import('@/lib/duplicate-detection/check');
    const r = await checkTrackA('survey-1', 'fresh-token');
    expect(r).toEqual({ blocked: false, contactTargetId: 'c1' });
  });
});

describe('checkTrackB (신호 기반)', () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
  });

  it('매칭 row 없음 → 통과', async () => {
    mockFindFirst.mockResolvedValue(undefined);
    const { checkTrackB } = await import('@/lib/duplicate-detection/check');
    const r = await checkTrackB({
      surveyId: 's1',
      signals: { ipHash: 'iH', fpHash: 'fH', deviceId: 'dev1' },
    });
    expect(r).toEqual({ blocked: false });
  });

  it('매칭 row 있음 → device_already_responded', async () => {
    mockFindFirst.mockResolvedValue({ id: 'existing' });
    const { checkTrackB } = await import('@/lib/duplicate-detection/check');
    const r = await checkTrackB({
      surveyId: 's1',
      signals: { ipHash: 'iH', fpHash: 'fH', deviceId: 'dev1' },
    });
    expect(r).toEqual({ blocked: true, reason: 'device_already_responded' });
  });

  it('모든 신호 null → 통과 (검사할 신호 없음)', async () => {
    mockFindFirst.mockResolvedValue(undefined);
    const { checkTrackB } = await import('@/lib/duplicate-detection/check');
    const r = await checkTrackB({
      surveyId: 's1',
      signals: { ipHash: null, fpHash: null, deviceId: null },
    });
    expect(r).toEqual({ blocked: false });
  });
});
```

- [ ] **Step 7.2: 테스트 실행 → FAIL 확인**

```bash
pnpm vitest run --reporter=dot tests/unit/duplicate-detection/check.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/duplicate-detection/check'`

- [ ] **Step 7.3: check.ts 구현**

```ts
// src/lib/duplicate-detection/check.ts
import { and, eq, isNull, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { surveyResponses } from '@/db/schema/surveys';
import { findContactByInviteToken } from '@/actions/response-actions';
import type { CheckResult, ServerSignals } from './types';

export async function checkTrackA(
  surveyId: string,
  inviteToken: string,
): Promise<CheckResult> {
  const contact = await findContactByInviteToken(surveyId, inviteToken);
  if (!contact) return { blocked: true, reason: 'invalid_token' };
  if ((contact as { respondedAt?: Date | null }).respondedAt) {
    return { blocked: true, reason: 'token_already_used' };
  }
  return { blocked: false, contactTargetId: contact.id };
}

export async function checkTrackB(params: {
  surveyId: string;
  signals: ServerSignals;
}): Promise<CheckResult> {
  const { surveyId, signals } = params;

  // 조건 1: deviceId 단독 일치 (둘 다 NULL 아님)
  const cond1 = signals.deviceId
    ? eq(surveyResponses.deviceId, signals.deviceId)
    : sql`false`;

  // signals.deviceId == null 이면 row 측 deviceId 무관 (sql`true`)
  // signals.deviceId 값이 있으면 row.deviceId가 NULL이거나 같은 값일 때만 매칭
  const deviceConstraint = signals.deviceId == null
    ? sql`true`
    : or(
        isNull(surveyResponses.deviceId),
        eq(surveyResponses.deviceId, signals.deviceId),
      );

  // 조건 2: fp + ip 둘 다 일치 + deviceConstraint
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
    columns: { id: true },
  });

  if (existing) {
    return { blocked: true, reason: 'device_already_responded' };
  }
  return { blocked: false };
}
```

**구현 노트**: `findContactByInviteToken`는 현재 `{ id: string } | null` 만 반환 — `respondedAt`을 함께 노출하도록 다음 step에서 시그니처 확장.

- [ ] **Step 7.4: findContactByInviteToken 시그니처 확장**

`src/actions/response-actions.ts` line 33-42의 `findContactByInviteToken`이 `respondedAt`도 함께 반환하도록 수정.

기존 코드를 읽고 SELECT에 `respondedAt` 추가:

```ts
async function findContactByInviteToken(
  surveyId: string,
  inviteToken: string,
): Promise<{ id: string; respondedAt: Date | null } | null> {
  // 기존 PG SECURITY DEFINER 함수 호출 결과에 respondedAt 포함하도록 SELECT 조정
  // (구현 단계에서 기존 SQL 확인 후 컬럼 추가)
}
```

호출처 영향 확인 (기존에 `{ id }`만 destructure하던 곳은 영향 없음 — 추가 필드는 무시됨).

- [ ] **Step 7.5: 단위 테스트 PASS 확인**

```bash
pnpm vitest run --reporter=dot tests/unit/duplicate-detection/check.test.ts
```

Expected: 6 tests passed.

- [ ] **Step 7.6: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```

Expected: errors 0.

- [ ] **Step 7.7: Commit**

```bash
git add src/lib/duplicate-detection/check.ts src/lib/duplicate-detection/types.ts src/actions/response-actions.ts tests/unit/duplicate-detection/check.test.ts
git commit -m "feat: 중복 감지 알고리즘 Track A/B 구현 및 단위 테스트 추가"
```

---

## Task 8: checkDuplicateOnEntry server action + 통합 테스트 (Track A 차단)

**Files:**
- Create: `src/actions/duplicate-detection-actions.ts`
- Create: `tests/integration/duplicate-track-a-invite-block.test.ts`

- [ ] **Step 8.1: 통합 테스트 작성 (실제 DB 사용)**

```ts
// tests/integration/duplicate-track-a-invite-block.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/db';
import { surveys, surveyResponses, contactTargets, contactUploads }
  from '@/db/schema/surveys';
import { eq } from 'drizzle-orm';

// 테스트 격리용 surveyId
const TEST_SURVEY_ID = 'aaaaaaaa-0001-0001-0001-000000000001';

beforeAll(async () => {
  process.env.DUPLICATE_DETECTION_SALT = 'integration-test-salt';
  // 테스트용 survey + contact_target 시드
  await db.insert(surveys).values({
    id: TEST_SURVEY_ID,
    title: 'integ test',
  } as never).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(surveyResponses).where(eq(surveyResponses.surveyId, TEST_SURVEY_ID));
  await db.delete(contactTargets).where(eq(contactTargets.surveyId, TEST_SURVEY_ID));
  await db.delete(surveys).where(eq(surveys.id, TEST_SURVEY_ID));
});

describe('Track A: invite_token 차단', () => {
  it('이미 응답 완료된 토큰으로 진입 시 token_already_used', async () => {
    const inviteToken = 'token-already-used-test';
    // contact_target + respondedAt 시드 (실제 컬럼명·필수 필드는 기존 스키마 확인)
    await db.insert(contactTargets).values({
      surveyId: TEST_SURVEY_ID,
      inviteToken,
      respondedAt: new Date(),
      // 기타 not-null 필드 (resid, attrs 등) — 기존 코드 확인 후 채움
    } as never);

    const { checkDuplicateOnEntry } = await import('@/actions/duplicate-detection-actions');
    const r = await checkDuplicateOnEntry({
      surveyId: TEST_SURVEY_ID,
      inviteToken,
      clientSignals: {
        deviceId: 'd1', screen: '1x1', dpr: 1,
        tz: 'UTC', lang: 'en', platform: 'X',
      },
    });

    expect(r).toEqual({ blocked: true, reason: 'token_already_used' });
  });

  it('잘못된 토큰 → invalid_token', async () => {
    const { checkDuplicateOnEntry } = await import('@/actions/duplicate-detection-actions');
    const r = await checkDuplicateOnEntry({
      surveyId: TEST_SURVEY_ID,
      inviteToken: 'nonexistent-token-xyz',
      clientSignals: {
        deviceId: 'd2', screen: '1x1', dpr: 1,
        tz: 'UTC', lang: 'en', platform: 'X',
      },
    });
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.reason).toBe('invalid_token');
  });
});
```

- [ ] **Step 8.2: 테스트 실행 → FAIL 확인**

```bash
pnpm vitest run --reporter=dot tests/integration/duplicate-track-a-invite-block.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 8.3: server action 구현**

```ts
// src/actions/duplicate-detection-actions.ts
'use server';

import { headers } from 'next/headers';
import { computeSignals } from '@/lib/duplicate-detection/signals';
import { checkTrackA, checkTrackB } from '@/lib/duplicate-detection/check';
import type { ClientSignals, CheckResult } from '@/lib/duplicate-detection/types';

export async function checkDuplicateOnEntry(input: {
  surveyId: string;
  inviteToken?: string;
  clientSignals: ClientSignals;
}): Promise<CheckResult> {
  const { surveyId, inviteToken, clientSignals } = input;

  // Track A: invite_token 1순위
  if (inviteToken) {
    return checkTrackA(surveyId, inviteToken);
  }

  // Track B: 공개/비공개 신호 기반
  const h = await headers();
  const signals = computeSignals(h, clientSignals);
  return checkTrackB({ surveyId, signals });
}
```

- [ ] **Step 8.4: 테스트 PASS 확인**

```bash
pnpm vitest run --reporter=dot tests/integration/duplicate-track-a-invite-block.test.ts
```

Expected: 2 tests passed. 실패 시 시드 데이터의 not-null 필드를 추가하거나 contact_targets 스키마 확인.

- [ ] **Step 8.5: Commit**

```bash
git add src/actions/duplicate-detection-actions.ts tests/integration/duplicate-track-a-invite-block.test.ts
git commit -m "feat: 진입 시점 중복 검사 server action 추가 및 Track A 통합 테스트"
```

---

## Task 9: Track B 통합 테스트 (device 차단, NAT safe, secret mode, 완료 응답 only)

**Files:**
- Create: `tests/integration/duplicate-track-b-device-block.test.ts`
- Create: `tests/integration/duplicate-track-b-nat-safe.test.ts`
- Create: `tests/integration/duplicate-track-b-secret-mode-block.test.ts`
- Create: `tests/integration/duplicate-completed-only.test.ts`
- Create: `tests/integration/duplicate-soft-delete-hook.test.ts`

각 테스트는 동일 패턴: `surveyResponses`에 행을 시드하고 `checkDuplicateOnEntry`를 호출해 차단 여부 검증.

- [ ] **Step 9.1: device 차단 테스트**

```ts
// tests/integration/duplicate-track-b-device-block.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { db } from '@/db';
import { surveys, surveyResponses } from '@/db/schema/surveys';
import { eq } from 'drizzle-orm';

const SURVEY_ID = 'aaaaaaaa-0002-0002-0002-000000000002';
const SIGNALS = {
  deviceId: 'device-uuid-A',
  screen: '1920x1080', dpr: 2,
  tz: 'Asia/Seoul', lang: 'ko-KR', platform: 'MacIntel',
};

beforeAll(async () => {
  process.env.DUPLICATE_DETECTION_SALT = 'integ-salt';
  await db.insert(surveys).values({ id: SURVEY_ID, title: 't' } as never)
    .onConflictDoNothing();
});

afterEach(async () => {
  await db.delete(surveyResponses).where(eq(surveyResponses.surveyId, SURVEY_ID));
});

afterAll(async () => {
  await db.delete(surveys).where(eq(surveys.id, SURVEY_ID));
});

it('같은 deviceId 완료 응답 있음 → device_already_responded', async () => {
  await db.insert(surveyResponses).values({
    surveyId: SURVEY_ID,
    questionResponses: {},
    deviceId: 'device-uuid-A',
    completedAt: new Date(),
    isCompleted: true,
    status: 'completed',
  } as never);

  const { checkDuplicateOnEntry } = await import('@/actions/duplicate-detection-actions');
  const r = await checkDuplicateOnEntry({
    surveyId: SURVEY_ID,
    clientSignals: SIGNALS,
  });

  expect(r).toEqual({ blocked: true, reason: 'device_already_responded' });
});
```

- [ ] **Step 9.2: NAT safe 테스트 (같은 fp+ip + 다른 deviceId → 통과)**

```ts
// tests/integration/duplicate-track-b-nat-safe.test.ts
// (setup 동일)

it('같은 fp+ip + 다른 deviceId → 통과 (NAT 환경)', async () => {
  // 헤더가 같아야 fp/ip가 같음 — computeSignals 호출 결과를 똑같이 만들어야 함
  // 통합 테스트에서 headers() mock이 어려우니 미리 hash를 계산해 직접 시드

  const { computeSignals } = await import('@/lib/duplicate-detection/signals');
  const h = new Headers({ 'x-forwarded-for': '10.0.0.1', 'user-agent': 'Chrome/120' });
  const sig = computeSignals(h, { ...SIGNALS, deviceId: 'OTHER-DEVICE' });

  // OTHER-DEVICE의 완료 응답을 시드
  await db.insert(surveyResponses).values({
    surveyId: SURVEY_ID,
    questionResponses: {},
    deviceId: 'OTHER-DEVICE',
    ipHash: sig.ipHash,
    fpHash: sig.fpHash,
    completedAt: new Date(),
    isCompleted: true,
    status: 'completed',
  } as never);

  // 새 사용자가 같은 IP/fp이지만 다른 deviceId로 진입
  const { checkTrackB } = await import('@/lib/duplicate-detection/check');
  const newSig = computeSignals(h, { ...SIGNALS, deviceId: 'DEVICE-NEW' });
  const r = await checkTrackB({ surveyId: SURVEY_ID, signals: newSig });

  expect(r).toEqual({ blocked: false });
});
```

**구현 노트**: 통합 테스트에서 `headers()` mock이 어려우므로 `checkTrackB`를 직접 호출하고 `computeSignals`로 계산한 hash를 시드 데이터에 직접 박아 정확히 매칭 케이스를 만든다.

- [ ] **Step 9.3: secret mode 차단 테스트 (deviceId=null + 같은 fp+ip → 차단)**

```ts
// tests/integration/duplicate-track-b-secret-mode-block.test.ts
it('시크릿 모드 (deviceId=null) + 같은 fp+ip → 차단', async () => {
  const { computeSignals } = await import('@/lib/duplicate-detection/signals');
  const { checkTrackB } = await import('@/lib/duplicate-detection/check');
  const h = new Headers({ 'x-forwarded-for': '10.0.0.2', 'user-agent': 'Chrome/120' });
  const sigWithDevice = computeSignals(h, { ...SIGNALS, deviceId: 'D1' });

  // 일반 모드 완료 응답
  await db.insert(surveyResponses).values({
    surveyId: SURVEY_ID,
    questionResponses: {},
    deviceId: 'D1',
    ipHash: sigWithDevice.ipHash,
    fpHash: sigWithDevice.fpHash,
    completedAt: new Date(),
    isCompleted: true,
    status: 'completed',
  } as never);

  // 시크릿 모드 진입 (deviceId=null이지만 fp/ip 동일)
  const sigSecret = computeSignals(h, { ...SIGNALS, deviceId: null });
  const r = await checkTrackB({ surveyId: SURVEY_ID, signals: sigSecret });

  expect(r).toEqual({ blocked: true, reason: 'device_already_responded' });
});
```

- [ ] **Step 9.4: 완료 응답만 차단 근거 테스트**

```ts
// tests/integration/duplicate-completed-only.test.ts
it('진행 중(미완료) 응답은 차단 근거 X — 같은 deviceId로 재진입 통과', async () => {
  await db.insert(surveyResponses).values({
    surveyId: SURVEY_ID,
    questionResponses: {},
    deviceId: 'DEV-INPROGRESS',
    completedAt: null,  // 미완료
    isCompleted: false,
    status: 'in_progress',
  } as never);

  const { checkTrackB } = await import('@/lib/duplicate-detection/check');
  const r = await checkTrackB({
    surveyId: SURVEY_ID,
    signals: { ipHash: null, fpHash: null, deviceId: 'DEV-INPROGRESS' },
  });

  expect(r).toEqual({ blocked: false });
});
```

- [ ] **Step 9.5: soft delete hook 테스트**

```ts
// tests/integration/duplicate-soft-delete-hook.test.ts
it('deleted_at 세팅된 응답은 차단 근거 X', async () => {
  await db.insert(surveyResponses).values({
    surveyId: SURVEY_ID,
    questionResponses: {},
    deviceId: 'DEV-DELETED',
    completedAt: new Date(),
    isCompleted: true,
    status: 'completed',
    deletedAt: new Date(),  // soft delete
  } as never);

  const { checkTrackB } = await import('@/lib/duplicate-detection/check');
  const r = await checkTrackB({
    surveyId: SURVEY_ID,
    signals: { ipHash: null, fpHash: null, deviceId: 'DEV-DELETED' },
  });

  expect(r).toEqual({ blocked: false });
});
```

- [ ] **Step 9.6: 5개 테스트 일괄 실행**

```bash
pnpm vitest run --reporter=dot tests/integration/duplicate-track-b-*.test.ts tests/integration/duplicate-completed-only.test.ts tests/integration/duplicate-soft-delete-hook.test.ts
```

Expected: 5 tests passed.

- [ ] **Step 9.7: Commit**

```bash
git add tests/integration/duplicate-track-b-*.test.ts tests/integration/duplicate-completed-only.test.ts tests/integration/duplicate-soft-delete-hook.test.ts
git commit -m "feat: Track B 차단·NAT safe·시크릿·완료 응답·삭제 hook 통합 테스트 추가"
```

---

## Task 10: response-actions.ts 수정 (시그니처 + 차단 분기 + 신호 저장)

**Files:**
- Modify: `src/actions/response-actions.ts` (line 113-195 createResponseWithFirstAnswer, line 212-218 createBlankResponse)
- Create: `tests/integration/duplicate-track-b-bypass-defense.test.ts`

- [ ] **Step 10.1: bypass defense 테스트 작성 (TDD)**

```ts
// tests/integration/duplicate-track-b-bypass-defense.test.ts
// (setup 위 테스트들과 동일 — surveyId, salt 등)

it('checkDuplicateOnEntry 우회 → 첫 답변 server action에서 차단', async () => {
  // 이전 완료 응답 시드
  await db.insert(surveyResponses).values({
    surveyId: SURVEY_ID,
    questionResponses: { q1: 'prev' },
    deviceId: 'DEV-X',
    completedAt: new Date(),
    isCompleted: true,
    status: 'completed',
  } as never);

  const { createResponseWithFirstAnswer } = await import('@/actions/response-actions');
  const result = await createResponseWithFirstAnswer({
    surveyId: SURVEY_ID,
    sessionId: 'fresh-session-bypass',
    versionId: null,
    questionId: 'q1',
    value: 'attempt',
    currentStepId: 'group:x',
    clientSignals: {
      deviceId: 'DEV-X',
      screen: '1x1', dpr: 1, tz: 'UTC', lang: 'en', platform: 'X',
    },
  });

  // 차단 결과는 throw 또는 { kind: 'blocked' } 형태로 반환 — 구현에서 결정
  expect(result).toMatchObject({ kind: 'blocked' });
});
```

- [ ] **Step 10.2: 테스트 실행 → FAIL 확인**

```bash
pnpm vitest run --reporter=dot tests/integration/duplicate-track-b-bypass-defense.test.ts
```

Expected: FAIL — `clientSignals` is not a recognized input field 또는 차단되지 않음.

- [ ] **Step 10.3: createResponseWithFirstAnswer 시그니처 수정**

`src/actions/response-actions.ts` line 113 부근:

```ts
import { computeSignals } from '@/lib/duplicate-detection/signals';
import { checkTrackA, checkTrackB } from '@/lib/duplicate-detection/check';
import type { ClientSignals } from '@/lib/duplicate-detection/types';

type FirstAnswerResult =
  | { kind: 'created'; id: string; contactTargetId: string | null }
  | { kind: 'blocked'; reason: 'invalid_token' | 'token_already_used' | 'device_already_responded' };

export async function createResponseWithFirstAnswer(input: {
  surveyId: string;
  sessionId: string;
  versionId: string | null;
  questionId: string;
  value: unknown;
  currentStepId: string;
  inviteToken?: string;
  clientSignals: ClientSignals;  // ← 추가
}): Promise<FirstAnswerResult> {
  const { surveyId, sessionId, versionId, questionId, value, currentStepId,
    inviteToken, clientSignals } = input;

  const h = await headers();
  const signals = computeSignals(h, clientSignals);

  // 중복 재검증 (이중 안전망)
  if (inviteToken) {
    const trackA = await checkTrackA(surveyId, inviteToken);
    if (trackA.blocked) return { kind: 'blocked', reason: trackA.reason };
  } else {
    const trackB = await checkTrackB({ surveyId, signals });
    if (trackB.blocked) return { kind: 'blocked', reason: trackB.reason };
  }

  // 기존 INSERT 로직 — 신호 컬럼 추가, ipAddress 제거
  // (기존 코드에서 ipAddress: ip 부분을 ipHash/fpHash/deviceId 로 교체)
  const ipHash = signals.ipHash;
  const fpHash = signals.fpHash;
  const deviceId = signals.deviceId;

  // ... 기존 INSERT 코드:
  //   ipAddress: ip   ← 제거
  //   ipHash, fpHash, deviceId 추가
  //   나머지 (userAgent, platform, browser 등) 그대로

  // 반환 형태도 { kind: 'created', ... } 로 wrap
  return { kind: 'created', id: insertedId, contactTargetId };
}
```

**구현 노트**: 기존 반환 타입 `Promise<{ id; contactTargetId }>` 가 `FirstAnswerResult` 유니온으로 바뀜 → 호출처(`page.tsx`)도 함께 갱신. 모든 호출처는 Task 12에서 갱신.

- [ ] **Step 10.4: createBlankResponse 동일 패턴 적용 또는 deprecate 결정**

```bash
grep -rn "createBlankResponse" src/ --include="*.ts" --include="*.tsx"
```

사용처를 확인:
- 호출 1개 이하면 deprecate 후 인라인 제거
- 2개 이상이면 동일한 `clientSignals` 추가 + 차단 분기 적용

본 plan은 **사용처가 1개 이하면 deprecate**한다는 가정. 사용처 ≥2면 동일 패턴 적용 step을 추가.

- [ ] **Step 10.5: 테스트 PASS 확인**

```bash
pnpm vitest run --reporter=dot tests/integration/duplicate-track-b-bypass-defense.test.ts
```

Expected: 1 test passed.

- [ ] **Step 10.6: tsc 통과 확인 — 호출처 타입 에러 확인**

```bash
pnpm tsc --noEmit 2>&1 | grep -E "createResponseWithFirstAnswer|createBlankResponse"
```

Expected: page.tsx에서 호출 부분 타입 에러 — Task 12에서 함께 수정.

- [ ] **Step 10.7: Commit**

```bash
git add src/actions/response-actions.ts tests/integration/duplicate-track-b-bypass-defense.test.ts
git commit -m "feat: 첫 답변 server action에 신호 재검증 및 신호 저장 적용 (이중 안전망)"
```

---

## Task 11: use-client-signals hook + AlreadyRespondedView 컴포넌트

**Files:**
- Create: `src/hooks/use-client-signals.ts`
- Create: `src/components/survey/already-responded-view.tsx`

- [ ] **Step 11.1: use-client-signals hook 작성**

```ts
// src/hooks/use-client-signals.ts
'use client';

import { useEffect, useRef } from 'react';
import type { ClientSignals } from '@/lib/duplicate-detection/types';

const STORAGE_KEY = '__sd_device_id';

function readOrCreateDeviceId(): string | null {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // 시크릿 모드 일부 / storage 차단 시
    return null;
  }
}

function collectSignals(): ClientSignals {
  return {
    deviceId: readOrCreateDeviceId(),
    screen: `${window.screen.width}x${window.screen.height}`,
    dpr: window.devicePixelRatio,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang: navigator.language,
    platform: navigator.platform,
  };
}

/**
 * 마운트 시 한 번 신호를 수집해 ref에 보관한다.
 * 서버 측에서 hash 계산 → 첫 답변 시 같은 신호를 다시 전달.
 */
export function useClientSignals(): React.MutableRefObject<ClientSignals | null> {
  const ref = useRef<ClientSignals | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    ref.current = collectSignals();
  }, []);
  return ref;
}
```

- [ ] **Step 11.2: AlreadyRespondedView 컴포넌트 작성**

```tsx
// src/components/survey/already-responded-view.tsx
'use client';

import Link from 'next/link';

interface Props {
  reason: 'invalid_token' | 'token_already_used' | 'device_already_responded';
  surveyTitle: string;
  contactEmail: string | null;
}

const MESSAGES: Record<Props['reason'], { title: string; body: string }> = {
  invalid_token: {
    title: '잘못된 초대 링크입니다',
    body: '이 링크는 유효하지 않거나 만료되었습니다. 운영자에게 새 링크를 요청해 주세요.',
  },
  token_already_used: {
    title: '이미 응답이 완료된 초대입니다',
    body: '이 초대 링크로는 이미 응답이 제출되었습니다. 중복 응답은 허용되지 않습니다.',
  },
  device_already_responded: {
    title: '이미 응답하신 설문입니다',
    body: '이 기기에서 이 설문에 응답한 기록이 있습니다. 한 분당 한 번만 응답 가능합니다.',
  },
};

export function AlreadyRespondedView({ reason, surveyTitle, contactEmail }: Props) {
  const msg = MESSAGES[reason];
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold text-foreground">{msg.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{surveyTitle}</p>
      <p className="mt-6 text-sm leading-relaxed text-foreground">{msg.body}</p>
      {contactEmail && (
        <Link
          href={`mailto:${contactEmail}?subject=${encodeURIComponent(surveyTitle + ' 문의')}`}
          className="mt-8 text-sm text-primary underline"
        >
          관리자에게 문의하기
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 11.3: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```

Expected: errors 0 (response-actions 호출처 에러는 Task 12에서 해결).

- [ ] **Step 11.4: Commit**

```bash
git add src/hooks/use-client-signals.ts src/components/survey/already-responded-view.tsx
git commit -m "feat: 클라이언트 신호 수집 훅 및 응답 차단 화면 컴포넌트 추가"
```

---

## Task 12: page.tsx 응답 페이지 통합

**Files:**
- Modify: `src/app/survey/[id]/page.tsx`

페이지가 이미 `'use client'` 컴포넌트이므로 mount 직후 `checkDuplicateOnEntry`를 호출하고 결과에 따라 차단 UI로 전환. 신호는 useRef에 보관해 첫 답변 시 전달.

- [ ] **Step 12.1: import + state 추가**

`page.tsx` 상단 import 추가:
```ts
import { checkDuplicateOnEntry } from '@/actions/duplicate-detection-actions';
import { useClientSignals } from '@/hooks/use-client-signals';
import { AlreadyRespondedView } from '@/components/survey/already-responded-view';
import type { CheckResult } from '@/lib/duplicate-detection/types';
```

`SurveyResponsePage` 함수 내부 (line 127 이후) state 추가:
```ts
const signalsRef = useClientSignals();
const [duplicateStatus, setDuplicateStatus] =
  useState<{ kind: 'checking' } | { kind: 'blocked'; reason: CheckResult extends { blocked: true; reason: infer R } ? R : never } | { kind: 'ok' }>({ kind: 'checking' });
```

타입 단순화:
```ts
type DuplicateStatus =
  | { kind: 'checking' }
  | { kind: 'blocked'; reason: 'invalid_token' | 'token_already_used' | 'device_already_responded' }
  | { kind: 'ok' };
const [duplicateStatus, setDuplicateStatus] = useState<DuplicateStatus>({ kind: 'checking' });
```

- [ ] **Step 12.2: mount 시 checkDuplicateOnEntry 호출 useEffect 추가**

`survey` 데이터 로드가 완료된 직후 (또는 useEffect로 한 번):

```ts
useEffect(() => {
  if (!survey?.id) return;
  let cancelled = false;
  // signalsRef가 채워질 때까지 0틱 기다림 — useClientSignals의 effect도 mount 시
  // 같은 순서로 실행되므로 microtask로 한 번 yield
  queueMicrotask(async () => {
    const signals = signalsRef.current;
    if (!signals) {
      // storage 차단 + JS 환경 비정상. 통과 (수용된 trade-off).
      if (!cancelled) setDuplicateStatus({ kind: 'ok' });
      return;
    }
    const r = await checkDuplicateOnEntry({
      surveyId: survey.id,
      inviteToken: inviteToken ?? undefined,
      clientSignals: signals,
    });
    if (cancelled) return;
    if (r.blocked) {
      setDuplicateStatus({ kind: 'blocked', reason: r.reason });
    } else {
      setDuplicateStatus({ kind: 'ok' });
    }
  });
  return () => { cancelled = true; };
}, [survey?.id, inviteToken, signalsRef]);
```

- [ ] **Step 12.3: 차단/검사 중 UI 분기 추가**

응답 페이지의 메인 return 직전에:

```ts
if (duplicateStatus.kind === 'checking') {
  return (
    <div className="mx-auto flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      확인 중...
    </div>
  );
}

if (duplicateStatus.kind === 'blocked') {
  return (
    <AlreadyRespondedView
      reason={duplicateStatus.reason}
      surveyTitle={survey?.title ?? ''}
      contactEmail={survey?.contactEmail ?? null}
    />
  );
}
```

- [ ] **Step 12.4: 첫 답변 호출에 clientSignals 전달**

기존 `createResponseWithFirstAnswer` 호출처 (resumeOrCreateResponse 등):

```ts
const result = await createResponseWithFirstAnswer({
  surveyId: survey.id,
  sessionId,
  versionId,
  questionId,
  value,
  currentStepId,
  inviteToken: inviteToken ?? undefined,
  clientSignals: signalsRef.current!,  // checking 단계를 통과했으면 채워져 있음
});

// 반환 유니온 처리
if (result.kind === 'blocked') {
  setDuplicateStatus({ kind: 'blocked', reason: result.reason });
  return;
}
// 기존 'created' 처리 (result.id, result.contactTargetId)
```

`createBlankResponse` 호출처가 있다면 동일하게 신호 전달 + 반환 유니온 처리.

- [ ] **Step 12.5: tsc 통과 + 수동 smoke test 안내**

```bash
pnpm tsc --noEmit
```

Expected: errors 0.

수동 smoke test (사용자 안내):
1. `pnpm dev` 실행
2. 공개 설문 응답 페이지 진입 → 확인 중... → 정상 응답 화면 표시
3. 한 질문 답하고 완료 → 새 브라우저 incognito로 같은 URL 다시 진입 → 같은 IP + 다른 deviceId라서 통과 (NAT safe)
4. 같은 브라우저로 응답 완료 후 새로고침 → "이미 응답하신 설문입니다" 차단 화면

- [ ] **Step 12.6: Commit**

```bash
git add src/app/survey/[id]/page.tsx
git commit -m "feat: 응답 페이지 진입 시 중복 검사 및 차단 화면 전환"
```

---

## Task 13: admin 설문 설정에 contact_email 입력 필드

**Files:**
- Modify: `src/components/survey-builder/survey-settings-panel.tsx`
- Modify: `src/actions/survey-save-actions.ts` (explicit field set — memory: feedback_survey_save_explicit_fields)

- [ ] **Step 13.1: settings panel에 input 추가**

`survey-settings-panel.tsx`의 `space-y-6` 섹션 (line 45-84 부근 토글들 사이 또는 끝)에:

```tsx
<div className="space-y-2">
  <label htmlFor="contact-email" className="text-sm font-medium">
    응답자 문의 이메일
  </label>
  <input
    id="contact-email"
    type="email"
    value={settings.contactEmail ?? ''}
    onChange={(e) => updateSettings({ contactEmail: e.target.value || null })}
    placeholder="admin@example.com"
    className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
  />
  <p className="text-xs text-muted-foreground">
    중복 응답 차단 화면에 표시되는 문의 링크입니다. 비워두면 링크 없이 메시지만 표시됩니다.
  </p>
</div>
```

(기존 설정값 store 패턴에 맞춰 `settings.contactEmail` / `updateSettings` 형태 조정 필요. 기존 panel 구조를 먼저 읽어 store 갱신 방식을 확인.)

- [ ] **Step 13.2: survey-save-actions.ts에 contact_email 명시 추가**

기존 save action의 explicit field set에 `contactEmail: input.contactEmail` 추가. spread `...input` 안 쓰는 패턴 (memory).

- [ ] **Step 13.3: tsc 통과 확인**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 13.4: 수동 smoke test 안내**

1. admin → 설문 편집 → 설정 패널 → "응답자 문의 이메일" 입력 → 저장
2. 응답 페이지에서 차단 시 mailto 링크 표시 확인

- [ ] **Step 13.5: Commit**

```bash
git add src/components/survey-builder/survey-settings-panel.tsx src/actions/survey-save-actions.ts
git commit -m "feat: 설문 설정에 응답자 문의 이메일 필드 추가"
```

---

## Task 14: admin profiles 테이블 "접속IP" 컬럼 정리

**Files:**
- Modify: `src/components/operations/profiles/profiles-table.tsx` (line 129)
- Modify: `src/lib/operations/profiles.server.ts` (line 10, 25)

- [ ] **Step 14.1: 컬럼 정의 삭제**

`profiles-table.tsx` line 129의 `'접속IP'` 컬럼 정의 삭제.

- [ ] **Step 14.2: ipMasked 필드 + formatIpMask 사용 제거**

`profiles.server.ts`:
- line 10 `formatIpMask` import 제거
- line 25 `ipMasked` 필드 제거
- ProfilesRow 인터페이스에서도 `ipMasked` 필드 제거
- 관련 type import 정리

- [ ] **Step 14.3: 미사용 utility 정리**

```bash
grep -rn "formatIpMask" src/
```

다른 사용처가 없으면 `formatIpMask` 함수 자체도 삭제.

- [ ] **Step 14.4: tsc + 빌드 통과 확인**

```bash
pnpm tsc --noEmit && pnpm build
```

Expected: 빌드 성공.

- [ ] **Step 14.5: Commit**

```bash
git add src/components/operations/profiles/profiles-table.tsx src/lib/operations/profiles.server.ts
# formatIpMask 정의 삭제했으면 그 파일도 add
git commit -m "feat: admin 응답 내역에서 접속IP 컬럼 및 마스킹 유틸 제거"
```

---

## Task 15: 전체 회귀 검증

- [ ] **Step 15.1: 전체 vitest 실행**

```bash
pnpm vitest run --reporter=dot
```

Expected: 모든 테스트 통과 (기존 + 본 plan에서 추가한 신규 테스트).

- [ ] **Step 15.2: tsc 통과**

```bash
pnpm tsc --noEmit
```

Expected: errors 0.

- [ ] **Step 15.3: 빌드 통과**

```bash
pnpm build
```

Expected: 빌드 성공.

memory: `feedback_lint_infra_broken` — `pnpm lint`는 Next 16 + eslint 8 미스매치로 실패. tsc + vitest + build 조합으로 검증.

- [ ] **Step 15.4: 수동 E2E smoke test**

`pnpm dev` 후 사용자가 다음 시나리오를 직접 검증:

| # | 시나리오 | 기대 결과 |
|---|----------|-----------|
| 1 | 공개링크 첫 진입 | "확인 중..." 잠깐 → 정상 응답 화면 |
| 2 | 공개링크 응답 완료 후 같은 브라우저 재진입 | "이미 응답하신 설문입니다" |
| 3 | 공개링크 응답 도중 탭 닫고 다른 브라우저로 재진입 | 정상 통과 (미완료라 차단 X) |
| 4 | invite 링크 첫 진입 | 정상 응답 화면 |
| 5 | invite 링크 응답 완료 후 같은 토큰으로 재진입 | "이미 응답이 완료된 초대" |
| 6 | invite 잘못된 토큰 | "잘못된 초대 링크" |
| 7 | 설정에서 contact_email 입력 후 차단 화면 진입 | mailto 링크 표시 |

- [ ] **Step 15.5: 최종 정리 commit (변경사항이 더 있으면)**

```bash
git status
# 변경 사항 있으면:
git add -A
git commit -m "chore: 회귀 검증 후 잔여 정리"
```

---

## 완료 후

`superpowers:finishing-a-development-branch` skill을 사용해 다음 단계 (PR 생성 / main 머지 / cleanup) 결정.

---

## Self-Review 노트 (작성 시점 점검)

### Spec coverage 확인
- §2 Goals 6개 → Task로 매핑:
  - invite token hard block → Task 7 (checkTrackA) + Task 8 (server action) + Task 12 (page.tsx 통합)
  - 공개링크 신호 매칭 hard block → Task 7 (checkTrackB) + Task 8 + Task 12
  - raw IP 미저장 → Task 5 (DROP) + Task 6 (schema) + Task 10 (저장 코드 제거)
  - NAT 보호 → Task 7 알고리즘 + Task 9 nat-safe 테스트
  - 진행 중 응답 제외 → Task 7 (isNotNull(completedAt)) + Task 9 completed-only 테스트
  - soft delete hook → Task 4 (컬럼) + Task 5 (마이그) + Task 7 (조건) + Task 9 soft-delete 테스트
- §11 엣지케이스 → 통합 테스트로 대부분 커버. JS off / Tor / VPN 같은 환경 의존 케이스는 수동 검증.

### Placeholder 점검
- Task 6.3 "임시 주석 처리 + 미사용 import 제거" — 사용처별 구체 코드는 grep 결과에 따라 결정. 진짜 placeholder가 아니라 codebase 의존 step.
- Task 7.4 findContactByInviteToken 시그니처 확장 — 기존 SQL을 읽고 컬럼 추가하는 구체 작업. step은 명시.
- Task 10.4 createBlankResponse 사용처 ≥2면 패턴 적용 — 분기 명시.
- Task 13.1 settings panel store 갱신 방식 — 기존 panel 코드를 먼저 읽고 형태 맞추는 step.

### 타입 일관성
- `ClientSignals`, `ServerSignals`, `CheckResult`, `FirstAnswerResult` — Task 2, 7, 10에서 사용. 모두 동일 정의.
- `checkDuplicateOnEntry` 반환은 `CheckResult` (blocked/passed).
- `createResponseWithFirstAnswer` 반환은 `FirstAnswerResult` (created/blocked) — 차단 시 reason 포함.

### Out-of-scope (별도 plan)
- 응답 삭제·복구·수정 UI (spec §13)
- deviceId 기반 resume (spec §13)
- rate limiting / CAPTCHA (spec §2 Non-Goals)
