# 옵션 단위 텍스트 입력 (Option Text Input) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Question-level `allowOtherOption` 토글을 옵션-단위 `allowTextInput` 플래그로 평탄화. 모든 옵션이 선택 시 텍스트 입력을 받을 수 있도록 일반화. 기존 production 데이터(설문/snapshot/응답) 자동 마이그레이션 포함.

**Architecture:**
- `QuestionOption` / `CheckboxOption` / `RadioOption` 에 `allowTextInput?: boolean` 추가
- 응답 JSONB 에 sidecar `optionTexts?: Record<optionId, string>` 맵 추가 (기존 `otherInputs[]` 대체)
- TS 마이그레이션 스크립트로 기존 `allowOtherOption=true` → 마지막에 `{label:"기타", allowTextInput:true}` 옵션 append + 응답 데이터 변환
- SPSS export: `{questionVar}_{변수번호}_text` STRING 변수 자동 생성
- 빌더 UI: "기타 옵션 추가" 토글 제거, "+ 텍스트 옵션 추가" 버튼으로 대체. 일단 만든 옵션의 텍스트 입력 여부는 후속 토글로 변경 불가 (삭제 후 재생성)
- 응답 페이지: 선택해제 시 텍스트 유지, 제출 시점에 미선택 옵션 텍스트 drop
- ranking (`__other__` 매직값) + table cell `allowOtherOption` 모두 동일 패턴으로 migration

**Migration strategy:** 단일 PR (사용자 결정). 마이그레이션 → DDL DROP 컬럼 → 코드 제거 한꺼번에. 마이그레이션 스크립트는 idempotent + dry-run 옵션 제공. 적용 순서: 코드 배포 (이중 호환) → 마이그레이션 실행 → 다음 코드 배포 (구코드 제거) — 단 사용자가 "한 PR" 을 원하므로 이중 호환 레이어 없이, 마이그레이션과 코드를 한 번에 적용. **롤백 시나리오:** 마이그레이션 실행 전 surveys/snapshots/responses 의 백업 SQL 덤프 권장.

**Tech Stack:** Next.js 15, TypeScript (strict), Drizzle ORM, PostgreSQL (Supabase), Vitest, React Hook Form + Zod, shadcn/ui, TanStack Query/Table, Zustand

**Branch:** `feat/option-text-input` (이미 생성됨, main 기준)

**필독 메모리 (작업 중 준수):**
- `feedback_no_emoji_in_code.md` — 코드/주석/로그/UI 라벨 어디든 이모지 금지
- `feedback_git_commit_korean.md` — 커밋 메시지 `feat: OOO 기능 추가` 형식, 괄호 () 금지
- `feedback_drizzle_migrate_journal.md` — drizzle migrate 는 `_journal.json` 만 따라감. 수동 SQL 파일은 silent skip. → Supabase MCP `apply_migration` 또는 직접 SQL 사용
- `feedback_truncate_cascade_금지.md` — TRUNCATE CASCADE 금지. DELETE FROM + 수동 NULL 처리 패턴
- `feedback_survey_save_explicit_fields.md` — `survey-save-actions.ts` 는 spread 안 쓰고 explicit field set. 신규 필드 추가 시 6-7곳 explicit 점검 필수
- `feedback_vitest_tests_dir_only.md` — vitest 는 `tests/` 디렉토리만 include. `src/` 옆 `*.test.ts` 는 silent skip
- `project_response_page_snapshot_based.md` — 응답 페이지는 snapshot 기반. 빌더 변경은 publish 전까지 미반영

---

## File Structure Overview

### 신규 파일
| 경로 | 책임 |
|---|---|
| `src/lib/option-text-migration.ts` | 순수 변환 함수들 (테스트 가능) |
| `scripts/migrate-option-text.ts` | 마이그레이션 runner (dry-run + apply 모드) |
| `tests/integration/option-text-migration.test.ts` | 변환 함수 unit test |
| `tests/integration/option-text-response.test.ts` | 응답 데이터 변환 통합 test |
| `supabase/migrations/{next_number}_drop_allow_other_option.sql` | DDL — `allow_other_option` 컬럼 DROP |

### 수정 파일 (대략 25-30 파일)

**타입 / 스키마:**
- `src/types/survey.ts`
- `src/db/schema/surveys.ts`
- `src/db/schema/schema-types.ts`

**빌더 UI:**
- `src/components/survey-builder/question-basic-tab.tsx` ("기타 옵션 추가" 토글 제거 + "+ 텍스트 옵션 추가" 버튼 추가)
- `src/components/survey-builder/question-option-helpers.ts`
- `src/components/survey-builder/ranking-config-editor.tsx`
- `src/components/survey-builder/cell-content-modal.tsx`
- `src/components/survey-builder/cells/radio-cell.tsx`
- `src/components/survey-builder/cells/checkbox-cell.tsx`
- `src/components/survey-builder/cells/select-cell.tsx`
- `src/components/survey-builder/cells/ranking-cell.tsx`

**응답 페이지:**
- `src/components/survey-response/question-input.tsx`
- `src/components/survey-response/radio-input.tsx` (또는 동등 파일)
- `src/components/survey-response/checkbox-input.tsx`
- `src/components/survey-response/select-input.tsx`
- `src/components/survey-response/ranking-input.tsx`
- 테이블 셀 응답 컴포넌트들 (있다면)

**스토어 / 액션:**
- `src/stores/survey-response-store.ts` (응답 상태 관리)
- `src/server/actions/survey-save-actions.ts` (explicit field 추가)

**Snapshot / 버전관리:**
- `src/lib/versioning/snapshot-builder.ts`

**Export / Analytics:**
- `src/lib/spss/spss-syntax-generator.ts`
- `src/lib/analytics/spss-excel-export.ts`
- `src/lib/excel-transformer.ts`
- `src/lib/analytics/cleaning-export-format.ts`

### 삭제 대상 코드 (cleanup phase)
- `Question.allowOtherOption` 필드
- `TableCell.allowOtherOption` 필드
- `QuestionOption.hasOther` / `CheckboxOption.hasOther` / `RadioOption.hasOther`
- `OtherInputValue` 타입 + `SurveyResponse.otherInputs[]`
- `RankingAnswer.optionValue: '__other__'` 매직값 처리 (실제 옵션 ID 로 대체됨)
- `TableCell.isOtherRankingCell` (불필요해짐)

---

## Phase 1: Foundation — Types & Migration Utilities

### Task 1: 타입 확장 — `allowTextInput` 필드 추가

**Files:**
- Modify: `src/types/survey.ts:112-122` (QuestionOption), `:197-208` (CheckboxOption), `:210-221` (RadioOption)

- [ ] **Step 1: `QuestionOption` 에 `allowTextInput` 추가**

`src/types/survey.ts` 의 `QuestionOption` 인터페이스 수정 (`hasOther` 는 cleanup phase 까지 남겨둠 — 제거 시 dependent 코드 깨짐):

```ts
export interface QuestionOption {
  id: string;
  label: string;
  value: string;
  optionCode?: string;
  spssNumericCode?: number;
  isCustomOptionCode?: boolean;
  /**
   * 선택 시 사이드카 텍스트 입력 받기.
   * 빌더의 "+ 텍스트 옵션 추가" 버튼으로 생성된 옵션은 true.
   * SPSS export 시 `{questionVar}_{변수번호}_text` 라는 STRING 변수가 자동 생성됨.
   */
  allowTextInput?: boolean;
  /** @deprecated Phase 7 cleanup 에서 제거. allowTextInput 사용. */
  hasOther?: boolean;
  branchRule?: BranchRule;
}
```

- [ ] **Step 2: `CheckboxOption` 과 `RadioOption` 에도 동일 필드 추가** (위와 동일 패턴)

- [ ] **Step 3: TypeScript 컴파일 확인**

Run: `pnpm tsc --noEmit`
Expected: PASS (필드만 추가했으므로 기존 코드 영향 없음)

- [ ] **Step 4: 커밋**

```bash
git add src/types/survey.ts
git commit -m "feat: QuestionOption 타입에 allowTextInput 필드 추가"
```

---

### Task 2: 응답 데이터 타입 확장 — `optionTexts` sidecar

**Files:**
- Modify: `src/types/survey.ts:375-379` (SurveyResponse)

- [ ] **Step 1: `SurveyResponse` 에 `optionTexts` 추가**

```ts
// 설문 응답데이터 타입 (단일 질문 응답)
export interface SurveyResponse {
  questionId: string;
  value: string | string[] | { [key: string]: string | string[] | object };
  /**
   * 옵션 단위 사이드카 텍스트 입력.
   * key = optionId, value = 사용자가 입력한 텍스트.
   * 응답 제출 시점에 "선택된" 옵션의 텍스트만 남기고 나머지는 drop (filterOptionTextsForSubmission).
   */
  optionTexts?: Record<string, string>;
  /** @deprecated Phase 7 cleanup. optionTexts 사용. 마이그레이션 호환용. */
  otherInputs?: OtherInputValue[];
}
```

- [ ] **Step 2: `RankingAnswer` 에 `optionText` 추가**

```ts
export interface RankingAnswer {
  rank: number;
  optionValue: string;
  /** @deprecated Phase 7. optionText 사용. '__other__' 매직값은 마이그레이션에서 실제 옵션 ID 로 변환됨. */
  otherText?: string;
  /** allowTextInput 옵션이 이 순위에 선택된 경우 사용자가 입력한 텍스트 */
  optionText?: string;
}
```

- [ ] **Step 3: TypeScript 컴파일 확인**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add src/types/survey.ts
git commit -m "feat: SurveyResponse 와 RankingAnswer 에 optionTexts 사이드카 필드 추가"
```

---

### Task 3: 마이그레이션 유틸리티 — failing test 먼저 (TDD)

**Files:**
- Create: `tests/integration/option-text-migration.test.ts`
- Create: `src/lib/option-text-migration.ts`

- [ ] **Step 1: failing test 작성**

`tests/integration/option-text-migration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  migrateQuestionOptions,
  migrateResponseValue,
  generateOtherOptionFields,
  type LegacyQuestionShape,
  type LegacyResponseShape,
} from '@/lib/option-text-migration';

describe('migrateQuestionOptions', () => {
  it('appends 기타 option when allowOtherOption=true and 5 options exist', () => {
    const question: LegacyQuestionShape = {
      id: 'q1',
      allowOtherOption: true,
      options: [
        { id: 'o1', label: '선택1', value: '1', optionCode: '1', spssNumericCode: 1 },
        { id: 'o2', label: '선택2', value: '2', optionCode: '2', spssNumericCode: 2 },
        { id: 'o3', label: '선택3', value: '3', optionCode: '3', spssNumericCode: 3 },
        { id: 'o4', label: '선택4', value: '4', optionCode: '4', spssNumericCode: 4 },
        { id: 'o5', label: '선택5', value: '5', optionCode: '5', spssNumericCode: 5 },
      ],
    };

    const result = migrateQuestionOptions(question);

    expect(result.allowOtherOption).toBeUndefined();
    expect(result.options).toHaveLength(6);
    expect(result.options[5]).toMatchObject({
      label: '기타',
      allowTextInput: true,
      optionCode: '6',
      spssNumericCode: 6,
    });
    expect(result.options[5].id).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(result.migratedOtherOptionId).toBe(result.options[5].id);
  });

  it('zero-pads optionCode when total options >= 10', () => {
    const question: LegacyQuestionShape = {
      id: 'q2',
      allowOtherOption: true,
      options: Array.from({ length: 10 }, (_, i) => ({
        id: `o${i + 1}`,
        label: `선택${i + 1}`,
        value: String(i + 1),
        optionCode: String(i + 1).padStart(2, '0'),
        spssNumericCode: i + 1,
      })),
    };

    const result = migrateQuestionOptions(question);

    expect(result.options).toHaveLength(11);
    expect(result.options[10].optionCode).toBe('11');
    expect(result.options[10].spssNumericCode).toBe(11);
  });

  it('does not modify questions without allowOtherOption', () => {
    const question: LegacyQuestionShape = {
      id: 'q3',
      allowOtherOption: false,
      options: [
        { id: 'o1', label: '선택1', value: '1', optionCode: '1', spssNumericCode: 1 },
      ],
    };

    const result = migrateQuestionOptions(question);

    expect(result.options).toHaveLength(1);
    expect(result.migratedOtherOptionId).toBeNull();
  });

  it('is idempotent — running twice produces same shape', () => {
    const question: LegacyQuestionShape = {
      id: 'q4',
      allowOtherOption: true,
      options: [{ id: 'o1', label: '선택1', value: '1', optionCode: '1', spssNumericCode: 1 }],
    };

    const first = migrateQuestionOptions(question);
    const second = migrateQuestionOptions({ ...first, allowOtherOption: undefined });

    expect(second.options).toHaveLength(first.options.length);
    expect(second.migratedOtherOptionId).toBeNull();
  });
});

describe('migrateResponseValue', () => {
  it('converts otherInputs[] to optionTexts map when matching optionId provided', () => {
    const legacyResponse: LegacyResponseShape = {
      questionId: 'q1',
      value: ['o4', '__other__'],
      otherInputs: [{ optionId: '__other__', inputValue: '기타 사유' }],
    };

    const result = migrateResponseValue(legacyResponse, { '__other__': 'new-other-id' });

    expect(result.optionTexts).toEqual({ 'new-other-id': '기타 사유' });
    expect(result.otherInputs).toBeUndefined();
    expect(result.value).toEqual(['o4', 'new-other-id']);
  });

  it('converts ranking __other__ entries to real optionId + optionText', () => {
    const legacyResponse: LegacyResponseShape = {
      questionId: 'q5',
      value: [
        { rank: 1, optionValue: 'o2' },
        { rank: 2, optionValue: '__other__', otherText: '내가 적은 거' },
      ],
    };

    const result = migrateResponseValue(legacyResponse, { '__other__': 'new-other-id' });

    expect(result.value).toEqual([
      { rank: 1, optionValue: 'o2' },
      { rank: 2, optionValue: 'new-other-id', optionText: '내가 적은 거' },
    ]);
  });

  it('preserves non-other responses untouched', () => {
    const legacyResponse: LegacyResponseShape = {
      questionId: 'q1',
      value: ['o1', 'o2'],
    };

    const result = migrateResponseValue(legacyResponse, {});

    expect(result.value).toEqual(['o1', 'o2']);
    expect(result.optionTexts).toBeUndefined();
  });
});

describe('generateOtherOptionFields', () => {
  it('generates next sequential codes when 5 options exist', () => {
    const result = generateOtherOptionFields(5);
    expect(result).toEqual({
      optionCode: '6',
      spssNumericCode: 6,
      variableNumber: '6',
    });
  });

  it('zero-pads when 10+ options exist', () => {
    const result = generateOtherOptionFields(10);
    expect(result).toEqual({
      optionCode: '11',
      spssNumericCode: 11,
      variableNumber: '11',
    });
  });

  it('handles single-digit boundary correctly', () => {
    const result = generateOtherOptionFields(9);
    expect(result).toEqual({
      optionCode: '10',
      spssNumericCode: 10,
      variableNumber: '10',
    });
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `pnpm vitest run tests/integration/option-text-migration.test.ts`
Expected: FAIL — `Cannot find module '@/lib/option-text-migration'`

---

### Task 4: 마이그레이션 유틸리티 — 구현

**Files:**
- Create: `src/lib/option-text-migration.ts`

- [ ] **Step 1: 구현 작성**

`src/lib/option-text-migration.ts`:

```ts
import { nanoid } from 'nanoid';
import type { QuestionOption, RankingAnswer } from '@/types/survey';

export interface LegacyQuestionShape {
  id: string;
  allowOtherOption?: boolean;
  options?: QuestionOption[];
}

export interface MigratedQuestionShape extends LegacyQuestionShape {
  migratedOtherOptionId: string | null;
}

export interface LegacyResponseShape {
  questionId: string;
  value: unknown;
  otherInputs?: Array<{ optionId: string; inputValue: string }>;
  optionTexts?: Record<string, string>;
}

export interface MigratedResponseShape {
  questionId: string;
  value: unknown;
  optionTexts?: Record<string, string>;
  otherInputs?: undefined;
}

/**
 * 옵션 개수가 N 개일 때 추가될 "기타" 옵션의 코드/변수번호 생성.
 * 10 개 이상이면 zero-pad 컨벤션은 기존 옵션들이 따르고 있을 것으로 가정 (그대로 다음 숫자).
 */
export function generateOtherOptionFields(existingOptionCount: number): {
  optionCode: string;
  spssNumericCode: number;
  variableNumber: string;
} {
  const nextNumber = existingOptionCount + 1;
  return {
    optionCode: String(nextNumber),
    spssNumericCode: nextNumber,
    variableNumber: String(nextNumber),
  };
}

/**
 * 질문의 allowOtherOption=true 를 마지막 옵션 append 로 변환.
 * idempotent: allowOtherOption 이 falsy 면 변환 안 함.
 * 반환된 객체는 새 객체 (입력 미변경).
 */
export function migrateQuestionOptions<T extends LegacyQuestionShape>(
  question: T,
): T & MigratedQuestionShape {
  if (!question.allowOtherOption) {
    return { ...question, migratedOtherOptionId: null };
  }

  const existing = question.options ?? [];
  const fields = generateOtherOptionFields(existing.length);
  const newOption: QuestionOption = {
    id: nanoid(10),
    label: '기타',
    value: fields.optionCode,
    optionCode: fields.optionCode,
    spssNumericCode: fields.spssNumericCode,
    allowTextInput: true,
  };

  return {
    ...question,
    allowOtherOption: undefined,
    options: [...existing, newOption],
    migratedOtherOptionId: newOption.id,
  };
}

/**
 * 단일 응답을 새 shape 로 변환.
 * - otherInputs[] → optionTexts: Record<id, string>
 * - ranking 의 '__other__' → 실제 옵션 ID + optionText
 * - mapping: { 기존 otherOption ID → 마이그레이션된 새 옵션 ID }
 */
export function migrateResponseValue(
  response: LegacyResponseShape,
  otherIdMapping: Record<string, string>,
): MigratedResponseShape {
  const result: MigratedResponseShape = {
    questionId: response.questionId,
    value: response.value,
  };

  // ranking 응답: 배열 안에 RankingAnswer 객체들
  if (Array.isArray(response.value) && response.value.length > 0 && typeof response.value[0] === 'object') {
    const rankingItems = response.value as RankingAnswer[];
    result.value = rankingItems.map(item => {
      if (item.optionValue === '__other__') {
        const newId = otherIdMapping['__other__'] ?? item.optionValue;
        return {
          rank: item.rank,
          optionValue: newId,
          optionText: item.otherText,
        };
      }
      return { rank: item.rank, optionValue: item.optionValue };
    });
    return result;
  }

  // radio/select/checkbox 응답: value 가 string 또는 string[]
  // __other__ ID 를 실제 옵션 ID 로 치환
  if (typeof response.value === 'string' && otherIdMapping[response.value]) {
    result.value = otherIdMapping[response.value];
  } else if (Array.isArray(response.value)) {
    result.value = (response.value as string[]).map(v => otherIdMapping[v] ?? v);
  }

  // otherInputs → optionTexts
  if (response.otherInputs && response.otherInputs.length > 0) {
    const optionTexts: Record<string, string> = { ...(response.optionTexts ?? {}) };
    for (const entry of response.otherInputs) {
      const newId = otherIdMapping[entry.optionId] ?? entry.optionId;
      optionTexts[newId] = entry.inputValue;
    }
    result.optionTexts = optionTexts;
  } else if (response.optionTexts) {
    result.optionTexts = { ...response.optionTexts };
  }

  return result;
}

/**
 * 제출 시점 helper — 선택된 옵션의 텍스트만 남기고 미선택 텍스트는 drop.
 * 빌더에서 "선택 해제 시 텍스트 유지" 정책을 따르므로, 클라이언트 상태에서는 보존되고
 * 제출 직전 이 함수로 정리.
 */
export function filterOptionTextsForSubmission(
  value: unknown,
  optionTexts: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!optionTexts) return undefined;

  const selectedIds = new Set<string>();
  if (typeof value === 'string') {
    selectedIds.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === 'string') {
        selectedIds.add(v);
      } else if (v && typeof v === 'object' && 'optionValue' in v) {
        // ranking
        selectedIds.add((v as { optionValue: string }).optionValue);
      }
    }
  }

  const filtered: Record<string, string> = {};
  for (const [optionId, text] of Object.entries(optionTexts)) {
    if (selectedIds.has(optionId) && text.trim().length > 0) {
      filtered[optionId] = text;
    }
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}
```

- [ ] **Step 2: 테스트 실행 — 통과 확인**

Run: `pnpm vitest run tests/integration/option-text-migration.test.ts`
Expected: PASS (10/10)

- [ ] **Step 3: 커밋**

```bash
git add src/lib/option-text-migration.ts tests/integration/option-text-migration.test.ts
git commit -m "feat: 옵션 텍스트 입력 마이그레이션 유틸리티 추가"
```

---

## Phase 2: Migration Script & Runner

### Task 5: Snapshot 변환 함수 (TDD)

**Files:**
- Modify: `tests/integration/option-text-migration.test.ts` (테스트 추가)
- Modify: `src/lib/option-text-migration.ts` (함수 추가)

- [ ] **Step 1: snapshot 변환 테스트 추가**

`tests/integration/option-text-migration.test.ts` 에 describe 블록 추가:

```ts
describe('migrateSnapshotQuestions', () => {
  it('migrates allowOtherOption inside snapshot question list', () => {
    const snapshot = {
      questions: [
        {
          id: 'q1',
          allowOtherOption: true,
          options: [{ id: 'o1', label: 'A', value: '1', optionCode: '1', spssNumericCode: 1 }],
        },
        {
          id: 'q2',
          allowOtherOption: false,
          options: [{ id: 'o2', label: 'B', value: '1', optionCode: '1', spssNumericCode: 1 }],
        },
      ],
    };

    const result = migrateSnapshotQuestions(snapshot);

    expect(result.questions[0].options).toHaveLength(2);
    expect(result.questions[0].allowOtherOption).toBeUndefined();
    expect(result.questions[1].options).toHaveLength(1);
    expect(result.otherIdMappings['q1']).toBeDefined();
    expect(result.otherIdMappings['q2']).toBeUndefined();
  });

  it('migrates table cell allowOtherOption', () => {
    const snapshot = {
      questions: [
        {
          id: 'q1',
          type: 'table',
          tableRowsData: [
            {
              id: 'r1',
              cells: [
                {
                  id: 'c1',
                  type: 'radio',
                  allowOtherOption: true,
                  radioOptions: [{ id: 'ro1', label: 'A', value: '1' }],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = migrateSnapshotQuestions(snapshot);

    const cell = result.questions[0].tableRowsData[0].cells[0];
    expect(cell.radioOptions).toHaveLength(2);
    expect(cell.allowOtherOption).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run tests/integration/option-text-migration.test.ts`
Expected: FAIL — `migrateSnapshotQuestions is not exported`

- [ ] **Step 3: 구현 추가**

`src/lib/option-text-migration.ts` 에 함수 추가:

```ts
interface SnapshotQuestion extends LegacyQuestionShape {
  type?: string;
  tableRowsData?: Array<{
    id: string;
    cells: Array<{
      id: string;
      type?: string;
      allowOtherOption?: boolean;
      radioOptions?: QuestionOption[];
      checkboxOptions?: QuestionOption[];
      selectOptions?: QuestionOption[];
    }>;
  }>;
}

export interface MigratedSnapshot {
  questions: SnapshotQuestion[];
  /** questionId → __other__ ID → 새 옵션 ID */
  otherIdMappings: Record<string, Record<string, string>>;
}

export function migrateSnapshotQuestions(snapshot: {
  questions: SnapshotQuestion[];
}): MigratedSnapshot {
  const otherIdMappings: Record<string, Record<string, string>> = {};

  const migrated = snapshot.questions.map(question => {
    const updated: SnapshotQuestion = { ...question };

    // 1. 질문 레벨 옵션 마이그레이션
    if (question.allowOtherOption) {
      const r = migrateQuestionOptions(question);
      updated.options = r.options;
      updated.allowOtherOption = undefined;
      if (r.migratedOtherOptionId) {
        otherIdMappings[question.id] = { '__other__': r.migratedOtherOptionId };
      }
    }

    // 2. 테이블 셀 옵션 마이그레이션
    if (question.tableRowsData) {
      updated.tableRowsData = question.tableRowsData.map(row => ({
        ...row,
        cells: row.cells.map(cell => {
          if (!cell.allowOtherOption) return cell;
          const optionsField =
            cell.type === 'checkbox' ? 'checkboxOptions' :
            cell.type === 'radio' ? 'radioOptions' :
            'selectOptions';
          const existing = cell[optionsField] ?? [];
          const fields = generateOtherOptionFields(existing.length);
          const newOption: QuestionOption = {
            id: nanoid(10),
            label: '기타',
            value: fields.optionCode,
            optionCode: fields.optionCode,
            spssNumericCode: fields.spssNumericCode,
            allowTextInput: true,
          };
          return {
            ...cell,
            [optionsField]: [...existing, newOption],
            allowOtherOption: undefined,
          };
        }),
      }));
    }

    return updated;
  });

  return { questions: migrated, otherIdMappings };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run tests/integration/option-text-migration.test.ts`
Expected: PASS (12/12)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/option-text-migration.ts tests/integration/option-text-migration.test.ts
git commit -m "feat: snapshot 단위 옵션 마이그레이션 함수 추가"
```

---

### Task 6: 마이그레이션 Runner 스크립트

**Files:**
- Create: `scripts/migrate-option-text.ts`

- [ ] **Step 1: 스크립트 작성**

`scripts/migrate-option-text.ts`:

```ts
/**
 * 옵션 단위 텍스트 입력 마이그레이션 runner.
 *
 * 사용법:
 *   pnpm tsx scripts/migrate-option-text.ts --dry-run    # 검증만 (기본)
 *   pnpm tsx scripts/migrate-option-text.ts --apply      # 실제 적용
 *
 * 동작 순서:
 *   1. questions 테이블 — allow_other_option=true 인 질문 전수 변환
 *   2. surveys.publishedSnapshot JSONB — snapshot 안 질문 전수 변환
 *   3. survey_responses.questionResponses JSONB — otherInputs/__other__ 변환
 *
 * idempotent: 이미 변환된 데이터는 skip.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import {
  migrateQuestionOptions,
  migrateSnapshotQuestions,
  migrateResponseValue,
} from '../src/lib/option-text-migration';
import * as schema from '../src/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const isDryRun = !process.argv.includes('--apply');

async function main() {
  const sqlClient = postgres(DATABASE_URL!);
  const db = drizzle(sqlClient, { schema });

  console.log(isDryRun ? '[DRY-RUN]' : '[APPLY]', '옵션 텍스트 마이그레이션 시작');

  let questionsMigrated = 0;
  let snapshotsMigrated = 0;
  let responsesMigrated = 0;

  try {
    await db.transaction(async tx => {
      // Step 1: questions 테이블
      const questionsToMigrate = await tx
        .select()
        .from(schema.questions)
        .where(eq(schema.questions.allowOtherOption, true));

      console.log(`찾음: questions ${questionsToMigrate.length} 개`);

      for (const q of questionsToMigrate) {
        const migrated = migrateQuestionOptions({
          id: q.id,
          allowOtherOption: q.allowOtherOption ?? false,
          options: (q.options as any) ?? [],
        });

        if (!migrated.migratedOtherOptionId) continue;

        if (!isDryRun) {
          await tx
            .update(schema.questions)
            .set({
              options: migrated.options as any,
              allowOtherOption: false,
              // 마이그레이션 mapping 을 임시로 questionResponses 변환에 쓸 수 있게 보관
              // (트랜잭션 안에서만 유효한 메모리 변수로 충분)
            })
            .where(eq(schema.questions.id, q.id));
        }
        questionsMigrated++;
      }

      // Step 2: surveys.publishedSnapshot — snapshot JSONB 안 질문들
      const surveys = await tx.select().from(schema.surveys);
      const snapshotMappings: Record<string, Record<string, Record<string, string>>> = {};
      // surveyId → questionId → __other__ → newId

      for (const survey of surveys) {
        const snapshot = (survey as any).publishedSnapshot;
        if (!snapshot || !snapshot.questions) continue;

        const hasOther = snapshot.questions.some(
          (q: any) =>
            q.allowOtherOption ||
            (q.tableRowsData?.some((r: any) => r.cells?.some((c: any) => c.allowOtherOption))),
        );
        if (!hasOther) continue;

        const result = migrateSnapshotQuestions(snapshot);
        snapshotMappings[survey.id] = result.otherIdMappings;

        if (!isDryRun) {
          await tx
            .update(schema.surveys)
            .set({
              publishedSnapshot: { ...snapshot, questions: result.questions } as any,
            })
            .where(eq(schema.surveys.id, survey.id));
        }
        snapshotsMigrated++;
      }

      // Step 3: survey_responses.questionResponses
      const responses = await tx.select().from(schema.surveyResponses);
      console.log(`스캔: responses ${responses.length} 개`);

      for (const resp of responses) {
        const qResponses = resp.questionResponses as Record<string, any> | null;
        if (!qResponses) continue;

        const mappings = snapshotMappings[resp.surveyId] ?? {};
        let changed = false;
        const newQResponses: Record<string, any> = {};

        for (const [questionId, value] of Object.entries(qResponses)) {
          const mapping = mappings[questionId] ?? {};
          const oldShape = value as any;
          if (oldShape.otherInputs || (Array.isArray(oldShape.value) && oldShape.value.some((v: any) => v === '__other__' || (typeof v === 'object' && v?.optionValue === '__other__')))) {
            const migrated = migrateResponseValue(
              { questionId, ...oldShape },
              mapping,
            );
            newQResponses[questionId] = migrated;
            changed = true;
          } else {
            newQResponses[questionId] = value;
          }
        }

        if (changed) {
          if (!isDryRun) {
            await tx
              .update(schema.surveyResponses)
              .set({ questionResponses: newQResponses as any })
              .where(eq(schema.surveyResponses.id, resp.id));
          }
          responsesMigrated++;
        }
      }

      if (isDryRun) {
        console.log('--- DRY RUN: 트랜잭션 롤백 ---');
        throw new Error('DRY_RUN_ROLLBACK');
      }
    });
  } catch (err) {
    if ((err as Error).message === 'DRY_RUN_ROLLBACK') {
      // expected
    } else {
      throw err;
    }
  } finally {
    await sqlClient.end();
  }

  console.log('완료:');
  console.log(`  questions: ${questionsMigrated}`);
  console.log(`  snapshots: ${snapshotsMigrated}`);
  console.log(`  responses: ${responsesMigrated}`);
  console.log(isDryRun ? '[DRY-RUN] DB 변경 없음. --apply 로 실제 적용.' : '[APPLIED]');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: 컴파일 확인**

Run: `pnpm tsc --noEmit scripts/migrate-option-text.ts` (또는 tsconfig 에 scripts 포함)
Expected: PASS

- [ ] **Step 3: 로컬 DB 또는 staging 에서 dry-run 실행**

Run: `pnpm tsx scripts/migrate-option-text.ts`
Expected: 로그에 변환될 question/snapshot/response 개수가 출력되고 DB 변경 없음

- [ ] **Step 4: 커밋**

```bash
git add scripts/migrate-option-text.ts
git commit -m "feat: 옵션 텍스트 마이그레이션 runner 스크립트 추가"
```

---

## Phase 3: Builder UI — "+ 텍스트 옵션 추가" 버튼 + 토글 제거

### Task 7: 옵션 헬퍼에 `createTextInputOption` 추가

**Files:**
- Modify: `src/components/survey-builder/question-option-helpers.ts`

- [ ] **Step 1: 헬퍼 함수 추가**

`question-option-helpers.ts` 에 함수 추가:

```ts
import { nanoid } from 'nanoid';
import type { QuestionOption } from '@/types/survey';
import { generateOtherOptionFields } from '@/lib/option-text-migration';

/**
 * "+ 텍스트 옵션 추가" 버튼이 호출하는 헬퍼.
 * allowTextInput=true 옵션을 마지막에 append.
 * 코드/변수번호는 기존 옵션 수 기준 자동 부여 (사용자가 빌더에서 수정 가능).
 */
export function createTextInputOption(existingOptions: QuestionOption[]): QuestionOption {
  const fields = generateOtherOptionFields(existingOptions.length);
  return {
    id: nanoid(10),
    label: '',  // 사용자가 직접 입력 (예: "출장비를 타 기관에서 지원받음")
    value: fields.optionCode,
    optionCode: fields.optionCode,
    spssNumericCode: fields.spssNumericCode,
    allowTextInput: true,
  };
}
```

- [ ] **Step 2: 컴파일 확인**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add src/components/survey-builder/question-option-helpers.ts
git commit -m "feat: createTextInputOption 헬퍼 추가"
```

---

### Task 8: 빌더 UI — `question-basic-tab.tsx` 토글 제거 + 버튼 추가

**Files:**
- Modify: `src/components/survey-builder/question-basic-tab.tsx`

- [ ] **Step 1: 현재 파일 읽기**

Read: `src/components/survey-builder/question-basic-tab.tsx`
관심 라인: `:237` (allowOtherOption switch 컨테이너), `:473` (옵션 추가 버튼), `:546-570` (기타 옵션 프리뷰)

- [ ] **Step 2: "기타 옵션 추가" 토글 제거**

`:237` 부근의 Switch + Label 컴포넌트 (allowOtherOption 토글) 전체 제거. `onToggleAllowOther` 등 관련 prop / handler 도 같이 제거.

- [ ] **Step 3: "+ 옵션 추가" 버튼 옆에 "+ 텍스트 옵션 추가" 버튼 추가**

`:473` 부근의 옵션 추가 버튼 영역에 형제 버튼 추가:

```tsx
import { createTextInputOption } from './question-option-helpers';
// ... 컴포넌트 안에서

const handleAddTextOption = () => {
  const newOption = createTextInputOption(question.options ?? []);
  onUpdate({ ...question, options: [...(question.options ?? []), newOption] });
};

// JSX:
<div className="flex gap-2">
  <Button onClick={handleAddOption} variant="outline" size="sm">
    + 옵션 추가
  </Button>
  <Button onClick={handleAddTextOption} variant="outline" size="sm">
    + 텍스트 옵션 추가
  </Button>
</div>
```

- [ ] **Step 4: 기타 옵션 프리뷰 코드 제거**

`:546-570` 의 "기타" 옵션 자동 렌더 블록 제거. 옵션 리스트에서 `allowTextInput=true` 인 옵션은 일반 옵션 리스트에 자연스럽게 포함됨.

- [ ] **Step 5: 옵션 row 에 텍스트 입력 표시 추가**

각 옵션 row 에 `option.allowTextInput` 일 경우 "텍스트 입력" 뱃지 또는 placeholder preview 추가:

```tsx
{option.allowTextInput && (
  <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
    텍스트 입력
  </span>
)}
```

- [ ] **Step 6: 컴파일 + 빌드 확인**

Run: `pnpm tsc --noEmit && pnpm build`
Expected: PASS

- [ ] **Step 7: 브라우저 확인**

dev server 띄우고 (`pnpm dev`) 새 라디오/체크박스 질문 만들기:
- "+ 옵션 추가" → 일반 옵션 생성
- "+ 텍스트 옵션 추가" → "텍스트 입력" 뱃지가 붙은 옵션 생성
- 기존 "기타 옵션 추가" 토글이 사라졌는지

- [ ] **Step 8: 커밋**

```bash
git add src/components/survey-builder/question-basic-tab.tsx
git commit -m "feat: question-basic-tab 에 텍스트 옵션 추가 버튼 + 기타 토글 제거"
```

---

### Task 9: Ranking 빌더 UI 업데이트

**Files:**
- Modify: `src/components/survey-builder/ranking-config-editor.tsx`

- [ ] **Step 1: 현재 파일 읽기**

Read: `src/components/survey-builder/ranking-config-editor.tsx`
관심 라인: `:28, :45, :161, :220-222` (allowOtherOption 처리)

- [ ] **Step 2: 토글 제거 + 텍스트 옵션 버튼 추가**

Task 8 과 동일 패턴 적용. `allowOtherOption` 관련 모든 UI/state 제거. `+ 텍스트 옵션 추가` 버튼 추가.

ranking 의 `__other__` 매직값은 더이상 사용되지 않음 — `allowTextInput=true` 인 옵션이 선택되면 응답에 `optionText` 가 함께 저장됨.

- [ ] **Step 3: 컴파일 확인**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add src/components/survey-builder/ranking-config-editor.tsx
git commit -m "feat: ranking 빌더에서 기타 토글 제거 및 텍스트 옵션 지원"
```

---

### Task 10: Table Cell 모달 — "+ 텍스트 옵션 추가" 지원

**Files:**
- Modify: `src/components/survey-builder/cell-content-modal.tsx`

- [ ] **Step 1: 현재 파일 읽기**

Read: `src/components/survey-builder/cell-content-modal.tsx`
관심 라인: `:147, :218, :308-309` (allowOtherOption)

- [ ] **Step 2: radio/checkbox/select 셀 타입에서 토글 제거 + 버튼 추가**

각 셀 타입 (radio/checkbox/select) 의 옵션 편집 영역에서 `allowOtherOption` 토글 제거. "+ 텍스트 옵션 추가" 버튼 추가. `radioOptions` / `checkboxOptions` / `selectOptions` 배열에 옵션 push.

ranking 셀은 별도 — `isOtherRankingCell` 로직도 정리해야 하나 cleanup phase 로 미룰지 결정. → **결정: 이 task 에서 처리하여 일관성 유지.**

- [ ] **Step 3: 컴파일 + 브라우저 확인**

Run: `pnpm tsc --noEmit && pnpm dev`
Expected: 테이블 안 radio/checkbox/select 셀에서 텍스트 옵션 추가 가능

- [ ] **Step 4: 커밋**

```bash
git add src/components/survey-builder/cell-content-modal.tsx
git commit -m "feat: 테이블 셀 내 텍스트 옵션 추가 지원"
```

---

### Task 11: 빌더 옵션 row 셀 컴포넌트 업데이트 (이미지/뱃지 표시)

**Files:**
- Modify: `src/components/survey-builder/cells/radio-cell.tsx`
- Modify: `src/components/survey-builder/cells/checkbox-cell.tsx`
- Modify: `src/components/survey-builder/cells/select-cell.tsx`
- Modify: `src/components/survey-builder/cells/ranking-cell.tsx`

- [ ] **Step 1: 각 셀에서 `allowOtherOption` 의존 코드 제거**

각 파일에서 `allowOtherOption` 을 읽는 분기 모두 제거. 옵션 리스트는 그냥 `options` 배열을 그대로 렌더링하면 됨 (allowTextInput 옵션도 일반 옵션처럼 표시 + 뱃지).

- [ ] **Step 2: allowTextInput 시 input placeholder preview**

옵션 라벨 옆에 `option.allowTextInput` 이면 `(상세 기재: ___)` 같은 시각 힌트.

- [ ] **Step 3: 컴파일 확인**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add src/components/survey-builder/cells/
git commit -m "refactor: 빌더 셀 컴포넌트에서 allowOtherOption 의존 제거"
```

---

## Phase 4: 응답 페이지 — 텍스트 입력 렌더링

### Task 12: 응답 store — `optionTexts` 상태 관리

**Files:**
- Modify: `src/stores/survey-response-store.ts`

- [ ] **Step 1: 현재 파일 읽기**

Read: `src/stores/survey-response-store.ts`

- [ ] **Step 2: optionTexts 상태 추가**

각 질문 응답 객체에 `optionTexts: Record<string, string>` 필드 추가. setter 추가:

```ts
setOptionText: (questionId: string, optionId: string, text: string) => void;
```

기존 `otherInputs` setter 가 있다면 deprecate (cleanup phase 에서 제거).

- [ ] **Step 3: 컴파일 확인**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add src/stores/survey-response-store.ts
git commit -m "feat: 응답 스토어에 optionTexts 상태 추가"
```

---

### Task 13: 응답 페이지 — radio 입력

**Files:**
- Modify: `src/components/survey-response/question-input.tsx` (또는 `radio-input.tsx`)

- [ ] **Step 1: 현재 파일 읽기**

Read: `src/components/survey-response/question-input.tsx`
관심 라인: `:25-38` (OtherChoiceValue 타입 + 함수)

- [ ] **Step 2: OtherChoiceValue 타입 제거**

`OtherChoiceValue` 타입과 관련 헬퍼 제거. allowTextInput 기반 단순 로직으로 대체.

- [ ] **Step 3: radio 렌더링 시 allowTextInput 옵션은 인라인 input 표시**

라디오 옵션 렌더 패턴:

```tsx
{options.map(option => (
  <div key={option.id} className="flex items-center gap-2">
    <RadioGroupItem value={option.id} id={`${questionId}-${option.id}`} />
    <Label htmlFor={`${questionId}-${option.id}`} className="flex-1">
      {option.label}
    </Label>
    {option.allowTextInput && (
      <Input
        value={optionTexts[option.id] ?? ''}
        onChange={e => setOptionText(questionId, option.id, e.target.value)}
        placeholder="상세 기재"
        className="max-w-xs"
        // 선택해제되어도 값 유지 (제출 시점에 drop)
        disabled={false}
      />
    )}
  </div>
))}
```

- [ ] **Step 4: 컴파일 + 브라우저 확인**

Run: `pnpm tsc --noEmit && pnpm dev`
빌더에서 텍스트 옵션 만든 라디오 질문 → 응답 페이지에서 옵션 선택 시 input 표시.

- [ ] **Step 5: 커밋**

```bash
git add src/components/survey-response/question-input.tsx
git commit -m "feat: 라디오 응답에 옵션별 텍스트 입력 인라인 렌더링"
```

---

### Task 14: 응답 페이지 — checkbox 입력

**Files:**
- Modify: 체크박스 입력 컴포넌트 (탐색 필요)

- [ ] **Step 1: 체크박스 응답 컴포넌트 찾기**

Run: `grep -rn "type === 'checkbox'" src/components/survey-response/`
관심 파일을 식별

- [ ] **Step 2: Task 13 과 동일 패턴 적용**

차이점: 체크박스는 다중 선택. `optionTexts` 의 key 는 동일 (optionId), 선택 안 된 옵션의 텍스트는 제출 시 drop.

- [ ] **Step 3: 컴파일 + 브라우저 확인**

Run: `pnpm tsc --noEmit && pnpm dev`
체크박스 질문에서 여러 텍스트 옵션 동시 선택 시 각각 input 표시.

- [ ] **Step 4: 커밋**

```bash
git add src/components/survey-response/
git commit -m "feat: 체크박스 응답에 옵션별 텍스트 입력 인라인 렌더링"
```

---

### Task 15: 응답 페이지 — select / multiselect / ranking

**Files:**
- Modify: select 입력 컴포넌트
- Modify: ranking 입력 컴포넌트

- [ ] **Step 1: select 입력에 텍스트 옵션 지원**

select 박스 아래에 선택된 옵션이 allowTextInput 이면 input 표시. multiselect 도 동일.

- [ ] **Step 2: ranking 입력 — `__other__` 매직값 제거**

ranking 의 기존 `optionValue === '__other__'` 분기 모두 제거. `allowTextInput` 옵션이 어떤 순위에 선택되면 RankingAnswer 에 `optionText` 저장.

ranking item 렌더 예:

```tsx
{rankings.map(item => (
  <div key={item.rank}>
    <Select value={item.optionValue} onValueChange={v => updateRanking(item.rank, v)}>
      {/* options... */}
    </Select>
    {selectedOption?.allowTextInput && (
      <Input
        value={item.optionText ?? ''}
        onChange={e => updateRankingText(item.rank, e.target.value)}
        placeholder="상세 기재"
      />
    )}
  </div>
))}
```

- [ ] **Step 3: 컴파일 + 브라우저 확인**

Run: `pnpm tsc --noEmit && pnpm dev`

- [ ] **Step 4: 커밋**

```bash
git add src/components/survey-response/
git commit -m "feat: select 와 ranking 응답에 옵션별 텍스트 입력 지원"
```

---

### Task 16: 응답 제출 시점 필터링

**Files:**
- Modify: 응답 제출 액션 또는 store 의 submit 핸들러

- [ ] **Step 1: 제출 헬퍼 호출 추가**

응답 제출 시 `filterOptionTextsForSubmission` 헬퍼 호출하여 미선택 옵션 텍스트 drop:

```ts
import { filterOptionTextsForSubmission } from '@/lib/option-text-migration';

// 제출 전
const payload = Object.fromEntries(
  Object.entries(responses).map(([qId, resp]) => [
    qId,
    {
      ...resp,
      optionTexts: filterOptionTextsForSubmission(resp.value, resp.optionTexts),
    },
  ]),
);
```

- [ ] **Step 2: 통합 테스트 추가**

`tests/integration/option-text-response.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { filterOptionTextsForSubmission } from '@/lib/option-text-migration';

describe('filterOptionTextsForSubmission', () => {
  it('drops text for unselected options', () => {
    const result = filterOptionTextsForSubmission(
      ['o1', 'o2'],
      { o1: '입력1', o2: '입력2', o3: '미선택 상태에서 적힌 값' },
    );
    expect(result).toEqual({ o1: '입력1', o2: '입력2' });
  });

  it('drops empty/whitespace-only text', () => {
    const result = filterOptionTextsForSubmission(['o1'], { o1: '   ' });
    expect(result).toBeUndefined();
  });

  it('handles ranking value shape', () => {
    const result = filterOptionTextsForSubmission(
      [{ rank: 1, optionValue: 'o2' }],
      { o2: '랭킹 텍스트' },
    );
    expect(result).toEqual({ o2: '랭킹 텍스트' });
  });

  it('returns undefined for empty input', () => {
    expect(filterOptionTextsForSubmission(['o1'], undefined)).toBeUndefined();
  });
});
```

Run: `pnpm vitest run tests/integration/option-text-response.test.ts`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add src/stores/survey-response-store.ts tests/integration/option-text-response.test.ts
git commit -m "feat: 응답 제출 시 미선택 옵션 텍스트 자동 drop"
```

---

## Phase 5: Snapshot Builder

### Task 17: snapshot-builder 에 `allowTextInput` 직렬화 보장

**Files:**
- Modify: `src/lib/versioning/snapshot-builder.ts`

- [ ] **Step 1: 현재 파일 읽기**

Read: `src/lib/versioning/snapshot-builder.ts`
관심 라인: `:43, :103`

- [ ] **Step 2: 옵션 직렬화 시 `allowTextInput` 포함 확인**

옵션을 snapshot 에 복사하는 코드에서 `allowTextInput` 이 누락되지 않도록 명시:

```ts
options: question.options?.map(opt => ({
  id: opt.id,
  label: opt.label,
  value: opt.value,
  optionCode: opt.optionCode,
  spssNumericCode: opt.spssNumericCode,
  isCustomOptionCode: opt.isCustomOptionCode,
  allowTextInput: opt.allowTextInput,  // 신규
  branchRule: opt.branchRule,
})),
```

`allowOtherOption` 직렬화 코드는 cleanup phase 에서 제거 (지금은 호환성 위해 둠).

- [ ] **Step 3: 컴파일 확인**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add src/lib/versioning/snapshot-builder.ts
git commit -m "feat: snapshot 직렬화에 allowTextInput 필드 포함"
```

---

## Phase 6: Export & Analytics — SPSS / Excel 사이드카 변수

### Task 18: SPSS syntax generator — 텍스트 사이드카 변수

**Files:**
- Modify: `src/lib/spss/spss-syntax-generator.ts`

- [ ] **Step 1: 현재 파일 읽기**

Read: `src/lib/spss/spss-syntax-generator.ts`
관심 라인: `:55, :86, :92, :116, :223, :231, :237` (allowOtherOption 처리)

- [ ] **Step 2: 옵션 순회 시 allowTextInput 옵션마다 STRING 변수 추가**

변수 정의 생성 로직:

```ts
function generateOptionTextVariables(
  question: Question,
): Array<{ name: string; type: 'STRING'; width: number; label: string }> {
  const vars: Array<{ name: string; type: 'STRING'; width: number; label: string }> = [];
  const qVar = question.questionCode ?? `Q${question.order}`;

  for (const option of question.options ?? []) {
    if (!option.allowTextInput) continue;
    // 변수번호 — 사용자가 입력한 optionCode 사용 (zero-pad 컨벤션 포함됨)
    const varNumber = option.optionCode ?? String(option.spssNumericCode ?? '');
    vars.push({
      name: `${qVar}_${varNumber}_text`,
      type: 'STRING',
      width: 255,
      label: `${question.title} - ${option.label} (텍스트)`,
    });
  }

  return vars;
}
```

기존 `allowOtherOption` 기반 변수 생성 로직 제거.

- [ ] **Step 3: 변수 값 채우기 로직 업데이트**

응답 export 시 `optionTexts[optionId]` 를 `{qVar}_{optionCode}_text` 변수에 매핑.

- [ ] **Step 4: 통합 테스트 권장**

기존 SPSS export 테스트가 있으면 (vitest 또는 manual) 새 형식으로 갱신.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/spss/spss-syntax-generator.ts
git commit -m "feat: SPSS export 에 옵션별 텍스트 사이드카 변수 생성"
```

---

### Task 19: SPSS Excel export

**Files:**
- Modify: `src/lib/analytics/spss-excel-export.ts`

- [ ] **Step 1: 현재 파일 읽기**

Read: `src/lib/analytics/spss-excel-export.ts`
관심 라인: `:111, :133, :148, :221`

- [ ] **Step 2: Excel 컬럼 생성 시 allowTextInput 옵션마다 컬럼 추가**

Task 18 과 동일 변수명 컨벤션 사용 (`{qVar}_{optionCode}_text`). 값은 `optionTexts[optionId]` 에서 채움.

- [ ] **Step 3: 컴파일 확인**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add src/lib/analytics/spss-excel-export.ts
git commit -m "feat: SPSS Excel export 에 옵션별 텍스트 컬럼 추가"
```

---

### Task 20: 일반 Excel transformer

**Files:**
- Modify: `src/lib/excel-transformer.ts`

- [ ] **Step 1: 현재 파일 읽기**

Read: `src/lib/excel-transformer.ts`
관심 라인: `:213, :232, :285`

- [ ] **Step 2: 동일 패턴 적용**

`{qVar}_{optionCode}_text` 컬럼 생성. optionTexts 매핑.

- [ ] **Step 3: 커밋**

```bash
git add src/lib/excel-transformer.ts
git commit -m "feat: Excel transformer 에 옵션별 텍스트 컬럼 추가"
```

---

### Task 21: Cleaning export format

**Files:**
- Modify: `src/lib/analytics/cleaning-export-format.ts`

- [ ] **Step 1: 현재 파일 읽기**

Read: `src/lib/analytics/cleaning-export-format.ts`
관심 라인: `:500`

- [ ] **Step 2: 동일 패턴 적용**

- [ ] **Step 3: 커밋**

```bash
git add src/lib/analytics/cleaning-export-format.ts
git commit -m "feat: cleaning export 에 옵션별 텍스트 컬럼 추가"
```

---

## Phase 7: 마이그레이션 실행 & Schema Cleanup

### Task 22: 마이그레이션 dry-run 검증

- [ ] **Step 1: production 데이터 백업**

```bash
# Supabase Studio 에서 manual backup 또는 pg_dump
# 별도 SQL dump 파일을 안전한 위치에 저장
```

- [ ] **Step 2: staging DB 에 코드 + 마이그레이션 배포 후 dry-run**

Run: `DATABASE_URL=<staging> pnpm tsx scripts/migrate-option-text.ts`
Expected: 영향받는 question/snapshot/response 개수가 합리적인 범위 (production 데이터 추정치와 일치)

- [ ] **Step 3: staging 에서 --apply 실행**

Run: `DATABASE_URL=<staging> pnpm tsx scripts/migrate-option-text.ts --apply`
Expected: 모든 단계 성공, 변환된 데이터가 빌더/응답 페이지에서 정상 표시

- [ ] **Step 4: staging 에서 한 응답 endpoint manual QA**

기타가 있던 기존 설문 — snapshot 기반 응답 페이지에서 "기타" 옵션 (이제 마이그레이션된 일반 옵션) 선택 → 텍스트 입력 → 제출. 응답 데이터의 `optionTexts` 가 올바른 옵션 ID 에 매핑되었는지 확인.

---

### Task 23: production 마이그레이션 실행

- [ ] **Step 1: production 백업 확인**

- [ ] **Step 2: production dry-run**

Run: `DATABASE_URL=<production> pnpm tsx scripts/migrate-option-text.ts`

- [ ] **Step 3: production apply**

Run: `DATABASE_URL=<production> pnpm tsx scripts/migrate-option-text.ts --apply`

- [ ] **Step 4: 즉시 검증**

- 어드민 콘솔에서 임의의 기존 "기타" 보유 설문 열어보기 — "기타" 옵션이 마지막에 일반 옵션으로 표시되는지
- 임의의 기존 응답 — questionResponses 에 `otherInputs` 가 사라지고 `optionTexts` 가 채워졌는지

---

### Task 24: `allow_other_option` 컬럼 DROP

**Files:**
- Create: `supabase/migrations/{next}_drop_allow_other_option.sql` (또는 Supabase MCP `apply_migration` 사용)

- [ ] **Step 1: SQL 작성**

```sql
-- Drop allow_other_option columns from questions and ranking option cells
ALTER TABLE questions DROP COLUMN IF EXISTS allow_other_option;

-- table_cells 의 allow_other_option 은 JSONB 안에 있으므로 마이그레이션 스크립트로 처리 완료
-- (별도 DDL 불필요)
```

- [ ] **Step 2: Supabase MCP 로 적용**

memory `feedback_drizzle_migrate_journal.md` 에 따라 `mcp__supabase__apply_migration` 사용.

- [ ] **Step 3: drizzle schema 업데이트**

`src/db/schema/surveys.ts:113` 에서 `allow_other_option` 컬럼 정의 제거.

```ts
// 제거: allowOtherOption: boolean('allow_other_option').default(false),
```

- [ ] **Step 4: 컴파일 확인**

Run: `pnpm tsc --noEmit`
Expected: PASS (모든 사용처가 phase 3-6 에서 정리됨)

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/ src/db/schema/surveys.ts
git commit -m "feat: questions 테이블에서 allow_other_option 컬럼 제거"
```

---

### Task 25: `allowOtherOption` / `hasOther` / `otherInputs` 타입 제거

**Files:**
- Modify: `src/types/survey.ts`
- Modify: `src/db/schema/schema-types.ts`

- [ ] **Step 1: 타입 필드 제거**

`src/types/survey.ts` 에서:
- `Question.allowOtherOption` 제거 (`:311`)
- `TableCell.allowOtherOption` 제거 (`:154`)
- `QuestionOption.hasOther` / `CheckboxOption.hasOther` / `RadioOption.hasOther` 제거
- `OtherInputValue` 타입 제거 (`:369-372`)
- `SurveyResponse.otherInputs` 제거 (`:378`)
- `RankingAnswer.otherText` 제거 (`:33`)
- `TableCell.isOtherRankingCell` 제거 (`:182`)

`src/db/schema/schema-types.ts` 에서:
- `:110, :239` 의 `allowOtherOption` 제거

- [ ] **Step 2: 컴파일 — 남은 사용처 찾기**

Run: `pnpm tsc --noEmit`
Expected: 컴파일 에러로 아직 남은 dead code 찾기. 각 에러 위치를 제거.

- [ ] **Step 3: 모든 사용처 정리 후 재컴파일**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 테스트 실행**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/types/survey.ts src/db/schema/schema-types.ts
git commit -m "refactor: allowOtherOption 와 관련 deprecated 타입 모두 제거"
```

---

### Task 26: survey-save-actions 의 explicit field 점검

**Files:**
- Modify: `src/server/actions/survey-save-actions.ts`

memory `feedback_survey_save_explicit_fields.md` 에 따라 — survey-save-actions 는 spread 안 쓰고 explicit field set 함. 신규 `allowTextInput` 필드 추가 시 6-7곳 explicit 점검 필수.

- [ ] **Step 1: 현재 파일 읽고 옵션 직렬화 부분 찾기**

Run: `grep -n "options" src/server/actions/survey-save-actions.ts`

- [ ] **Step 2: 옵션 저장 시 `allowTextInput` 명시 추가**

각 옵션 저장 코드에서 explicit 하게 `allowTextInput: opt.allowTextInput` 추가. `allowOtherOption` 관련 코드는 모두 제거.

- [ ] **Step 3: 컴파일 + 통합 테스트**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: PASS

- [ ] **Step 4: 빌더에서 텍스트 옵션 만들고 저장 → 새로고침 후 유지되는지 brower QA**

- [ ] **Step 5: 커밋**

```bash
git add src/server/actions/survey-save-actions.ts
git commit -m "fix: survey-save-actions 에서 allowTextInput explicit 필드 추가"
```

---

## Phase 8: Verification

### Task 27: 전체 테스트 + 빌드

- [ ] **Step 1: 모든 vitest 통과**

Run: `pnpm vitest run`
Expected: PASS (option-text 관련 신규 테스트 + 기존 테스트 모두)

- [ ] **Step 2: TypeScript 컴파일**

Run: `pnpm tsc --noEmit`
Expected: PASS, 0 errors

- [ ] **Step 3: 빌드**

Run: `pnpm build`
Expected: PASS

memory `feedback_lint_infra_broken.md` 에 따라 lint 는 skip (인프라 깨져있음). tsc + vitest + build 로 검증.

---

### Task 28: 브라우저 manual QA

dev server (`pnpm dev`) 띄우고 brower 에서 직접 확인:

- [ ] **Step 1: 신규 설문 — 일반 텍스트 옵션**

라디오 질문 만들기 → "+ 텍스트 옵션 추가" 버튼으로 옵션 추가 → 응답 페이지에서 선택 → 인라인 input 표시 → 제출 → 응답 데이터에 `optionTexts: { [id]: text }` 확인

- [ ] **Step 2: 신규 설문 — 체크박스 다중 텍스트 옵션**

체크박스 질문 만들기 → "+ 옵션 추가" 로 옵션 2개 + "+ 텍스트 옵션 추가" 로 텍스트 옵션 2개 → 응답 페이지에서 둘 다 선택 → 각각 다른 텍스트 입력 → 제출 → optionTexts 에 두 옵션 모두 있는지

- [ ] **Step 3: 신규 설문 — ranking 에서 텍스트 옵션**

순위형 질문 → 일반 옵션 + 텍스트 옵션 → 응답에서 텍스트 옵션을 N 순위에 배치 → 텍스트 입력 → 제출 → RankingAnswer 에 `optionText` 들어가는지

- [ ] **Step 4: 마이그레이션된 기존 설문 — "기타" 옵션 동작**

production migration 이전부터 존재했던 "기타" 보유 설문 1개 열어서:
- 빌더: 마지막에 "기타" 라벨 옵션이 일반 옵션 형태로 표시
- 응답 페이지: 선택 시 인라인 input 표시
- 새 응답 제출 → optionTexts 확인

- [ ] **Step 5: 선택해제 시 텍스트 유지**

라디오에서 텍스트 옵션 선택 → 텍스트 입력 → 다른 옵션 선택 (해제) → 다시 텍스트 옵션 선택 → 이전 텍스트가 살아있는지. 제출 시점에는 마지막 선택만 살아남는지.

- [ ] **Step 6: SPSS export 검증**

마이그레이션된 설문의 응답을 SPSS syntax export → 생성된 .sps 파일에 `Q3_6_2_4_text` 형태 STRING 변수 존재하는지

- [ ] **Step 7: 분기 로직 회귀 확인**

기타 옵션에 branchRule 이 설정되어 있던 설문 → 마이그레이션 후에도 분기 동작 동일한지

---

### Task 29: 최종 PR

- [ ] **Step 1: 모든 커밋 정리**

```bash
git log --oneline main..HEAD
```

논리적으로 묶을 수 있는 커밋이 있으면 interactive rebase 로 정리 (선택). 단 push 전 main 머지 안 했으면 안전.

- [ ] **Step 2: PR 생성**

```bash
gh pr create --title "feat: 옵션 단위 텍스트 입력 지원 + 기타 토글 제거" --body "$(cat <<'EOF'
## Summary
- Question-level allowOtherOption 토글 → 옵션-단위 allowTextInput 필드로 평탄화
- 빌더에 "+ 텍스트 옵션 추가" 버튼 추가, 기존 "기타 옵션 추가" 토글 제거
- 응답 페이지: 선택된 옵션에 인라인 텍스트 input 렌더, 미선택 옵션 텍스트는 제출 시 drop
- SPSS/Excel export: `{questionVar}_{변수번호}_text` STRING 사이드카 변수 자동 생성
- 기존 production 데이터 마이그레이션: TS runner 로 questions/snapshots/responses 일괄 변환 후 컬럼 DROP
- ranking `__other__` 매직값 + table cell allowOtherOption 도 동일 패턴으로 정리

## Test plan
- [x] 옵션 텍스트 마이그레이션 unit test (10+ cases)
- [x] 응답 제출 시 필터링 통합 test
- [x] tsc + vitest + build 통과
- [x] staging migration dry-run + apply 검증
- [x] 브라우저 manual QA — 라디오/체크박스/select/ranking 4 타입 모두
- [x] 마이그레이션된 기존 설문 회귀 확인
- [x] SPSS export 출력 검증
- [x] 분기 로직 회귀 확인

## Migration notes
- Production 적용 순서: 코드 deploy → `pnpm tsx scripts/migrate-option-text.ts --apply` → DDL 컬럼 DROP (이미 이 PR 에 포함)
- 마이그레이션 스크립트는 idempotent. 재실행 안전.
- 롤백: 사전 백업 SQL 덤프 복원

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: 사용자 승인 대기**

memory 의 PR/머지는 사용자 결정. 머지 후 production migration 실행.

---

## Open Questions / 결정 보류

작업 중 다음이 모호하다면 plan 실행 일시정지하고 사용자 확인:

1. **마이그레이션된 "기타" 옵션의 `value` 필드** — 현재 plan 은 `value = optionCode` 로 설정. 만약 기존 응답이 `value='_other_'` 같은 문자열 리터럴을 저장하고 있었다면 응답 매핑 시 추가 처리 필요. → Task 23 dry-run 결과로 확인.

2. **빌더 옵션 row 의 "텍스트 입력" 표시 위치** — 라벨 옆 뱃지 vs 토글 row 아래 별도 표시. 현재 plan 은 뱃지. 디자인 가이드 토큰 (memory `feedback_brainstorming_design_guide.md`) 적용 필요 시 색상/스타일 재조정.

3. **테스트 환경의 SPSS export verification** — 자동 테스트는 fixture 기반이라 한계. Task 28 step 6 의 manual QA 가 실질적 검증.

4. **branchRule 호환성** — 기존 "기타" 옵션에 분기 설정이 있었다면 마이그레이션 후 새 옵션 ID 로 자동 이어지는지. → 마이그레이션 스크립트가 branchRule 의 `value` 필드 까지 추적해야 할 수도. Task 22 dry-run 에서 확인.

---

## Self-Review Notes

작성 후 plan 점검 결과:

**Spec coverage:**
- A (마이그레이션된 "기타" 변수번호/응답값): Task 4 generateOtherOptionFields + Task 6 runner 에서 처리 ✓
- B (ranking + table cell 포함): Task 5 migrateSnapshotQuestions + Task 9, 10, 15 ✓
- 옵션 단위 allowTextInput: Task 1, 7, 8 ✓
- SPSS 사이드카 변수명 `{qVar}_{변수번호}_text`: Task 18 ✓
- 응답 제출 시 미선택 텍스트 drop: Task 16 ✓
- "기타 옵션 추가" 토글 제거: Task 8 ✓
- 마이그레이션 스크립트 idempotent + dry-run: Task 6 ✓
- DDL DROP: Task 24 ✓
- explicit field 점검: Task 26 ✓

**Type consistency:** `allowTextInput`, `optionTexts`, `generateOtherOptionFields` 명칭이 plan 전체에서 일관됨 ✓

**Placeholder scan:** "TBD" / "later" 없음 ✓. 일부 Task 에서 "현재 파일 읽기" step 이 있는데 — 이는 executing agent 가 실제 코드 위치를 확인하고 적용해야 하는 부분. 코드 자체는 다음 step 에서 명시.
