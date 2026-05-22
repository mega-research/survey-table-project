# 분기 조건 — 외부 LUT 룩업 비교 + 좌변 1단계 산술 (Design)

- **Date**: 2026-05-22
- **Trigger**: "출장비 ÷ 출장인원 ≤ 개최대륙별 평균 항공요금" 형태의 표시 조건을 빌더에서 표현 불가
- **Scope**: displayCondition (문항/그룹/테이블 행/테이블 열) 에서 셀값 산술 1단계 + 외부 LUT 룩업 우변 지원
- **Related memory**: `project_display_condition_arithmetic_future` (L1~L5 스펙트럼 — 이번에 L4 도입 + L5 1단계 한정), `project_contact_attrs_token_done` (attrs 토큰 시스템 시드 재사용)
- **Related spec**: `2026-05-21-display-condition-numeric-comparison-design.md` (L2 — 동일 `NumericComparison` 타입 확장)

---

## 배경

현재 [src/utils/branch-logic.ts:20-37](../../../src/utils/branch-logic.ts#L20-L37) 의 `evaluateNumericComparison` 은 다음만 지원한다.

- 좌변: 현재 평가 중인 단일 input 셀 (`cellValue: string`)
- 우변: 리터럴 (`comparand.kind === 'literal'`) 만, 그 외 `return false`

실제 운영 케이스 — 전시회 참가 출장비 후속 질문 3-6-2 ("개최 지역 평균 최저 항공요금보다 출장비가 적은 경우 응답") — 는 두 가지가 부족하다.

1. **좌변 산술**: 1인당 출장비 = `Q3.출장비_셀 ÷ Q3.출장인원_셀`
2. **우변 LUT 룩업**: 컨택의 `attrs.개최대륙` 키로 외부 룩업 테이블에서 "2026년도 적용액" 가져오기

산업 관행상 빌더에 수식을 넣는 사례는 드물지만 (Google Forms / SurveyMonkey / Typeform 모두 분기에 수식 없음), 이 케이스는 **응답률 + 데이터 품질 + 운영 효율** 세 측면 모두에 영향이 커서 응답 시점 평가가 정당화된다. 다만 L5 폭증을 막기 위해 산술은 **1단계 binop만** 허용한다.

---

## 결정 사항 (Decisions)

### D1. `NumericComparison` 타입 확장 — 좌변 LeftOperand, 우변 RightOperand

기존 discriminated union 구조를 자연 확장.

```ts
type CellRef = { kind: 'cell'; questionId: string; cellId: string };

type LeftOperand =
  | CellRef
  | {
      kind: 'binop';
      op: '+' | '-' | '*' | '/';
      left: CellRef;
      right: CellRef | { kind: 'literal'; value: number };
    };

type RightOperand =
  | { kind: 'literal'; value: number }                            // L2 (기존)
  | {
      kind: 'lookup';                                              // L4 (신규)
      surveyLookupId: string;
      keyMapping: Array<{ lutKey: string; attrsKey: string }>;
    };

type NumericComparison = {
  left: LeftOperand;
  op: '==' | '!=' | '<' | '<=' | '>' | '>=';
  right: RightOperand;
};
```

**산술 제약 (L5 폭증 방지):**
- binop 깊이 = 1 만. `(a / b) / c` 같은 중첩 불가.
- 0 으로 나누기 → 평가 결과 `null` → fail-safe SHOW.
- `parseNumericInput` 실패 → `null` → fail-safe SHOW.
- 두 셀이 같은 질문 / 다른 질문 모두 OK.

### D2. LUT 보관함 (Copy 모델, `saved_questions` 패턴)

신규 테이블 `saved_lookups`:

```ts
{
  id: uuid,
  name: text,                       // "지역별 평균 항공비 2026"
  description: text,
  category: text,                   // demographics | finance | reference | custom
  tags: text[],
  keyColumns: text[],               // ["대륙"] — 복합 키 지원 (length >= 1)
  valueColumn: text,                // "2026년도 적용액" — 1개 고정
  rows: jsonb,                      // Array<Record<string, string | number>>
  usageCount: int,
  isPreset: boolean,
  createdAt, updatedAt
}
```

**Copy 흐름:** 보관함에서 "이 설문에 불러오기" → `surveys.lookups[]` 에 새 nanoid + `sourceSavedLookupId` 부여 push, `usageCount += 1`. 이후 독립 사본.

### D3. `surveys.lookups` jsonb 컬럼

```ts
type SurveyLookup = {
  id: string;                       // 설문 안에서 unique (nanoid)
  name: string;
  sourceSavedLookupId?: string;
  keyColumns: string[];
  valueColumn: string;
  rows: Array<Record<string, string | number>>;
};
```

**Snapshot 처리:** `snapshot-builder.ts` 에 `lookups` 필드 추가. publish 시점에 LUT 내용까지 freeze. 빌더 LUT 수정해도 진행 중 응답 세션 영향 0. 메모 `survey_save_explicit_fields` 따라 `survey-save-actions.ts` 6~7곳 explicit field set 점검 필수.

### D4. 보관함 패널 안에 LUT 섹션 (별도 진입점 없음)

기존 `question-library-panel.tsx` 하단에 LUT 섹션을 컴포지션 추가. 시각 구분선으로 분리.

```
+ 질문 생성    |    보관함
─────────────────────────────
[질문 검색…]

▷ 인구통계   0
▷ 만족도     0
▷ NPS        0
▷ 피드백     0
▷ 선호도     0
▷ 사용자정의 6
─────────────────────  ← 구분선
외부 데이터
▷ 재무 참조 LUT     3
▷ 인구통계 LUT      2
▷ 사용자 정의 LUT   0
[+ 새 LUT 만들기]
─────────────────────
⬇ 내보내기 / 가져오기
```

- 검색창은 질문 + LUT 둘 다 검색 (결과 섹션별 그룹).
- LUT 항목 hover: "미리보기 / 이 설문에 불러오기".
- 엑셀/CSV 업로드는 "+ 새 LUT 만들기" 다이얼로그 안 옵션으로 흡수 (별도 진입점 X).
- 내보내기/가져오기 (기존 버튼) 는 질문 + LUT 둘 다 포함하도록 확장.

### D5. LUT 편집 UI — 인라인 테이블 + 엑셀 붙여넣기 + CSV 업로드

- 셀 더블클릭 편집.
- 엑셀 영역 paste → `\t` / `\n` 파싱 → 행 자동 채움.
- 행 데이터 타입: 키 컬럼은 trim 후 `string`, 값 컬럼은 `parseNumericInput` 으로 `number` 변환. 파싱 실패 시 inline error + 저장 차단.
- `rows` jsonb 저장 시 키 컬럼 값은 string, 값 컬럼 값은 number 로 직렬화 (혼합 타입 방지).
- CSV/엑셀 파일 업로드: 4-step 다이얼로그 (파일 선택 → 첫 시트 헤더 인식 → 키/값 컬럼 매핑 → 인라인 테이블 자동 채움). 컨택 업로드 마법사 같은 무거운 흐름은 안 만듦.

### D6. 빌더 조건 에디터 UX

기존 displayCondition 카드에서 좌변/우변 둘 다 토글 가능.

```
좌변:
  ( ) 단일 셀
  (●) 셀 ÷/×/+/- 셀 (또는 숫자)
     셀 A: [Q3 > 3-6 출장비 ▼]
     연산:  [ ÷ ▼]
     셀 B: [Q3 > 3-2 출장인원 ▼]

비교:  [ ≤ ▼]

우변:
  ( ) 직접 입력 값  [        ]
  (●) 외부 데이터 룩업
     LUT: [지역별 평균 항공비 2026 ▼]
          [보관함 열기] [새 LUT 만들기]
     키 매핑:
       LUT 키 「대륙」 ← 컨택 속성 [개최대륙 ▼]
     비교 대상: 「2026년도 적용액」

미리보기:
  (Q3.3-6_출장비 ÷ Q3.3-2_출장인원)
    ≤ lookup({ 대륙: attrs.개최대륙 }).2026년도_적용액
```

**키 매핑:** 우측 `attrsKey` 셀렉터는 `surveys.contactColumns` 정의된 키 목록을 dropdown 으로 노출. dropdown 하단에 "직접 입력" 옵션이 있어 운영자가 임의 문자열 (예: 아직 컨택 컬럼에 등록 안 한 키) 을 적을 수 있음. 등록 안 된 키를 적은 경우 빌더 inline warning ("컨택 컬럼에 없는 키입니다. 응답 시 attrs 에 이 키가 없으면 fail-safe SHOW 됩니다") 표시 + 저장은 허용.

**검증 (저장 차단):**
- LUT 미선택
- 키 매핑 미완성 (LUT keyColumns.length ≠ keyMapping.length)
- binop 좌변일 때 셀 A·B 미지정

### D7. Fail-safe 정책

룩업/산술 실패 시 항상 SHOW (응답 누락 방지).

**실패 케이스:**
1. invite 없는 익명 응답 → contactAttrs 자체 없음
2. attrs 키 비어있음
3. attrs 값이 LUT 행에 없음
4. LUT 미등록
5. 셀값 파싱 실패
6. 0 으로 나누기

**응답자 화면:** 사유 표시 없이 그냥 SHOW.

**빌더 테스트 모드:** 평가 사유 inline 디버그 패널 노출.

```
컨택: 컨택42 (attrs.개최대륙=유럽)
응답: Q3.3-6=1000000원, Q3.3-2=2명

✅ 조건 1 충족 → 3-6-2 표시
  좌변: 1000000 ÷ 2 = 500000
  우변: lookup(대륙=유럽).2026년도_적용액 = 2470000
  500000 ≤ 2470000 → TRUE
```

```
⚠ 조건 1 평가 불가 → fail-safe 로 3-6-2 표시
  사유: attrs.개최대륙 비어있음
  (실제 응답자에게는 이 안내가 표시되지 않습니다)
```

### D8. 권한

- `saved_lookups`: `saved_questions` 와 동일 정책 따름
- `surveys.lookups`: 설문 owner

---

## 아키텍처

### 자료 흐름 (응답자 입장)

```
응답 페이지 진입 (?invite=<token>)
  ↓
snapshot 로드 (snapshot.lookups 포함)
  ↓
ContactAttrsProvider 가 attrs prefill (기존)
  ↓
셀 입력값 변경 → displayCondition 평가
  ↓
evaluateComparisonWithFailSafe(comparison, ctx)
   ctx = { responses, contactAttrs, lookups }
  ↓
좌변 계산:
  - CellRef → responses[questionId][cellId] → parseNumericInput
  - binop → 양쪽 계산 후 op 적용. 0 나누기·NaN → null
우변 계산:
  - literal → 그대로
  - lookup → keyMapping 으로 keys 만들고 lookups[surveyLookupId].rows 에서 행 찾기
    · 행 못 찾음 → null
    · attrs 비어있음 → null
  ↓
left/right 중 null → result = 'show' (fail-safe), reason 동봉
둘 다 숫자 → op 비교 결과 boolean
  ↓
응답자 페이지: result 만 사용
빌더 테스트 모드: result + reason 표시
```

### 신규 / 수정 파일 경계

**신규:**

| 파일 | 역할 |
|---|---|
| `src/lib/lookup/evaluate-arith.ts` | 좌변 1단계 binop 평가 (pure) |
| `src/lib/lookup/evaluate-lookup.ts` | 우변 LUT 룩업 (pure) |
| `src/lib/lookup/lookup-row-matcher.ts` | keyMapping → LUT row 찾기 (pure) |
| `src/lib/lookup/evaluate-comparison.ts` | 위 셋 결합 + fail-safe 판정 (pure) |
| `src/actions/lookup-actions.ts` | `saved_lookups` / `surveys.lookups` CRUD + Copy |
| `src/components/survey-builder/lookup-library-section.tsx` | 보관함 패널의 LUT 섹션 |
| `src/components/survey-builder/lookup-edit-modal.tsx` | LUT 인라인 편집 (테이블 + 붙여넣기) |
| `src/components/survey-builder/lookup-csv-import.tsx` | 엑셀/CSV 업로드 다이얼로그 |
| `src/components/survey-builder/lookup-comparand-editor.tsx` | 우변 LUT 룩업 설정 |
| `src/components/survey-builder/lookup-selector.tsx` | 설문 LUT 드롭다운 + 인라인 등록 |
| `src/components/survey-builder/lookup-key-mapping-editor.tsx` | LUT 키 ↔ attrs 키 매핑 |
| `src/components/survey-builder/left-operand-editor.tsx` | 좌변 단일셀/binop 토글 |
| `src/components/survey-builder/condition-debug-panel.tsx` | 테스트 모드 평가 사유 |
| `src/components/survey-builder/sample-contact-selector.tsx` | 테스트 모드 sample 컨택 |

**수정:**

| 파일 | 변경 |
|---|---|
| `src/types/survey.ts` | `LeftOperand`, `RightOperand`, `SurveyLookup`, `SavedLookup` 타입 |
| `src/db/schema/surveys.ts` | `saved_lookups` 테이블 + `surveys.lookups` jsonb 컬럼 |
| `src/utils/branch-logic.ts` | `evaluateNumericComparison` 시그니처 일반화, L4/L5 평가는 `lib/lookup/` 에 위임 |
| `src/components/survey-builder/numeric-comparison-editor.tsx` | 좌변/우변 토글, body 는 분리된 sub-component 위임 |
| `src/components/survey-builder/question-library-panel.tsx` | `<LookupLibrarySection />` 컴포지션 |
| `src/actions/survey-save-actions.ts` | `lookups` explicit field set 6~7곳 |
| `src/lib/survey/snapshot-builder.ts` | snapshot 에 `lookups` 포함 |

### Migration

- Supabase MCP `apply_migration` 으로 직접 적용 (메모 `drizzle_migrate_journal` — `pnpm db:migrate` 는 `_journal.json` 외 SQL 무시).
- 신규 테이블 + 신규 컬럼 default `'[]'`.

---

## 테스트 전략

### Unit (pure functions)

`tests/unit/lib/lookup/` 디렉토리 (메모 `vitest_tests_dir_only` — `tests/` 디렉토리만 include).

| 테스트 | 케이스 |
|---|---|
| `evaluate-arith.test.ts` | 정상 / 0 나누기 / NaN / 빈 셀 / 셀 참조 누락 / 정수·실수 / 단일 셀 |
| `evaluate-lookup.test.ts` | 단일 키 / 복합 키 / 행 없음 / attrs 빈 키 / 키 매핑 누락 / 값 컬럼 누락 |
| `lookup-row-matcher.test.ts` | 정확 매칭 / 공백 trim / 대소문자 (정책: 정확 매칭) |
| `evaluate-comparison.test.ts` | fail-safe SHOW 전파 / 6가지 연산자 / left null / right null |

### Integration

`tests/integration/`:
- `lookup-actions.test.ts` — server actions CRUD + Copy 흐름
- `display-condition-with-lookup.test.ts` — snapshot 로드 → 평가 end-to-end

### Builder UI

- e2e 없이 unit + 수동 테스트.
- 검증 명령: `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build` (메모 `lint_infra_broken` — ESLint 깨짐).

---

## 단계별 implementation phase 후보

| Phase | 범위 | 의존 |
|---|---|---|
| 1 | DB schema (`saved_lookups` + `surveys.lookups`) + types + migration | - |
| 2 | Pure evaluator (`lib/lookup/*` TDD) | 1 |
| 3 | Server actions (CRUD + Copy) | 1 |
| 4 | 보관함 UI (LookupLibrarySection + edit modal + CSV import) | 3 |
| 5 | 조건 에디터 UI (left-operand + lookup-comparand + key-mapping) | 2, 3 |
| 6 | `branch-logic.ts` 통합 + `snapshot-builder` + `survey-save-actions` explicit fields | 2 |
| 7 | 테스트 모드 디버그 패널 + sample contact selector | 6 |
| 8 | 통합 검증 (TDD test all + 수동 응답 페이지 검증) | 6, 7 |

---

## Out of scope (이번 작업 제외)

- 2단계 이상 산술 중첩 (`(a/b)/c` 같은). 본격 L5 영역.
- LUT Reference 모델 (보관함 수정이 참조 설문에 자동 반영). 메모 `display_condition_arithmetic_future` 기준 Copy 모델만.
- 분기 규칙 (BranchRule) — 이번은 displayCondition 만. Branch 적용은 후속 트랙.
- saved_lookups 의 카테고리 관리 UI 자체. `question_categories` 패턴 그대로 차용하되 1차 도입은 preset 카테고리 + 사용자 정의 1개로 시작.
- 다국어 LUT 키.
- LUT 키 fuzzy matching (대소문자 무시, 부분 일치). 1차는 trim 후 정확 매칭만.
- 빌더 미리보기에 sample 컨택 셀렉터는 이번에 같이 도입 (메모 `contact_attrs_token_done` follow-up 항목 흡수).
