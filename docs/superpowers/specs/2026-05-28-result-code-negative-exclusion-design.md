# 결과코드 상태 (positive/neutral/negative) — 응답률·모집단 제외

- 날짜: 2026-05-28
- 위치: `/admin/surveys/[id]/operations/report` (Report 진척률), `/admin/surveys/[id]/operations/contacts/result-codes` (결과코드 설정), `/admin/surveys/[id]/operations/profiles` (응답자 목록), `/admin/surveys/[id]/operations/mail/campaigns/new` (단체메일), `/survey/[id]?invite=<token>` (응답 페이지)
- 관련 메모: `feedback_no_emoji_in_code.md`, `feedback_drizzle_migrate_journal.md`, `feedback_vitest_tests_dir_only.md`, `feedback_lint_infra_broken.md`, `feedback_no_worktree.md`, `feedback_git_commit_korean.md`
- 후속 슬라이스 가정: `project_operations_console_slice4_done.md` (Report 탭) · `project_operations_console_slice3_done.md` (컨택·이메일)

## 배경

현재 `/operations/report` 진척률 탭의 응답률은 **단순 비율**:

```
응답률 = completed_count / list_count
       = (is_completed=true ∪ result_code='1.조사완료') / 전체 contact_targets
```

이 정의에는 두 가지 운영 미스매치가 있다:

1. **분모가 모집단 그대로** — 사용자 운영 의도상 "전시회 미참가", "수신거부" 처리된 컨택은 조사 대상이 아니므로 분모에서 빠져야 응답률이 의미 있다.
2. **분자가 하드코딩** — `CLOSING_RESULT_CODES = ['1.조사완료']` 가 [report-progress.ts:15](../../../src/lib/operations/report-progress.ts#L15) 에 박혀 있어, 다른 코드를 완료로 인정할 수 없다. 코드 코멘트에도 `slice 6/7 ContactResultCode.isClosing 토글 도입 후 동적화` 라는 예고가 남아 있다.

또한 부정 처리된 컨택이 invite URL 로 응답 페이지에 진입하거나 단체메일 발송 대상에 포함되는 그레이존이 존재한다. 사용자 의도는 **그레이존 사전 봉쇄** — 부정 마킹된 컨택은 응답률·메일·응답 페이지 어디에서도 보이지 않게.

## 목표

- `ContactResultCode` 에 3-way 상태 enum (`positive` / `neutral` / `negative`) 추가
- `negative` 상태 코드의 효과 5가지 일괄 적용:
  1. 응답률 분자 제외
  2. 응답률 분모 제외
  3. 이미 들어온 응답 데이터를 Report·Profiles 탭에서 가림 (DB 보존, query 단계 필터)
  4. 단체메일 발송 대상에서 자동 제외
  5. invite URL 로 응답 페이지 진입 차단
- `unsubscribed_at` 컬럼 흐름과 자연 통합 (OR 결합)
- 기존 surveys 데이터 무손실 — 새 status 누락 시 fallback 동작

## 비목표

- Analytics 대시보드·차트 변경
- Export (CSV/SPSS) 변경
- 응답자 상세 페이지 (`/operations/profiles/[responseId]`) 차단 — 운영 디버깅 동선 보호 위해 link 접근은 유지 (헤더 배지만 추가)
- Contacts 탭 (`/operations/contacts`) 변경 — negative 컨택도 정상 표시
- 사용자 정의 surveys 자동 백필 — fallback 으로 무손실 보장하고, 명시 설정만 effective

## 디자인

### §1 데이터 모델

**스키마 타입** ([schema-types.ts:383-394](../../../src/db/schema/schema-types.ts#L383-L394)):

```ts
export type ResultCodeStatus = 'positive' | 'negative' | 'neutral';

export interface ContactResultCode {
  code: string;
  label: string;
  order: number;
  tone?: 'green' | 'amber' | 'rose' | 'blue' | 'slate';
  status?: ResultCodeStatus;  // 신규 — undefined === 'neutral'
}
```

**디폴트 13개 매핑** ([schema-types.ts:400-414](../../../src/db/schema/schema-types.ts#L400-L414)):

| 코드 | status |
|---|---|
| `1.조사완료` | `positive` |
| `수신거부` | `negative` |
| 나머지 11개 | 필드 생략 (= neutral) |

`status` 필드를 생략하는 이유: JSON 크기·diff 최소화 + 명시적으로 neutral 인 경우와 fallback 으로 neutral 인 경우의 구분 가능.

**JSONB 변경 없음**: `surveys.contact_result_codes` 컬럼 그대로. optional 필드 추가만이라 DDL 변경 0.

**제약**:
- `status === 'positive'` 인 코드 최소 1개 — UI validation 으로 차단 (없으면 분자가 0 이라 응답률 무의미)
- 한 surveys.contact_result_codes 안에 같은 status 여러 개 허용

### §2 응답률 계산

**현 상태** ([report-progress.server.ts:29-34](../../../src/lib/operations/report-progress.server.ts#L29-L34)):

```sql
-- closingFilter (분자) — 하드코딩
EXISTS(... sr.is_completed=true) OR EXISTS(... ca.result_code='1.조사완료')
-- 분모
COUNT(*)
```

**변경 후**:

```sql
-- closingFilter (분자) — positive codes 동적
EXISTS(... sr.is_completed=true AND sr.deleted_at IS NULL)
   OR EXISTS(... ca.result_code = ANY(${positiveCodes}))

-- excludeFilter (신규) — negative codes + unsubscribed_at OR
EXISTS(... ca.result_code = ANY(${negativeCodes}))
   OR ct.unsubscribed_at IS NOT NULL

-- 집계
SELECT
  ...
  COUNT(*)::int AS list_count_raw,
  COUNT(*) FILTER (WHERE ${excludeFilter})::int AS excluded_count,
  COUNT(*) FILTER (WHERE NOT ${excludeFilter})::int AS list_count,
  COUNT(*) FILTER (WHERE ${closingFilter}
                     AND NOT ${excludeFilter})::int AS completed_count
```

**의미**:
- `excludeFilter` 는 **any-time** — 한 회차라도 negative 코드 받으면 제외 (마지막 회차 추적 회피)
- excluded ct 는 분모·분자 모두에서 제거 (응답 완료해도 카운트 안 됨)
- `unsubscribed_at` 자동 negative 효과

**신규 헬퍼**:

```ts
// report-progress.server.ts 또는 별도 모듈
const getResultCodeStatuses = cache(async (surveyId: string): Promise<{
  positive: string[];
  negative: string[];
}> => {
  // surveys.contact_result_codes 조회. NULL 이면 DEFAULT_RESULT_CODES.
  // status === 'positive' / 'negative' 별로 code 추출.
  // backward compat: status 누락 + code === '1.조사완료' → positive.
});
```

**ProgressRow / ProgressTotals 확장**:
- `excludedCount: number` 추가 — 푸터/툴팁에서 "제외 Z건" 표시 가능
- `excludedTotal: number` 추가

**`report-progress.ts` 변경**:
- `CLOSING_RESULT_CODES` 상수 삭제 (코드 코멘트의 동적화 예고 해소)
- `toneFromRate`, `sortGroupRows` 그대로
- `computeTotals` 에 `excludedTotal` 누적 추가

### §3 응답 페이지 진입 가드 + 차단 UI

**기존 `AlreadyRespondedView` 컴포넌트 재활용** — 신규 컴포넌트 0개.

**`BlockReason` 타입 확장** ([duplicate-detection/types.ts:27-30](../../../src/lib/duplicate-detection/types.ts#L27-L30)):

```ts
export type BlockReason =
  | 'invalid_token'
  | 'token_already_used'
  | 'device_already_responded'
  | 'excluded_from_population';  // 신규
```

**MESSAGES 사전 항목 추가** ([already-responded-view.tsx:22-38](../../../src/components/survey/already-responded-view.tsx#L22-L38)):

```ts
excluded_from_population: {
  title: '이미 응답하신 설문입니다',
  body: '이 초대 링크로는 더 이상 응답을 받지 않습니다. 운영자에게 문의해 주세요.',
  tone: 'info',
},
```

카피는 `token_already_used` 와 의도적으로 유사 — PII/운영 보안 관점에서 콜센터 노트 추정 차단.

**진입 가드** — `lookupContactByInviteToken` 반환 확장:

```ts
type LookupResult =
  | { kind: 'valid'; contactTargetId: string }
  | { kind: 'excluded' }       // 신규
  | { kind: 'invalid' };        // 기존 무효 토큰
```

호출부에서 `kind === 'excluded'` → `<AlreadyRespondedView reason="excluded_from_population" ... />`.

**Race condition 가드**: `saveResponse`·`startResponse` server action 에서도 동일 체크 1회 더. excluded 면 `{ blocked: true, reason: 'excluded_from_population' }` 반환 → 클라이언트 동일 view 렌더.

**익명 응답 (토큰 없음)**: 그대로 허용. excludeFilter 평가 불가.

### §4 단체메일 발송 제외

**현 상태** ([campaigns.server.ts:355-359](../../../src/lib/operations/campaigns.server.ts#L355-L359)·[621-624](../../../src/lib/operations/campaigns.server.ts#L621-L624)):

```ts
// buildCandidateWhere
const parts = [
  eq(contactTargets.surveyId, surveyId),
  isNull(contactTargets.unsubscribedAt),
  HAS_EMAIL_PII,
];

// preflightRecipients 분기
if (r.unsubscribedAt !== null) unsubscribedIds.push(r.id);
else if (!r.hasEmail) emailMissingIds.push(r.id);
else validIds.push(r.id);
```

**변경 — 두 곳에 negative result code OR 조건 추가**:

```ts
// 신규 헬퍼 (모듈 private)
function buildNotExcludedByNegativeCode(negativeCodes: string[]): SQL {
  if (negativeCodes.length === 0) return sql`TRUE`;
  return sql`NOT EXISTS (
    SELECT 1 FROM contact_attempts ca
    WHERE ca.contact_target_id = "contact_targets"."id"
      AND ca.result_code = ANY(${negativeCodes})
  )`;
}

// buildCandidateWhere
const parts: SQL[] = [
  eq(contactTargets.surveyId, surveyId),
  isNull(contactTargets.unsubscribedAt),
  HAS_EMAIL_PII,
  buildNotExcludedByNegativeCode(negativeCodes),  // 신규
];
```

**`preflightRecipients` 분기 우선순위**: `unsubscribedAt → excludedByCode → !hasEmail → valid`

**`RecipientPreflightResult` 확장**: `excludedByCodeIds: string[]` 추가

**UI** ([campaign-wizard.tsx:442-444](../../../src/components/operations/mail-campaign/campaign-wizard.tsx#L442-L444)):
- 기존 "수신거부로 제외: N명" 옆에 "조사 대상 제외: N명" 추가
- 운영자 대상이라 PII 우려 없음 — 사유 구분 노출 OK

**도움말 텍스트** ([campaign-wizard.tsx:292](../../../src/components/operations/mail-campaign/campaign-wizard.tsx#L292)):

```
수신거부자(unsubscribed_at IS NOT NULL), 부정 결과코드(예: 수신거부) 마킹된
조사 대상, 이메일 누락 조사 대상은 자동으로 제외됩니다.
```

**`CampaignFilterSnapshot` 변경 없음** — snapshot 에 negative codes 박제 안 함. surveys.contact_result_codes 최신 상태를 매번 참조 (운영자가 negative 추가하면 즉시 반영).

### §5 Profiles 탭 필터링

**현 상태** ([profiles.server.ts:80-87](../../../src/lib/operations/profiles.server.ts#L80-L87)): `surveyResponses` 베이스, `row_number()` 매김.

**변경** — base subquery WHERE 에 excludeFilter NOT EXISTS 한 줄 추가:

```sql
WHERE survey_id = $1
  AND (deleted view 분기 — 기존)
  AND NOT EXISTS (
    SELECT 1 FROM contact_targets ct
    WHERE ct.id = survey_responses.contact_target_id
      AND (
        ct.unsubscribed_at IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM contact_attempts ca
          WHERE ca.contact_target_id = ct.id
            AND ca.result_code = ANY(${negativeCodes})
        )
      )
  )
```

**중요**:
- 익명 응답 (`contact_target_id IS NULL`) 자동 통과 — `NOT EXISTS` 가 익명에 대해 항상 true
- `idx` 자동 보정 — `row_number()` 가 base subquery 내부에서 매겨지므로 excluded 응답 빠지면 순번 재계산
- 휴지통 view 도 동일 적용 — 사용자 명시 "Report + Profiles 탭만" 따름

**`/operations/profiles/[responseId]` 상세 페이지**:
- 그대로 노출 — 운영 디버깅·복구 동선 보호
- 헤더에 inline 배지 추가: `"이 응답자는 부정 결과코드로 제외된 상태입니다"` (운영자 대상이라 구체 사유 노출 OK)

### §6 결과코드 에디터 UI

**현 5컬럼** ([result-codes-editor.tsx:148-154](../../../src/components/operations/contacts/result-codes-editor.tsx#L148-L154)) → **6컬럼** (색상 ↔ 액션 사이에 '상태' 추가)

| 순서 | 코드 | 라벨 | 색상 | 상태 | 액션 |
|---|---|---|---|---|---|
| ↑↓ | 1.조사완료 | 1.조사완료 | green ▼ | 긍정 ▼ | 삭제 |

**컨트롤**: shadcn `<Select>` 패턴 (색상과 일관).

| value | trigger 표시 |
|---|---|
| `positive` | (●green) 긍정 — 응답 완료로 인정 |
| `neutral` | (●slate) 중립 |
| `negative` | (●rose) 부정 — 모집단에서 제외 |

dot 은 `<span className="inline-block h-2 w-2 rounded-full bg-{green|slate|rose}-500" />` (이모지 금지 메모리 준수).

**Validation 추가** ([result-codes-editor.tsx:92-103](../../../src/components/operations/contacts/result-codes-editor.tsx#L92-L103)):

```ts
function validate(): string | null {
  // 기존: 빈 코드/라벨, 코드 중복
  if (!codes.some((c) => c.status === 'positive')) {
    return '긍정 상태(응답 완료) 코드가 최소 1개 필요합니다.';
  }
  return null;
}
```

**UI 가드**:
- 삭제 버튼: 마지막 positive 행 삭제 시 disabled + tooltip
- Select에서 positive → 다른 status 변경 시 다른 positive 코드 없으면 alert + 저장 시 validation 한 번 더

**도움말 텍스트** — 페이지 상단:

```
회차의 결과코드 라디오를 사용자 정의합니다.

· 긍정: 응답 완료로 인정 (응답률 분자)
· 중립: 응답률 분모에만 포함
· 부정: 모집단에서 완전 제외 — 응답률·단체메일·응답 페이지 모두에서 제거
```

### §7 백워드 호환·마이그레이션·테스팅

**JSONB 백워드 호환** (한 곳 캡슐화 — `getResultCodeStatuses`):
- status 누락 + code === `1.조사완료` → positive (fallback)
- 그 외 status 누락 → neutral
- 사용자가 빌더에서 한 번 저장 → status 명시 박힘 → fallback 우회

**운영 데이터 자동 백필 안 함** — "수신거부"를 다르게 명명한 survey 가 있으면 오매핑 위험. 사용자 명시 설정만 effective. Net 효과: 모든 기존 survey 는 무손실 (current 동작과 동일). negative 효과는 의도적 활성화 후 발동.

**DB 마이그레이션 — 인덱스 1개**:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_contact_attempts_target_result
  ON contact_attempts(contact_target_id, result_code);
```

memory `feedback_drizzle_migrate_journal.md` 따라 **Supabase MCP `apply_migration`** 으로 직접 적용 (drizzle 은 수동 SQL 파일 silent skip).

**영향 받지 않는 영역** (회귀 검증 포인트만):
- `/analytics` 대시보드·차트
- Export (CSV/SPSS)
- `/operations/contacts` 리스트/상세/업로드
- Mail templates, 발송 이력, recipients 목록 (preflight·후보 쿼리만 변경)
- `/unsubscribe/[token]` 페이지

**테스팅** (memory `feedback_lint_infra_broken.md`·`feedback_vitest_tests_dir_only.md`):

| 레이어 | 위치 | 대상 |
|---|---|---|
| Unit | `tests/unit/` | `getResultCodeStatuses` fallback, SQL 빌더 헬퍼 |
| Integration | `tests/integration/` | `getProgressRows`·`getProgressTotals`·`listResponsesForProfiles`·`preflightRecipients`·`lookupContactByInviteToken` 5개의 negative 적용 검증 |
| E2E | 생략 | manual smoke |

검증 명령: `pnpm tsc --noEmit && pnpm vitest run && pnpm build`

**운영 자동 흐름 (자연 결합)**:
- 콜센터 `result_code='수신거부'` 마킹 → contact_attempts row 추가 (기존)
- 메일 푸터 unsubscribe 링크 → `unsubscribed_at` 세팅 (기존)
- §2~§5 의 OR 조건이 자동으로 둘 다 동일한 negative 효과 부여
- 두 시스템 독립 유지 — 콜센터 마킹 시 `unsubscribed_at` 자동 세팅 하지 않음 (사용자 동의 기반 데이터 의미 보존)

**롤백**: 코드 revert 만으로 100%. JSONB 의 `status` 필드는 기존 코드가 ignore. 인덱스는 그대로 유지 (영향 0).

## 작업 크기 추정

slice 3 (24 commits) 보다 약간 작은 정도:

| 영역 | 예상 commits |
|---|---|
| §1 모델 + DEFAULT + fallback | 2 |
| §2 응답률 SQL + 헬퍼 | 3 |
| §3 응답 페이지 가드 + race | 2 |
| §4 메일 발송 제외 | 2 |
| §5 Profiles 필터 + 상세 배지 | 2 |
| §6 에디터 UI + validation | 2 |
| 인덱스 마이그레이션 + integration tests | 3-4 |

**합계**: 약 16-18 commits / 1.5~2일

## Risk

- **EXISTS subquery 성능** — `contact_attempts(contact_target_id, result_code)` 인덱스 필수. 적용 후 EXPLAIN ANALYZE 로 plan 확인.
- **fallback 의 의도하지 않은 매칭** — 사용자가 `1.조사완료` 코드를 다른 의미로 재정의한 경우 (예: `1.조사완료` 코드를 status=`negative` 로 명시) 의도대로 작동 (명시 status 가 fallback 우선). 단, status 누락 + 코드 그대로 재정의 케이스에서 fallback 발동 — 명시 status 박은 후 정상화.
- **운영 혼란** — UI 도움말에서 negative 효과 5가지 명확히 안내. 첫 negative 마킹 시 confirm dialog 도 검토 (별건).
- **차단 UI 의 PII 추정** — `excluded_from_population` 카피를 `token_already_used` 와 유사하게 통일하여 사유 추정 차단.

## Open Questions

- (없음 — 사용자 결정으로 모두 closed)

## 후속 슬라이스

- negative 마킹된 응답을 휴지통으로 자동 이동하는 옵션 (현재는 query 필터만)
- Profiles 상세 페이지에서 negative ct 의 응답 데이터 보기 모드 전환 (운영자가 분석 가치 있는 응답을 한 번에 볼 수 있게)
- Analytics 차트에서 negative 응답 제외 토글 (현재는 그대로 포함)
- Contacts 탭에서 negative 컨택 필터/배지 강조 (현재는 일반 result_code 와 동일 표시)
