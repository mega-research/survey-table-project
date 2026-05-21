# 분기 조건 — 숫자 비교 연산자 도입 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** input 타입 테이블 셀에 대해 displayCondition 에서 6개 숫자 비교 연산자 (==, !=, >, <, >=, <=) 지원. 셀에 `inputType: 'number'` 메타 도입으로 응답자 입력 모호성 차단.

**Architecture:** 셀 정의에 optional 메타 한 필드 + 분기 조건에 optional `numericComparison` 객체 추가. 평가 엔진 한 곳 (`branch-logic.ts`) 수정으로 문항/그룹/테이블 행/테이블 열 4가지 displayCondition 자동 혜택. 응답자 입력은 HTML `type="text"` + 정규식 필터 (HTML number quirks 회피).

**Tech Stack:** TypeScript strict, Vitest (단위), React (빌더/응답자 UI), JSONB 저장 (마이그레이션 불필요)

**Spec:** [2026-05-21-display-condition-numeric-comparison-design.md](../specs/2026-05-21-display-condition-numeric-comparison-design.md)

---

## File Structure

**Modify:**
- `src/types/survey.ts:134-205` — `TableCell.inputType` 추가
- `src/types/survey.ts:85-107` — `QuestionCondition.tableConditions.numericComparison` + `additionalConditions.numericComparison` 추가
- `src/utils/branch-logic.ts:1372-1382` — input 셀 평가 분기에 `numericComparison` 케이스 추가
- `src/components/survey-builder/cells/input-cell.tsx` — `inputType: 'number'` 분기 (정규식 필터)
- `src/components/survey-builder/cell-content-modal.tsx:833-925` — input 탭에 "숫자 입력" 토글 추가
- `src/components/survey-builder/question-condition-editor.tsx:515-538` — 셀 타입 분기로 `NumericComparisonEditor` 노출
- `src/components/survey-builder/question-condition-editor.tsx:628-650` — `additionalConditions` 영역도 동일 분기

**Create:**
- `src/components/survey-builder/numeric-comparison-editor.tsx` — 비교 연산자 + 우변 입력 컴포넌트 (재사용)
- `tests/unit/utils/branch-logic-numeric.test.ts` — 평가 엔진 단위 테스트

---

### Task 1: 타입 정의 추가

**Files:**
- Modify: `src/types/survey.ts:134-205` (TableCell)
- Modify: `src/types/survey.ts:85-107` (QuestionCondition)

- [ ] **Step 1: TableCell 에 inputType 필드 추가**

`src/types/survey.ts` 의 `TableCell` 인터페이스의 `input 관련 속성` 주석 블록 (현재 168-172 줄) 안에 추가:

```typescript
  // input 관련 속성
  placeholder?: string; // 단문형 입력 필드 placeholder
  inputMaxLength?: number; // 단문형 입력 필드 최대 길이
  // input 셀 prefill 템플릿 — {{attrs_key}} 포함 가능
  defaultValueTemplate?: string;
  // input 셀 입력 모드 — 'number' 면 응답자가 숫자만 입력 가능. 미지정/'text' 면 기존 자유 입력.
  inputType?: 'text' | 'number';
```

- [ ] **Step 2: NumericComparison 타입 정의 추가**

`src/types/survey.ts` 의 `QuestionCondition` 선언 (85줄 부근) **바로 위에** 별도 타입 추가:

```typescript
// 분기 조건 우변 (forward-compat union, 이번 구현은 'literal' 만 처리)
export type ComparandRef = { kind: 'literal'; value: number };

// 분기 조건 숫자 비교 (input + inputType='number' 셀 전용)
export interface NumericComparison {
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=';
  comparand: ComparandRef;
}
```

- [ ] **Step 3: QuestionCondition 의 tableConditions/additionalConditions 에 numericComparison 추가**

`src/types/survey.ts:93-104` 부분을 다음으로 교체:

```typescript
  // table-cell-check: 테이블의 특정 셀이 체크되었는지 확인
  tableConditions?: {
    rowIds: string[]; // 체크 확인할 행 ID들
    cellColumnIndex?: number; // 체크할 열 인덱스
    checkType: 'any' | 'all' | 'none'; // any: 하나라도, all: 모두, none: 모두 아님
    expectedValues?: string[]; // 기대하는 값들 (checkbox, radio, select 옵션의 value)
    numericComparison?: NumericComparison; // 숫자 비교 (input + inputType='number' 셀 전용)
  };
  additionalConditions?: {
    cellColumnIndex: number; // 추가로 확인할 열 인덱스
    checkType: 'checkbox' | 'radio' | 'select' | 'input';
    rowIds?: string[]; // 특정 행만 확인 (없으면 메인 조건의 체크된 행 사용)
    expectedValues?: string[]; // 기대하는 값들
    numericComparison?: NumericComparison; // 숫자 비교 (input + inputType='number' 셀 전용)
  };
```

- [ ] **Step 4: 타입체크 통과 확인**

Run: `pnpm exec tsc --noEmit`
Expected: 새 타입 관련 에러 없음 (기존 에러는 무시). neutral 추가라 기존 사용처 영향 없음.

- [ ] **Step 5: Commit**

```bash
git add src/types/survey.ts
git commit -m "feat: 분기 조건 숫자 비교용 TableCell.inputType + NumericComparison 타입 추가"
```

---

### Task 2: 평가 엔진 TDD — 단위 테스트 먼저

**Files:**
- Create: `tests/unit/utils/branch-logic-numeric.test.ts`

- [ ] **Step 1: 테스트 디렉토리 생성 + 실패 테스트 작성**

```bash
mkdir -p tests/unit/utils
```

`tests/unit/utils/branch-logic-numeric.test.ts` 신규 작성:

```typescript
import { describe, it, expect } from 'vitest';
import type { Question, QuestionConditionGroup, Survey } from '@/types/survey';
import { evaluateConditionGroup } from '@/utils/branch-logic';

// 5-1-1 케이스의 ⑥ 행/금액 열 input(number) 셀이 있다고 가정한 최소 fixture
function makeNumericInputCell(id: string) {
  return {
    id,
    content: '',
    type: 'input' as const,
    inputType: 'number' as const,
  };
}

function makeFixture(rowId: string, cellId: string) {
  const sourceQuestion: Question = {
    id: 'q-source',
    surveyId: 's1',
    type: 'table',
    title: '비용 표',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'col-label', label: '항목' },
      { id: 'col-amount', label: '금액' },
    ],
    tableRowsData: [
      {
        id: rowId,
        label: '출장비',
        cells: [
          { id: 'lbl', content: '출장비', type: 'text' as const },
          makeNumericInputCell(cellId),
        ],
      },
    ],
  } as unknown as Question;

  const targetQuestion: Question = {
    id: 'q-target',
    surveyId: 's1',
    type: 'text',
    title: '추가 질문',
    required: false,
    order: 1,
  } as unknown as Question;

  return { sourceQuestion, targetQuestion };
}

function makeConditionGroup(
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=',
  value: number,
  rowId: string,
): QuestionConditionGroup {
  return {
    logicType: 'AND',
    conditions: [
      {
        id: 'cond-1',
        sourceQuestionId: 'q-source',
        conditionType: 'table-cell-check',
        logicType: 'AND',
        tableConditions: {
          rowIds: [rowId],
          cellColumnIndex: 1,
          checkType: 'any',
          numericComparison: {
            operator,
            comparand: { kind: 'literal', value },
          },
        },
      },
    ],
  };
}

describe('branch-logic — numericComparison on input(number) cell', () => {
  const rowId = 'row-1';
  const cellId = 'cell-amount';

  function evalWithCellValue(cellValue: string, operator: any, comparandValue: number) {
    const { sourceQuestion } = makeFixture(rowId, cellId);
    const responses = {
      'q-source': { [cellId]: cellValue },
    };
    const group = makeConditionGroup(operator, comparandValue, rowId);
    return evaluateConditionGroup(group, responses, [sourceQuestion]);
  }

  it('== 0 matches "0"', () => {
    expect(evalWithCellValue('0', '==', 0)).toBe(true);
  });

  it('== 0 does not match "1"', () => {
    expect(evalWithCellValue('1', '==', 0)).toBe(false);
  });

  it('!= 0 matches "1"', () => {
    expect(evalWithCellValue('1', '!=', 0)).toBe(true);
  });

  it('!= 0 does not match "0"', () => {
    expect(evalWithCellValue('0', '!=', 0)).toBe(false);
  });

  it('>= 1 matches "1"', () => {
    expect(evalWithCellValue('1', '>=', 1)).toBe(true);
  });

  it('>= 1 matches "10"', () => {
    expect(evalWithCellValue('10', '>=', 1)).toBe(true);
  });

  it('>= 1 does not match "0"', () => {
    expect(evalWithCellValue('0', '>=', 1)).toBe(false);
  });

  it('> 0 does not match "0"', () => {
    expect(evalWithCellValue('0', '>', 0)).toBe(false);
  });

  it('< 1000 matches "999"', () => {
    expect(evalWithCellValue('999', '<', 1000)).toBe(true);
  });

  it('<= 1000 matches "1000"', () => {
    expect(evalWithCellValue('1000', '<=', 1000)).toBe(true);
  });

  it('supports negative values (== -5)', () => {
    expect(evalWithCellValue('-5', '==', -5)).toBe(true);
  });

  it('supports decimals (>= 1.5)', () => {
    expect(evalWithCellValue('1.5', '>=', 1.5)).toBe(true);
    expect(evalWithCellValue('1.4', '>=', 1.5)).toBe(false);
  });

  it('non-numeric cell value (NaN) → condition fails', () => {
    expect(evalWithCellValue('abc', '==', 0)).toBe(false);
    expect(evalWithCellValue('abc', '!=', 0)).toBe(false);
    expect(evalWithCellValue('abc', '>=', 0)).toBe(false);
  });

  it('empty cell → condition fails', () => {
    // 빈 셀은 기존 분기에서 cellValue falsy 처리되어 isChecked=false
    expect(evalWithCellValue('', '==', 0)).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `pnpm exec vitest run tests/unit/utils/branch-logic-numeric.test.ts`
Expected: 모든 테스트 FAIL (numericComparison 처리 분기가 아직 없어서 isChecked 가 항상 잘못된 값)

- [ ] **Step 3: 평가 엔진에 numericComparison 분기 추가**

`src/utils/branch-logic.ts` 의 input 셀 처리 부분 (1372-1382 줄 부근) 을 다음으로 교체:

```typescript
      } else if (
        cell.type === 'input' &&
        typeof cellValue === 'string' &&
        cellValue.trim() !== ''
      ) {
        const numericComparison = tableConditions?.numericComparison;
        if (numericComparison) {
          const left = parseFloat(cellValue.trim());
          if (Number.isNaN(left)) {
            isChecked = false;
          } else if (numericComparison.comparand.kind === 'literal') {
            const right = numericComparison.comparand.value;
            switch (numericComparison.operator) {
              case '==':
                isChecked = left === right;
                break;
              case '!=':
                isChecked = left !== right;
                break;
              case '>':
                isChecked = left > right;
                break;
              case '<':
                isChecked = left < right;
                break;
              case '>=':
                isChecked = left >= right;
                break;
              case '<=':
                isChecked = left <= right;
                break;
            }
          }
          // 미래 다른 kind 들은 default false (case 추가 전까지)
        } else if (expectedValues && expectedValues.length > 0) {
          isChecked = expectedValues.includes(cellValue.trim());
        } else {
          isChecked = true;
        }
      }
```

**중요:** 위 분기에서 `tableConditions?.numericComparison` 참조를 위해, 해당 분기를 둘러싼 함수에서 `tableConditions` 객체가 스코프에 있는지 먼저 확인. 만약 함수가 `expectedValues` 만 destructure 받고 있다면, 호출하는 상위 함수 시그니처에 `numericComparison` 도 같이 전달하도록 수정 필요. 코드 읽고 가장 작은 변경으로 처리.

- [ ] **Step 4: 같은 분기를 `additionalConditions` 처리부에도 추가**

`branch-logic.ts` 안에서 `additionalConditions` 가 처리되는 위치 (grep 으로 `additionalConditions` 검색) 를 찾아, input 셀 분기에 동일한 `numericComparison` 케이스를 추가. 위 Step 3 로직을 그대로 재사용 (헬퍼 함수 추출 권장):

```typescript
// branch-logic.ts 파일 최상단 또는 적절한 위치에 헬퍼 함수 추출
function evaluateNumericComparison(
  cellValue: string,
  numericComparison: { operator: string; comparand: { kind: 'literal'; value: number } },
): boolean {
  const left = parseFloat(cellValue.trim());
  if (Number.isNaN(left)) return false;
  if (numericComparison.comparand.kind !== 'literal') return false;
  const right = numericComparison.comparand.value;
  switch (numericComparison.operator) {
    case '==': return left === right;
    case '!=': return left !== right;
    case '>': return left > right;
    case '<': return left < right;
    case '>=': return left >= right;
    case '<=': return left <= right;
    default: return false;
  }
}
```

그리고 Step 3 의 switch 블록을 `isChecked = evaluateNumericComparison(cellValue, numericComparison);` 한 줄로 단순화.

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm exec vitest run tests/unit/utils/branch-logic-numeric.test.ts`
Expected: 모든 테스트 PASS (15+ 케이스)

- [ ] **Step 6: 회귀 확인 — 기존 분기 동작 그대로**

Run: `pnpm exec vitest run`
Expected: 기존 테스트도 모두 PASS. `numericComparison` 추가가 기존 expectedValues/값 있음 분기에 영향 없음.

- [ ] **Step 7: Commit**

```bash
git add src/utils/branch-logic.ts tests/unit/utils/branch-logic-numeric.test.ts
git commit -m "feat: 분기 조건 평가 엔진에 input 셀 숫자 비교 연산자 6종 추가"
```

---

### Task 3: 응답자 페이지 — 숫자 입력 필터링

**Files:**
- Modify: `src/components/survey-builder/cells/input-cell.tsx`

- [ ] **Step 1: 숫자 정규식 필터 onChange 추가**

`src/components/survey-builder/cells/input-cell.tsx` 의 `handleChange` 부분을 다음으로 교체:

```typescript
const isNumberMode = cell.inputType === 'number';

const handleChange = useCallback(
  (value: string) => {
    if (isNumberMode) {
      // 빈 문자열, 부호만, 소수점만 진행 중 상태도 허용. 자동 0 prepend 안 함.
      if (!/^-?\d*\.?\d*$/.test(value)) {
        return; // reject — 기존 값 유지
      }
    }
    onUpdateValue(value);
  },
  [onUpdateValue, isNumberMode],
);
```

- [ ] **Step 2: Input 컴포넌트 props 변경**

같은 파일의 `<Input ... />` 부분을 다음으로 교체:

```tsx
<Input
  type="text"
  inputMode={isNumberMode ? 'decimal' : undefined}
  value={textValue}
  onChange={(e) => handleChange(e.target.value)}
  placeholder={cell.placeholder || (isNumberMode ? '숫자를 입력하세요...' : '답변을 입력하세요...')}
  maxLength={cell.inputMaxLength}
  className="w-full text-base"
  disabled={isPrefilled}
  data-prefilled={isPrefilled || undefined}
  data-input-type={isNumberMode ? 'number' : undefined}
/>
```

핵심:
- `type="text"` 유지 (HTML `type="number"` 안 씀)
- `inputMode="decimal"` 으로 모바일 키패드만 숫자
- 빈 값 그대로 유지, 자동 0 prepend 없음

- [ ] **Step 3: 수동 검증 (브라우저)**

`pnpm dev` 띄우고 다음 절차로 테스트:

1. 설문 빌더에서 테이블 질문 만들고 input 셀 하나 추가 (`inputType: 'number'` 는 Task 4 에서 토글 도입 — 일단 테스트용으로 직접 `tableColumns[0].cells[0].inputType = 'number'` 라고 DB 또는 코드에서 set 해두거나, 빌더 콘솔에서 stores 직접 수정)
2. 응답자 페이지에서 그 셀에 입력:
   - "abc" → 입력 안 됨
   - "1000" → OK
   - "1,000" → 콤마 무시되고 "1000" 만 남음
   - 모두 지움 → 빈 상태 유지, 자동 0 안 들어옴
   - "-12.5" → OK

Expected: 위 동작 모두 OK. 모바일/태블릿 브라우저에서 키패드가 숫자 위주로 뜨는지도 가능하면 확인.

- [ ] **Step 4: Commit**

```bash
git add src/components/survey-builder/cells/input-cell.tsx
git commit -m "feat: input 셀 숫자 모드 — type=text+inputMode=decimal+정규식 필터"
```

---

### Task 4: 셀 에디터 — "숫자 입력" 토글

**Files:**
- Modify: `src/components/survey-builder/cell-content-modal.tsx`

- [ ] **Step 1: inputType state 추가**

`src/components/survey-builder/cell-content-modal.tsx` 의 input 관련 state 블록 (151줄 부근) 에 추가:

```typescript
const [inputPlaceholder, setInputPlaceholder] = useState(cell.placeholder || '');
const [inputMaxLength, setInputMaxLength] = useState<number | ''>(cell.inputMaxLength || '');
const [inputDefaultValueTemplate, setInputDefaultValueTemplate] = useState(
  cell.defaultValueTemplate || '',
);
const [inputType, setInputType] = useState<'text' | 'number'>(cell.inputType ?? 'text');
```

- [ ] **Step 2: 저장 시 cell.inputType 반영**

같은 파일의 저장 핸들러 (314-322 줄 부근) 에서 `placeholder`, `inputMaxLength`, `defaultValueTemplate` 옆에 `inputType` 추가:

```typescript
placeholder: contentType === 'input' ? inputPlaceholder : undefined,
inputMaxLength:
  contentType === 'input' && typeof inputMaxLength === 'number'
    ? inputMaxLength
    : undefined,
defaultValueTemplate:
  contentType === 'input' && inputDefaultValueTemplate.trim().length > 0
    ? inputDefaultValueTemplate.trim()
    : undefined,
inputType: contentType === 'input' ? inputType : undefined,
```

- [ ] **Step 3: reset 핸들러에 추가**

같은 파일의 cell-change reset (463 줄 부근) 옆에 한 줄 추가:

```typescript
setInputMaxLength(cell.inputMaxLength || '');
setInputType(cell.inputType ?? 'text');
```

(다른 reset 위치들도 grep 으로 찾아 동일하게 적용. 221 줄 부근 `setInputMaxLength(cell.inputMaxLength || '');` 위치 등)

- [ ] **Step 4: input 탭 UI 에 토글 추가**

같은 파일 input 탭 (`<TabsContent value="input" ...>` 833 줄 부근) 안에, 기존 placeholder/maxLength 필드들 사이 또는 위에 다음 블록 추가:

```tsx
<div className="space-y-2">
  <div className="flex items-start gap-3 rounded-md border border-gray-200 bg-gray-50 p-3">
    <input
      type="checkbox"
      id="input-type-number"
      checked={inputType === 'number'}
      onChange={(e) => setInputType(e.target.checked ? 'number' : 'text')}
      className="mt-0.5 h-4 w-4"
    />
    <label htmlFor="input-type-number" className="flex-1 cursor-pointer text-sm">
      <span className="font-medium">숫자 입력</span>
      <p className="mt-0.5 text-xs text-gray-500">
        체크 시 응답자는 숫자만 입력할 수 있고, 분기 조건에서 비교 연산자 (=, ≠, ≥, ≤, &gt;, &lt;) 를 사용할 수 있습니다.
      </p>
    </label>
  </div>
</div>
```

- [ ] **Step 5: 수동 검증**

`pnpm dev` 띄우고:
1. 설문 빌더에서 테이블 질문 만들고 input 셀 추가
2. 셀 편집 모달 열기 → "단문형 입력" 탭 진입
3. "숫자 입력" 토글 체크 → 저장
4. 셀 편집 모달 다시 열기 → 토글이 체크된 상태로 복원되는지 확인
5. 응답자 페이지에서 해당 셀이 Task 3 의 숫자 필터링 동작하는지 확인

Expected: 위 동작 모두 OK.

- [ ] **Step 6: Commit**

```bash
git add src/components/survey-builder/cell-content-modal.tsx
git commit -m "feat: input 셀 에디터에 '숫자 입력' 토글 추가"
```

---

### Task 5: 분기 조건 에디터 — NumericComparisonEditor 컴포넌트 신규

**Files:**
- Create: `src/components/survey-builder/numeric-comparison-editor.tsx`

- [ ] **Step 1: 재사용 가능한 비교 연산자 에디터 컴포넌트 작성**

`src/components/survey-builder/numeric-comparison-editor.tsx` 신규 작성:

```tsx
'use client';

import { useCallback } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { NumericComparison } from '@/types/survey';

interface NumericComparisonEditorProps {
  value?: NumericComparison;
  onChange: (value: NumericComparison | undefined) => void;
  idPrefix: string; // label htmlFor 충돌 방지 (외부 단일성 보장 위해)
}

const OPERATOR_OPTIONS: Array<{ value: NumericComparison['operator']; label: string }> = [
  { value: '==', label: '같음 (=)' },
  { value: '!=', label: '다름 (≠)' },
  { value: '>=', label: '이상 (≥)' },
  { value: '<=', label: '이하 (≤)' },
  { value: '>', label: '초과 (>)' },
  { value: '<', label: '미만 (<)' },
];

export function NumericComparisonEditor({
  value,
  onChange,
  idPrefix,
}: NumericComparisonEditorProps) {
  const operator = value?.operator ?? '==';
  const literalValue =
    value?.comparand?.kind === 'literal' ? String(value.comparand.value) : '';

  const handleOperatorChange = useCallback(
    (newOp: NumericComparison['operator']) => {
      const num = parseFloat(literalValue);
      onChange({
        operator: newOp,
        comparand: { kind: 'literal', value: Number.isNaN(num) ? 0 : num },
      });
    },
    [literalValue, onChange],
  );

  const handleValueChange = useCallback(
    (raw: string) => {
      // 빈 문자열, 부호만, 소수점만 진행 중 상태도 허용
      if (!/^-?\d*\.?\d*$/.test(raw)) return;
      if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
        // 진행 중 상태 — 임시로 0 저장 (UI 표시는 raw 그대로 보여줘야 하지만
        // 현재 구조상 상위 state 로 raw 를 별도 보관할 곳이 없어 부분 입력은 받지 않고 폼 검증에 위임)
        onChange({
          operator,
          comparand: { kind: 'literal', value: 0 },
        });
        return;
      }
      const num = parseFloat(raw);
      if (Number.isNaN(num)) return;
      onChange({
        operator,
        comparand: { kind: 'literal', value: num },
      });
    },
    [operator, onChange],
  );

  return (
    <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 p-3">
      <Label className="text-xs font-semibold tracking-wide text-blue-900">
        숫자 입력 셀 — 비교 조건
      </Label>
      <div className="flex items-stretch gap-2">
        <select
          id={`${idPrefix}-operator`}
          value={operator}
          onChange={(e) => handleOperatorChange(e.target.value as NumericComparison['operator'])}
          className="rounded-md border border-gray-300 bg-white p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          style={{ flex: '0 0 130px' }}
        >
          {OPERATOR_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <Input
          id={`${idPrefix}-value`}
          type="text"
          inputMode="decimal"
          value={literalValue}
          onChange={(e) => handleValueChange(e.target.value)}
          placeholder="숫자 입력"
          className="flex-1"
        />
      </div>
      <p className="text-xs text-slate-600">
        응답값이 위 숫자와 비교됩니다. 응답자는 셀에 숫자만 입력할 수 있습니다.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크 통과 확인**

Run: `pnpm exec tsc --noEmit`
Expected: 새 파일 관련 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/components/survey-builder/numeric-comparison-editor.tsx
git commit -m "feat: NumericComparisonEditor 재사용 컴포넌트 추가"
```

---

### Task 6: 분기 조건 에디터 — tableConditions UI 통합

**Files:**
- Modify: `src/components/survey-builder/question-condition-editor.tsx`

- [ ] **Step 1: 셀 타입 판정 헬퍼 함수 (파일 안 또는 utils)**

`src/components/survey-builder/question-condition-editor.tsx` 파일 상단 (import 직후) 에 헬퍼 추가:

```typescript
import { NumericComparisonEditor } from './numeric-comparison-editor';

function isNumericInputCell(
  sourceQuestion: Question | undefined,
  rowIds: string[],
  cellColumnIndex: number | undefined,
): boolean {
  if (!sourceQuestion || cellColumnIndex === undefined) return false;
  if (rowIds.length === 0) return false;
  const row = sourceQuestion.tableRowsData?.find((r) => r.id === rowIds[0]);
  if (!row) return false;
  const cell = row.cells[cellColumnIndex];
  return cell?.type === 'input' && cell.inputType === 'number';
}
```

(이미 `Question` 타입 import 안 되어 있으면 `import type { Question } from '@/types/survey';` 추가)

- [ ] **Step 2: tableConditions UI 분기 — TableOptionSelector 호출 부분**

`src/components/survey-builder/question-condition-editor.tsx:515-538` 부분 (TableOptionSelector 노출 블록) 을 다음으로 교체:

```tsx
{/* 확인할 옵션 / 숫자 비교 (셀 타입에 따라 분기) */}
{condition.tableConditions?.rowIds &&
  condition.tableConditions.rowIds.length > 0 &&
  condition.tableConditions?.cellColumnIndex !== undefined &&
  sourceQuestion && (
    isNumericInputCell(
      sourceQuestion,
      condition.tableConditions.rowIds,
      condition.tableConditions.cellColumnIndex,
    ) ? (
      <NumericComparisonEditor
        idPrefix={`numeric-${condition.id}`}
        value={condition.tableConditions.numericComparison}
        onChange={(nc) => {
          updateCondition(condition.id, {
            tableConditions: {
              ...condition.tableConditions,
              rowIds: condition.tableConditions?.rowIds || [],
              checkType: condition.tableConditions?.checkType || 'any',
              cellColumnIndex: condition.tableConditions?.cellColumnIndex,
              expectedValues: undefined, // 숫자 비교 모드에선 사용 안 함
              numericComparison: nc,
            },
          });
        }}
      />
    ) : (
      <TableOptionSelector
        question={sourceQuestion}
        rowIds={condition.tableConditions.rowIds}
        colIndex={condition.tableConditions.cellColumnIndex}
        expectedValues={condition.tableConditions.expectedValues}
        onChange={(values) => {
          updateCondition(condition.id, {
            tableConditions: {
              ...condition.tableConditions,
              rowIds: condition.tableConditions?.rowIds || [],
              checkType: condition.tableConditions?.checkType || 'any',
              cellColumnIndex: condition.tableConditions?.cellColumnIndex,
              expectedValues: values,
              numericComparison: undefined, // 옵션 매칭 모드에선 사용 안 함
            },
          });
        }}
        multipleRows={condition.tableConditions.rowIds.length > 1}
      />
    )
  )}
```

핵심: `isNumericInputCell` 결과에 따라 두 컴포넌트 중 하나만 노출. 한쪽 값을 set 할 때 다른 쪽은 `undefined` 로 명시적 클리어 (잔존 데이터 방지).

- [ ] **Step 3: 수동 검증 (tableConditions 측)**

`pnpm dev`:
1. 일반 input 셀 (inputType=text) 만 있는 테이블 → 분기 조건 에디터 → 기존 `TableOptionSelector` 노출되는지
2. 셀 에디터에서 "숫자 입력" 토글 켠 후 → 분기 조건 에디터 다시 열어보면 → `NumericComparisonEditor` 노출되는지
3. 연산자/값 변경 후 저장 → DB 또는 store 에 `numericComparison: { operator, comparand: { kind, value } }` 형태로 저장되는지

Expected: 위 모두 OK.

- [ ] **Step 4: Commit**

```bash
git add src/components/survey-builder/question-condition-editor.tsx
git commit -m "feat: 분기 조건 에디터 — 숫자 셀이면 NumericComparisonEditor 자동 노출"
```

---

### Task 7: 분기 조건 에디터 — additionalConditions UI 통합

**Files:**
- Modify: `src/components/survey-builder/question-condition-editor.tsx` (628-650 줄 부근)

- [ ] **Step 1: additionalConditions 영역에도 동일 분기 적용**

`src/components/survey-builder/question-condition-editor.tsx` 안에서 `additionalConditions` 의 `TableOptionSelector` 호출 부분 (628-650 줄 부근) 을 찾아, 동일한 패턴으로 분기:

```tsx
{/* 추가 조건 확인할 옵션 / 숫자 비교 */}
{condition.additionalConditions.checkType !== 'input' &&
  condition.additionalConditions.cellColumnIndex !== undefined &&
  sourceQuestion && (
    (() => {
      const effectiveRowIds =
        (condition.tableConditions?.rowIds?.length ?? 0) > 0
          ? (condition.tableConditions?.rowIds ?? [])
          : sourceQuestion.tableRowsData?.map((r) => r.id) || [];
      const isNumeric = isNumericInputCell(
        sourceQuestion,
        effectiveRowIds,
        condition.additionalConditions.cellColumnIndex,
      );
      return isNumeric ? (
        <NumericComparisonEditor
          idPrefix={`numeric-additional-${condition.id}`}
          value={condition.additionalConditions.numericComparison}
          onChange={(nc) => {
            updateCondition(condition.id, {
              additionalConditions: {
                ...condition.additionalConditions!,
                expectedValues: undefined,
                numericComparison: nc,
              },
            });
          }}
        />
      ) : (
        <TableOptionSelector
          question={sourceQuestion}
          rowIds={effectiveRowIds}
          colIndex={condition.additionalConditions.cellColumnIndex}
          expectedValues={condition.additionalConditions.expectedValues}
          onChange={(values) => {
            updateCondition(condition.id, {
              additionalConditions: {
                ...condition.additionalConditions!,
                expectedValues: values,
                numericComparison: undefined,
              },
            });
          }}
          helpText="선택한 옵션들 중 하나가 선택되었는지 확인합니다. 비워두면 아무거나 선택되었는지만 확인합니다."
        />
      );
    })()
  )}
```

**중요:** `condition.additionalConditions.checkType !== 'input'` 조건은 기존 로직. input 셀 (text/number 둘 다) 에 대해선 expectedValues 입력 안 받고 "값 있음" 또는 "숫자 비교" 만 노출. 위 코드는 input 셀 중 number 만 비교 UI 노출.

이전 조건 `checkType !== 'input'` 을 `checkType !== 'input' || isNumericInputCell(...)` 로 확장 필요. 정확한 변경:

```tsx
{((condition.additionalConditions.checkType !== 'input') ||
  isNumericInputCell(
    sourceQuestion,
    /* effectiveRowIds 계산 — 위와 동일 */
    condition.additionalConditions.cellColumnIndex,
  )) &&
  condition.additionalConditions.cellColumnIndex !== undefined &&
  sourceQuestion && (
    // 위 IIFE 블록
  )}
```

(이중 계산 피하려면 effectiveRowIds + isNumeric 을 컴포넌트 함수 본문 상위에서 한 번만 계산)

- [ ] **Step 2: 수동 검증**

`pnpm dev`:
1. 추가 조건 토글 on
2. 추가 조건의 `cellColumnIndex` 를 숫자 셀 열로 지정 → `NumericComparisonEditor` 노출
3. 동일 열을 일반 input 셀로 바꾸면 → 기존 "값 있음" 모드로 복귀

Expected: 모두 OK.

- [ ] **Step 3: Commit**

```bash
git add src/components/survey-builder/question-condition-editor.tsx
git commit -m "feat: 분기 조건 에디터 additionalConditions 에도 숫자 비교 UI 분기 적용"
```

---

### Task 8: 통합 검증 — 5-1-1 시나리오 E2E (수동)

**Files:** 없음 (수동 검증)

- [ ] **Step 1: 5-1-1 패턴 설문 구성**

`pnpm dev` 띄우고 빌더에서:

1. 테이블 질문 생성. 행 6개 (1)~6)) + 열 2개 (건수/금액). 두 열 모두 input + 숫자 입력 토글 on.
2. 추가 질문 생성 (예: "0원으로 기재한 이유"). 이 질문의 displayCondition 으로:
   - 조건 1: 테이블의 ⑤행 건수 열 → 이상 (≥) → 1
   - 조건 2: 테이블의 ⑥행 금액 열 → 같음 (==) → 0
   - logic: AND
3. 테스트 모드 / 미리보기에서 시나리오 4종 검증:
   - ⑤=1, ⑥=0 → 추가 질문 표시 ✓
   - ⑤=0, ⑥=0 → 안 표시 ✓
   - ⑤=1, ⑥=1000 → 안 표시 ✓
   - ⑤=비움, ⑥=0 → 안 표시 ✓

Expected: 모두 OK.

- [ ] **Step 2: 4가지 표시 대상 자동 혜택 확인**

같은 비교 조건을 다음 4군데에 걸어보고 동작 확인:
1. 문항 displayCondition (Task 8 Step 1 그대로)
2. 그룹 displayCondition
3. 테이블 행 displayCondition (다른 표의 행이 위 비교 결과에 따라 보이도록)
4. 테이블 열 displayCondition (다른 표의 열이 위 비교 결과에 따라 보이도록)

Expected: 4개 모두 동일하게 동작.

- [ ] **Step 3: 응답 저장 후 재진입 동작 확인**

응답을 진짜 제출 (테스트 모드 아니라 비공개 토큰 URL 로 응답) 후 다시 진입 시:
- 응답이 정상 저장되는지 (`survey_responses.questionResponses`)
- 빌더 분기 조건이 publish 된 snapshot 에 반영되어 있는지 (응답 페이지는 snapshot 기반 — [memory: project_response_page_snapshot_based](../../../.claude/projects/-Users-ljwoon-study-next-study-survey-table-project/memory/project_response_page_snapshot_based.md))

Expected: 저장/표시 모두 OK. publish 누락 함정 없는지 확인.

- [ ] **Step 4: 빌드 검증**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm build`
Expected: 모두 통과.

- [ ] **Step 5: 마지막 정리 커밋 (필요 시)**

Step 1-4 중 발견된 작은 이슈 (placeholder 문구, 라벨 정렬 등) 가 있으면 한 번에 처리하고 커밋.

```bash
git status
# 변경 있으면:
git add <files>
git commit -m "fix: 5-1-1 통합 검증에서 발견된 마이너 이슈 정리"
```

---

## Self-Review Notes

**Spec 커버리지 매핑:**
- D1 (displayCondition only): Task 8 의 4가지 표시 대상 검증
- D2 (inputType meta): Task 1 Step 1 + Task 4
- D3 (HTML number 회피): Task 3 Step 1-2
- D4 (6개 연산자 풀세트): Task 2 단위 테스트 + Task 5 OPERATOR_OPTIONS
- D5 (forward-compat union): Task 1 Step 2 `ComparandRef` 정의
- D6 (평가 엔진 한 곳): Task 2 Step 3-4 (헬퍼 추출로 두 호출처 단일 로직)
- D7 (빈/NaN 처리): Task 2 단위 테스트 마지막 케이스

**리스크 검증:**
- 부동소수점: Task 2 단위 테스트에 정수 위주 케이스. 사용자 입력 직접 비교라 문제 적음.
- Stale 조건 (셀 타입 변경 후 numericComparison 잔존): 비범위. Task 6/7 의 onChange 에서 한 모드 set 시 반대 모드 `undefined` 로 클리어해 잔존 최소화는 하지만, 셀 inputType 자체를 number→text 로 되돌리는 케이스는 별도 트랙.
- Snapshot publish: Task 8 Step 3 에서 검증.

**비치환 추가 작업 점검:**
- 마이그레이션 불필요 (JSONB optional 필드).
- 평가 엔진 변경이 다른 호출처 (테이블 검증 규칙 등) 에 영향 없는지: branch-logic.ts 의 input 셀 분기는 displayCondition 평가 전용이 아니라 공유 가능성 있음. Task 2 Step 6 회귀 테스트로 검증.
