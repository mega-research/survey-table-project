# expression conditionType 구현 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `conditionType: 'expression'` 모드의 데이터 모델 + 평가기 + 빌더 UI + legacy 마이그레이션 헬퍼를 구현. 4-source operand (literal/cell/question/attr/lookup) + 재귀 binop 산술 + Notion-filter 스타일 clause 목록.

**Architecture:** 데이터 모델/평가기는 재귀 구조라 n-deep 자동 지원. UI 만 `MAX_OPERAND_DEPTH=2` / `MAX_GROUP_DEPTH=1` 가드. legacy `NumericComparison.{left, right}` 데이터는 수동 트리거 변환 헬퍼.

**Tech Stack:** Next.js 16 · React 19 · TypeScript strict · vitest · shadcn/ui · Drizzle JSONB

**Spec:** [docs/superpowers/specs/2026-05-26-expression-condition-design.md](../specs/2026-05-26-expression-condition-design.md)

---

## 사전 컨텍스트

### 베이스 브랜치 셋업

본 작업은 `feat/lookup-comparison` 위에 빌드 + 이전 `feat/display-condition-cleanup` 작업 cherry-pick. 먼저 cleanup 을 정착시킨 후 expression 모드 시작.

### 변경 / 신규 파일

- **신규**: `src/components/survey-builder/expression-condition-editor.tsx`
- **신규**: `src/components/survey-builder/expression-operand-picker.tsx`
- **신규**: `src/utils/expression-migration.ts`
- **신규**: `tests/unit/utils/expression-eval.test.ts`
- **신규**: `tests/unit/utils/expression-migration.test.ts`
- **수정**: `src/types/survey.ts` — 신규 타입 + `QuestionCondition.expressionConfig` 추가
- **수정**: `src/db/schema/schema-types.ts` — 미러
- **수정**: `src/utils/branch-logic.ts` — evaluator 추가
- **수정**: `src/components/survey-builder/question-condition-editor.tsx` — 드롭다운 enable + 마운트 + 마이그레이션 버튼

### 검증 명령

- 타입: `pnpm exec tsc --noEmit`
- 단위 테스트: `pnpm exec vitest run`
- 빌드: `pnpm build`

---

## Phase 0: 브랜치 셋업

수동 작업 (subagent 비대상). controller 가 직접 수행.

- [ ] **0.1: 새 브랜치 생성**

```bash
git checkout feat/lookup-comparison
git checkout -b feat/expression-condition
```

- [ ] **0.2: cleanup 작업 cherry-pick**

`feat/display-condition-cleanup` 머지 commit + 이후 refactor 까지 가져오기. `feature/numeric-comparison` 의 cleanup 머지 commit 은 `ecd0f74`, 이후 polish `173e102`, refactor `d866b4e`, expression spec `6744ac0`. 단 expression spec 만 따로 cherry-pick (cleanup 본체는 별도 commit 들).

```bash
# cleanup 본체 commits (chronological)
git cherry-pick ac32833   # conditionType union 'expression'
git cherry-pick 64fae92   # detectCellTypeKind + tests
git cherry-pick afef29d   # 메인 펼치기 — 충돌 예상
git cherry-pick c9bab59   # 추가 펼치기 — 충돌 예상
git cherry-pick fa3d90c   # expression 드롭다운 placeholder
git cherry-pick 173e102   # polish
git cherry-pick d866b4e   # ValueComparisonExpander 추출
git cherry-pick 6744ac0   # spec 문서 (충돌 없을 예정)
```

- [ ] **0.3: 충돌 해소 지침**

`afef29d` 와 `c9bab59` cherry-pick 시 `question-condition-editor.tsx` 충돌 예상. feat/lookup-comparison 의 NumericComparisonEditor 는 `sourceQuestionId` prop 받고 LeftOperandEditor 사용. 우리 cleanup 은 펼치기 패턴으로 그 블록 자체를 교체.

해소 방향:
- 우리 cleanup 버전 (펼치기 + ValueComparisonExpander) 우선 채택
- NumericComparisonEditor 호출에서 `sourceQuestionId` prop 제거 또는 옵션 무시 — Task 1 의 사전 단계에서 NumericComparisonEditor 자체를 정리

NumericComparisonEditor 본체도 충돌 가능 — cleanup 의 d866b4e 가 NumericComparisonEditor 좌변 탭 제거 시도하나 베이스가 numeric-comparison 이라 좌변 탭 자체가 없었음. lookup-comparison 베이스에는 좌변 탭이 있으므로 추가 작업 필요:

- `numeric-comparison-editor.tsx` 의 LeftOperandEditor import + 좌변 탭 JSX 제거
- 신규 BinopReadonlyLabel 인라인 컴포넌트 (spec 의 cleanup Task 3 참조)

이 부분은 cherry-pick 후 별도 commit:

```bash
# 충돌 해소 후
git commit -am "fix: cleanup conflict resolution — NumericComparisonEditor 좌변 탭 제거 + binop read-only"
```

- [ ] **0.4: tsc + vitest 회귀**

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run
```

둘 다 통과해야 Phase 1 진입.

---

## Phase 1: 데이터 모델

## Task 1: 타입 정의

**Files:**
- Modify: `src/types/survey.ts`
- Modify: `src/db/schema/schema-types.ts`

- [ ] **Step 1: ExpressionOperand 등 타입 추가**

`src/types/survey.ts` 의 `QuestionCondition` 인터페이스 **위** (148번째 줄 부근, `// 질문 표시 조건` 주석 직전) 에 추가:

```ts
// expression 조건 모드 — operand 재귀 union
export type ExpressionOperand =
  | { kind: 'literal'; value: number | string }
  | { kind: 'cell'; questionId: string; cellId: string }
  | { kind: 'question'; questionId: string }
  | {
      kind: 'lookup';
      surveyLookupId: string;
      keyMapping: Array<{ lutKey: string; attrsKey: string }>;
      valueColumn: string;
    }
  | { kind: 'attr'; attrsKey: string }
  | {
      kind: 'binop';
      op: '+' | '-' | '*' | '/';
      left: ExpressionOperand;
      right: ExpressionOperand;
    };

export interface ExpressionComparison {
  left: ExpressionOperand;
  op: '==' | '!=' | '>' | '<' | '>=' | '<=';
  right: ExpressionOperand;
}

export type ExpressionClause =
  | { kind: 'comparison'; comparison: ExpressionComparison }
  | { kind: 'group'; group: ExpressionConditionConfig };

export interface ExpressionConditionConfig {
  clauses: ExpressionClause[];
  joinOps: Array<'AND' | 'OR'>;
}
```

- [ ] **Step 2: QuestionCondition 에 expressionConfig 필드 추가**

`QuestionCondition` 인터페이스의 마지막 필드 (`enabled?: boolean;`) 위에 추가:

```ts
  expressionConfig?: ExpressionConditionConfig; // conditionType === 'expression' 일 때만 사용
```

- [ ] **Step 3: schema-types.ts 미러**

`src/db/schema/schema-types.ts` 의 `QuestionCondition` 인터페이스에 동일하게 `expressionConfig?: ExpressionConditionConfig` 추가. `ExpressionOperand` 등 타입도 같은 파일에 복사 또는 `import type { ... } from '@/types/survey'` (existing schema-types pattern 확인 필요 — 기존 import 안 쓰면 복사).

- [ ] **Step 4: tsc 통과**

Run: `pnpm exec tsc --noEmit`
Expected: 통과

- [ ] **Step 5: 커밋**

```bash
git add src/types/survey.ts src/db/schema/schema-types.ts
git commit -m "feat: expression 조건 모드 타입 정의 추가"
```
HEREDOC + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.

---

## Phase 2: Evaluator

## Task 2: branch-logic.ts 확장 (TDD)

**Files:**
- Create: `tests/unit/utils/expression-eval.test.ts`
- Modify: `src/utils/branch-logic.ts`

- [ ] **Step 1: 실패 테스트 작성**

`tests/unit/utils/expression-eval.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type {
  ExpressionConditionConfig,
  Question,
  QuestionCondition,
  SurveyLookup,
} from '@/types/survey';
import { shouldDisplayQuestion } from '@/utils/branch-logic';

// 헬퍼: source 질문 (table) 생성 — 셀 응답값을 evaluator 가 추출
function makeTableQuestion(): Question {
  return {
    id: 'q-table',
    surveyId: 's1',
    type: 'table',
    title: '비용표',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'col-label', label: '항목' },
      { id: 'col-amount', label: '금액' },
    ],
    tableRowsData: [
      {
        id: 'row-출장비',
        label: '출장비',
        cells: [
          { id: 'cell-lbl-1', content: '출장비', type: 'text' as const },
          {
            id: 'cell-출장비',
            content: '',
            type: 'input' as const,
            inputType: 'number' as const,
          },
        ],
      },
      {
        id: 'row-인원',
        label: '인원',
        cells: [
          { id: 'cell-lbl-2', content: '인원', type: 'text' as const },
          {
            id: 'cell-인원',
            content: '',
            type: 'input' as const,
            inputType: 'number' as const,
          },
        ],
      },
    ],
  } as unknown as Question;
}

function makeTargetQuestion(expressionConfig: ExpressionConditionConfig): Question {
  const condition: QuestionCondition = {
    id: 'c1',
    sourceQuestionId: 'q-table',
    conditionType: 'expression',
    logicType: 'AND',
    enabled: true,
    expressionConfig,
  };
  return {
    id: 'q-target',
    surveyId: 's1',
    type: 'text',
    title: '타겟',
    required: false,
    order: 1,
    displayCondition: { conditions: [condition], logicType: 'AND' },
  } as unknown as Question;
}

function makeResponses(amountValue: number, peopleValue: number) {
  return {
    'q-table': {
      questionId: 'q-table',
      questionType: 'table',
      tableResponse: {
        'row-출장비': { 'cell-출장비': String(amountValue) },
        'row-인원':   { 'cell-인원':   String(peopleValue) },
      },
    },
  };
}

describe('expression conditionType — evaluator', () => {
  it('literal == literal → true', () => {
    const config: ExpressionConditionConfig = {
      clauses: [{
        kind: 'comparison',
        comparison: {
          left: { kind: 'literal', value: 5 },
          op: '==',
          right: { kind: 'literal', value: 5 },
        },
      }],
      joinOps: [],
    };
    const target = makeTargetQuestion(config);
    expect(shouldDisplayQuestion(target, {}, [makeTableQuestion(), target])).toBe(true);
  });

  it('cell ÷ cell ≤ literal — 출장비/인원 ≤ 100만원, 만족', () => {
    const config: ExpressionConditionConfig = {
      clauses: [{
        kind: 'comparison',
        comparison: {
          left: {
            kind: 'binop', op: '/',
            left:  { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
            right: { kind: 'cell', questionId: 'q-table', cellId: 'cell-인원' },
          },
          op: '<=',
          right: { kind: 'literal', value: 1000000 },
        },
      }],
      joinOps: [],
    };
    const target = makeTargetQuestion(config);
    const responses = makeResponses(900000, 1); // 900000/1 = 900000 ≤ 1000000 → true
    expect(shouldDisplayQuestion(target, responses, [makeTableQuestion(), target])).toBe(true);
  });

  it('cell ÷ cell ≤ literal — 출장비/인원 ≤ 100만원, 불만족', () => {
    const config: ExpressionConditionConfig = {
      clauses: [{
        kind: 'comparison',
        comparison: {
          left: {
            kind: 'binop', op: '/',
            left:  { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
            right: { kind: 'cell', questionId: 'q-table', cellId: 'cell-인원' },
          },
          op: '<=',
          right: { kind: 'literal', value: 1000000 },
        },
      }],
      joinOps: [],
    };
    const target = makeTargetQuestion(config);
    const responses = makeResponses(3000000, 1); // 3000000 > 1000000 → false
    expect(shouldDisplayQuestion(target, responses, [makeTableQuestion(), target])).toBe(false);
  });

  it('binop with /0 → undefined → fail-safe SHOW (true)', () => {
    const config: ExpressionConditionConfig = {
      clauses: [{
        kind: 'comparison',
        comparison: {
          left: {
            kind: 'binop', op: '/',
            left:  { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
            right: { kind: 'cell', questionId: 'q-table', cellId: 'cell-인원' },
          },
          op: '<=',
          right: { kind: 'literal', value: 100 },
        },
      }],
      joinOps: [],
    };
    const target = makeTargetQuestion(config);
    const responses = makeResponses(500, 0); // 500/0 = undefined → SHOW
    expect(shouldDisplayQuestion(target, responses, [makeTableQuestion(), target])).toBe(true);
  });

  it('AND clause 조합 — 둘 다 만족', () => {
    const config: ExpressionConditionConfig = {
      clauses: [
        {
          kind: 'comparison',
          comparison: {
            left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
            op: '>',
            right: { kind: 'literal', value: 100 },
          },
        },
        {
          kind: 'comparison',
          comparison: {
            left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-인원' },
            op: '>',
            right: { kind: 'literal', value: 0 },
          },
        },
      ],
      joinOps: ['AND'],
    };
    const target = makeTargetQuestion(config);
    const responses = makeResponses(500, 2);
    expect(shouldDisplayQuestion(target, responses, [makeTableQuestion(), target])).toBe(true);
  });

  it('AND clause 조합 — 한쪽 불만족', () => {
    const config: ExpressionConditionConfig = {
      clauses: [
        {
          kind: 'comparison',
          comparison: {
            left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
            op: '>',
            right: { kind: 'literal', value: 1000 },
          },
        },
        {
          kind: 'comparison',
          comparison: {
            left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-인원' },
            op: '>',
            right: { kind: 'literal', value: 0 },
          },
        },
      ],
      joinOps: ['AND'],
    };
    const target = makeTargetQuestion(config);
    const responses = makeResponses(500, 2); // 500 > 1000 false → false
    expect(shouldDisplayQuestion(target, responses, [makeTableQuestion(), target])).toBe(false);
  });

  it('OR clause 조합 — 하나 만족', () => {
    const config: ExpressionConditionConfig = {
      clauses: [
        {
          kind: 'comparison',
          comparison: {
            left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
            op: '>',
            right: { kind: 'literal', value: 1000 },
          },
        },
        {
          kind: 'comparison',
          comparison: {
            left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-인원' },
            op: '>=',
            right: { kind: 'literal', value: 1 },
          },
        },
      ],
      joinOps: ['OR'],
    };
    const target = makeTargetQuestion(config);
    const responses = makeResponses(500, 2); // 500>1000 false || 2>=1 true → true
    expect(shouldDisplayQuestion(target, responses, [makeTableQuestion(), target])).toBe(true);
  });

  it('group 안의 clause 평가', () => {
    const config: ExpressionConditionConfig = {
      clauses: [{
        kind: 'group',
        group: {
          clauses: [{
            kind: 'comparison',
            comparison: {
              left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
              op: '>',
              right: { kind: 'literal', value: 100 },
            },
          }],
          joinOps: [],
        },
      }],
      joinOps: [],
    };
    const target = makeTargetQuestion(config);
    expect(shouldDisplayQuestion(target, makeResponses(500, 1), [makeTableQuestion(), target])).toBe(true);
  });

  it('빈 clauses → true (fail-safe SHOW)', () => {
    const config: ExpressionConditionConfig = { clauses: [], joinOps: [] };
    const target = makeTargetQuestion(config);
    expect(shouldDisplayQuestion(target, {}, [makeTableQuestion(), target])).toBe(true);
  });

  it('응답 부재 → undefined operand → SHOW', () => {
    const config: ExpressionConditionConfig = {
      clauses: [{
        kind: 'comparison',
        comparison: {
          left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
          op: '>',
          right: { kind: 'literal', value: 0 },
        },
      }],
      joinOps: [],
    };
    const target = makeTargetQuestion(config);
    expect(shouldDisplayQuestion(target, {}, [makeTableQuestion(), target])).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec vitest run tests/unit/utils/expression-eval.test.ts`
Expected: 모두 FAIL — `conditionType: 'expression'` 분기가 없어 평가 결과 부적합

- [ ] **Step 3: branch-logic.ts 에 evaluator 함수 추가**

기존 `evaluateLookup` 또는 `evaluateNumericComparisonV2` 헬퍼들 근처에 추가. 정확한 위치는 implementer 가 판단:

```ts
function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function evaluateExpressionOperand(
  operand: ExpressionOperand,
  responses: Record<string, QuestionResponse>,
  ctx: BranchEvalCtx,
): number | string | undefined {
  switch (operand.kind) {
    case 'literal':
      return operand.value;
    case 'cell': {
      const qr = responses[operand.questionId];
      if (!qr || qr.questionType !== 'table' || !qr.tableResponse) return undefined;
      // tableResponse 구조: { rowId: { cellId: value } }
      for (const rowResponse of Object.values(qr.tableResponse)) {
        if (rowResponse && operand.cellId in rowResponse) {
          const v = rowResponse[operand.cellId];
          if (v === undefined || v === '') return undefined;
          return typeof v === 'string' || typeof v === 'number' ? v : undefined;
        }
      }
      return undefined;
    }
    case 'question': {
      const qr = responses[operand.questionId];
      if (!qr) return undefined;
      if (qr.questionType === 'text' || qr.questionType === 'textarea') return qr.textResponse;
      if (qr.questionType === 'radio' || qr.questionType === 'select') return qr.selectedValue;
      // 기타 question type 은 expression 비교 대상 외 — undefined
      return undefined;
    }
    case 'lookup': {
      // 기존 evaluateLookup 헬퍼 재사용 — RightOperand.lookup 과 시그니처 동일
      return evaluateLookup(operand, ctx);
    }
    case 'attr': {
      return ctx.attrs?.[operand.attrsKey];
    }
    case 'binop': {
      const L = toNumber(evaluateExpressionOperand(operand.left, responses, ctx));
      const R = toNumber(evaluateExpressionOperand(operand.right, responses, ctx));
      if (L === undefined || R === undefined) return undefined;
      switch (operand.op) {
        case '+': return L + R;
        case '-': return L - R;
        case '*': return L * R;
        case '/': return R === 0 ? undefined : L / R;
      }
    }
  }
}

function evaluateExpressionComparison(
  comparison: ExpressionComparison,
  responses: Record<string, QuestionResponse>,
  ctx: BranchEvalCtx,
): boolean {
  const L = evaluateExpressionOperand(comparison.left, responses, ctx);
  const R = evaluateExpressionOperand(comparison.right, responses, ctx);
  if (L === undefined || R === undefined) return true; // fail-safe SHOW

  if (comparison.op === '==' || comparison.op === '!=') {
    const eq = String(L) === String(R);
    return comparison.op === '==' ? eq : !eq;
  }
  const ln = toNumber(L);
  const rn = toNumber(R);
  if (ln === undefined || rn === undefined) return true;
  switch (comparison.op) {
    case '>': return ln > rn;
    case '<': return ln < rn;
    case '>=': return ln >= rn;
    case '<=': return ln <= rn;
  }
}

function evaluateExpressionClause(
  clause: ExpressionClause,
  responses: Record<string, QuestionResponse>,
  ctx: BranchEvalCtx,
): boolean {
  if (clause.kind === 'comparison') return evaluateExpressionComparison(clause.comparison, responses, ctx);
  return evaluateExpressionConfig(clause.group, responses, ctx);
}

function evaluateExpressionConfig(
  config: ExpressionConditionConfig,
  responses: Record<string, QuestionResponse>,
  ctx: BranchEvalCtx,
): boolean {
  if (config.clauses.length === 0) return true;
  let acc = evaluateExpressionClause(config.clauses[0], responses, ctx);
  for (let i = 1; i < config.clauses.length; i++) {
    const next = evaluateExpressionClause(config.clauses[i], responses, ctx);
    const op = config.joinOps[i - 1] ?? 'AND';
    acc = op === 'AND' ? (acc && next) : (acc || next);
  }
  return acc;
}
```

import 들을 파일 상단에 추가:

```ts
import type {
  ExpressionClause,
  ExpressionComparison,
  ExpressionConditionConfig,
  ExpressionOperand,
} from '@/types/survey';
```

- [ ] **Step 4: shouldDisplayQuestion 의 분기에 'expression' 추가**

`evaluateQuestionCondition` (또는 동등 함수) 의 switch 에서 `case 'table-cell-check':` 옆에 `case 'expression':` 추가:

```ts
case 'expression':
  if (condition.expressionConfig) {
    return evaluateExpressionConfig(condition.expressionConfig, responses, evalCtx);
  }
  return true;
```

정확한 위치는 implementer 가 파일을 읽고 판단. 기존 패턴 따라가기.

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm exec vitest run tests/unit/utils/expression-eval.test.ts`
Expected: 10개 모두 PASS

- [ ] **Step 6: 회귀 확인**

Run: `pnpm exec vitest run tests/unit/utils/branch-logic-numeric.test.ts tests/unit/utils/cell-type-detector.test.ts`
Expected: 둘 다 PASS (기존 evaluator 무변경)

- [ ] **Step 7: 커밋**

```bash
git add src/utils/branch-logic.ts tests/unit/utils/expression-eval.test.ts
git commit -m "feat: expression conditionType evaluator + 단위 테스트"
```
HEREDOC + Co-Authored-By.

---

## Phase 3: 빌더 UI

## Task 3: OperandPicker 컴포넌트

**Files:**
- Create: `src/components/survey-builder/expression-operand-picker.tsx`

OperandPicker 는 6 kinds (literal/cell/question/attr/lookup/binop) 중 하나를 선택하고 각 kind 의 sub-editor 를 렌더. binop 만 재귀 (`OperandPicker × 2`). depth 가드.

- [ ] **Step 1: 기본 골격**

```tsx
'use client';

import { useState } from 'react';

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { ExpressionOperand, Question } from '@/types/survey';

export const MAX_OPERAND_DEPTH = 2;

interface OperandPickerProps {
  value: ExpressionOperand | undefined;
  onChange: (next: ExpressionOperand) => void;
  currentDepth: number; // root = 0
  idPrefix: string;
}

const KIND_LABELS: Record<ExpressionOperand['kind'], string> = {
  literal: '직접 입력',
  cell: '테이블 셀',
  question: '질문 응답',
  attr: '컨택 메타데이터',
  lookup: '외부 데이터 (LUT)',
  binop: '계산 (산술)',
};

export function ExpressionOperandPicker({
  value, onChange, currentDepth, idPrefix,
}: OperandPickerProps) {
  const questions = useSurveyBuilderStore((s) => s.currentSurvey.questions);
  const contactColumns = useSurveyBuilderStore((s) => s.currentSurvey.contactColumns ?? []);
  const lookups = useSurveyBuilderStore((s) => s.currentSurvey.surveyLookups ?? []);

  const canNestBinop = currentDepth < MAX_OPERAND_DEPTH;

  // kind 변경 시 빈 값으로 초기화
  const setKind = (kind: ExpressionOperand['kind']) => {
    switch (kind) {
      case 'literal':  onChange({ kind: 'literal', value: 0 }); break;
      case 'cell':     onChange({ kind: 'cell', questionId: '', cellId: '' }); break;
      case 'question': onChange({ kind: 'question', questionId: '' }); break;
      case 'attr':     onChange({ kind: 'attr', attrsKey: '' }); break;
      case 'lookup':   onChange({ kind: 'lookup', surveyLookupId: '', keyMapping: [], valueColumn: '' }); break;
      case 'binop':    onChange({
        kind: 'binop', op: '+',
        left:  { kind: 'literal', value: 0 },
        right: { kind: 'literal', value: 0 },
      }); break;
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-2">
      <Select value={value?.kind ?? ''} onValueChange={(v) => setKind(v as ExpressionOperand['kind'])}>
        <SelectTrigger id={`${idPrefix}-kind`} className="w-full">
          <SelectValue placeholder="operand 선택" />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(KIND_LABELS) as Array<ExpressionOperand['kind']>)
            .filter((k) => k !== 'binop' || canNestBinop)
            .map((k) => (
              <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
            ))}
        </SelectContent>
      </Select>

      {value?.kind === 'literal' && (
        <Input
          id={`${idPrefix}-literal`}
          value={String(value.value)}
          onChange={(e) => {
            const raw = e.target.value;
            const n = parseFloat(raw);
            onChange({ kind: 'literal', value: Number.isFinite(n) ? n : raw });
          }}
          placeholder="숫자 또는 텍스트"
        />
      )}

      {value?.kind === 'cell' && (
        <CellPickerSub
          value={value}
          onChange={onChange}
          questions={questions}
          idPrefix={idPrefix}
        />
      )}

      {value?.kind === 'question' && (
        <QuestionPickerSub
          value={value}
          onChange={onChange}
          questions={questions}
          idPrefix={idPrefix}
        />
      )}

      {value?.kind === 'attr' && (
        <AttrPickerSub
          value={value}
          onChange={onChange}
          attrColumns={contactColumns.map((c) => c.key)}
          idPrefix={idPrefix}
        />
      )}

      {value?.kind === 'lookup' && (
        <LookupSub
          value={value}
          onChange={onChange}
          lookups={lookups}
          attrColumns={contactColumns.map((c) => c.key)}
          idPrefix={idPrefix}
        />
      )}

      {value?.kind === 'binop' && (
        <BinopSub
          value={value}
          onChange={onChange}
          currentDepth={currentDepth + 1}
          idPrefix={idPrefix}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: sub-editor 들 (CellPickerSub, QuestionPickerSub, AttrPickerSub, LookupSub, BinopSub) 작성**

각각 같은 파일 안에 정의. 핵심:

**CellPickerSub**: 질문 셀렉트 → 선택된 질문의 input 셀 목록 셀렉트 (기존 `LeftOperandEditor` 의 `collectInputCells` 로직 차용)

**QuestionPickerSub**: 일반 질문 (radio/select/text/textarea) 셀렉트만

**AttrPickerSub**: `contactColumns` 의 key 들 중에서 셀렉트

**LookupSub**: `lookups` 중 선택 → 그 LUT 의 columns 중 valueColumn 셀렉트 + keyMapping (lutKey/attrsKey 페어). 기존 `LookupComparandEditor` 의 일부를 추출하거나 inline 복제

**BinopSub**:
```tsx
function BinopSub({ value, onChange, currentDepth, idPrefix }) {
  return (
    <div className="space-y-2 pl-3 border-l-2 border-blue-200">
      <ExpressionOperandPicker
        value={value.left}
        onChange={(left) => onChange({ ...value, left })}
        currentDepth={currentDepth}
        idPrefix={`${idPrefix}-l`}
      />
      <Select value={value.op} onValueChange={(op) =>
        onChange({ ...value, op: op as '+'|'-'|'*'|'/' })
      }>
        <SelectTrigger className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="+">+</SelectItem>
          <SelectItem value="-">−</SelectItem>
          <SelectItem value="*">×</SelectItem>
          <SelectItem value="/">÷</SelectItem>
        </SelectContent>
      </Select>
      <ExpressionOperandPicker
        value={value.right}
        onChange={(right) => onChange({ ...value, right })}
        currentDepth={currentDepth}
        idPrefix={`${idPrefix}-r`}
      />
    </div>
  );
}
```

각 sub-editor 의 구체 JSX 는 implementer 가 다음 가이드라인 따라 작성:
- 모든 셀렉트는 shadcn `Select` 사용
- 라벨은 `Label` 컴포넌트
- 빈 데이터 (질문/LUT/attrs 없음) 케이스는 안내 텍스트로
- 키 매핑은 LUT 의 columns 와 attrColumns 의 페어를 자유 선택 (lutKey 와 attrsKey 둘 다 dropdown)

- [ ] **Step 3: tsc 통과 확인**

Run: `pnpm exec tsc --noEmit`

- [ ] **Step 4: 커밋**

```bash
git add src/components/survey-builder/expression-operand-picker.tsx
git commit -m "feat: ExpressionOperandPicker 컴포넌트 + 6 kinds sub-editor"
```

---

## Task 4: ExpressionConditionEditor 컴포넌트

**Files:**
- Create: `src/components/survey-builder/expression-condition-editor.tsx`

clause 목록 + joinOp 토글 + Add 버튼. depth 가드.

- [ ] **Step 1: 컴포넌트 작성**

```tsx
'use client';

import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type {
  ExpressionClause,
  ExpressionComparison,
  ExpressionConditionConfig,
  ExpressionOperand,
} from '@/types/survey';

import { ExpressionOperandPicker } from './expression-operand-picker';

export const MAX_GROUP_DEPTH = 1;

interface ExpressionConditionEditorProps {
  config: ExpressionConditionConfig;
  onChange: (next: ExpressionConditionConfig) => void;
  currentGroupDepth?: number; // root = 0
  idPrefix?: string;
}

const COMPARISON_OPS: ExpressionComparison['op'][] = ['==', '!=', '>', '<', '>=', '<='];
const COMPARISON_OP_LABELS: Record<ExpressionComparison['op'], string> = {
  '==': '같음 (=)',
  '!=': '다름 (≠)',
  '>':  '초과 (>)',
  '<':  '미만 (<)',
  '>=': '이상 (≥)',
  '<=': '이하 (≤)',
};

function emptyOperand(): ExpressionOperand { return { kind: 'literal', value: 0 }; }
function emptyComparison(): ExpressionComparison {
  return { left: emptyOperand(), op: '==', right: emptyOperand() };
}

export function ExpressionConditionEditor({
  config, onChange, currentGroupDepth = 0, idPrefix = 'expr',
}: ExpressionConditionEditorProps) {
  const canAddGroup = currentGroupDepth < MAX_GROUP_DEPTH;

  const updateClause = (idx: number, next: ExpressionClause) => {
    const clauses = [...config.clauses];
    clauses[idx] = next;
    onChange({ ...config, clauses });
  };

  const deleteClause = (idx: number) => {
    const clauses = config.clauses.filter((_, i) => i !== idx);
    const joinOps = config.joinOps.filter((_, i) => i !== Math.max(0, idx - 1));
    onChange({ ...config, clauses, joinOps });
  };

  const updateJoinOp = (idx: number, op: 'AND' | 'OR') => {
    const joinOps = [...config.joinOps];
    joinOps[idx] = op;
    onChange({ ...config, joinOps });
  };

  const addComparison = () => {
    const clauses = [...config.clauses, { kind: 'comparison' as const, comparison: emptyComparison() }];
    const joinOps = config.clauses.length === 0
      ? config.joinOps
      : [...config.joinOps, 'AND' as const];
    onChange({ ...config, clauses, joinOps });
  };

  const addGroup = () => {
    if (!canAddGroup) return;
    const clauses = [...config.clauses, {
      kind: 'group' as const,
      group: { clauses: [], joinOps: [] },
    }];
    const joinOps = config.clauses.length === 0
      ? config.joinOps
      : [...config.joinOps, 'AND' as const];
    onChange({ ...config, clauses, joinOps });
  };

  return (
    <div className="space-y-3">
      {config.clauses.map((clause, idx) => (
        <div key={idx} className="space-y-2">
          {idx > 0 && (
            <Select
              value={config.joinOps[idx - 1] ?? 'AND'}
              onValueChange={(v) => updateJoinOp(idx - 1, v as 'AND' | 'OR')}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AND">AND</SelectItem>
                <SelectItem value="OR">OR</SelectItem>
              </SelectContent>
            </Select>
          )}

          {clause.kind === 'comparison' ? (
            <ComparisonClauseEditor
              comparison={clause.comparison}
              onChange={(c) => updateClause(idx, { kind: 'comparison', comparison: c })}
              onDelete={() => deleteClause(idx)}
              idPrefix={`${idPrefix}-${idx}`}
            />
          ) : (
            <GroupClauseEditor
              config={clause.group}
              onChange={(g) => updateClause(idx, { kind: 'group', group: g })}
              onDelete={() => deleteClause(idx)}
              currentGroupDepth={currentGroupDepth + 1}
              idPrefix={`${idPrefix}-g${idx}`}
            />
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addComparison}>
          <Plus className="mr-1 h-3 w-3" /> 조건 추가
        </Button>
        {canAddGroup && (
          <Button type="button" variant="outline" size="sm" onClick={addGroup}>
            <Plus className="mr-1 h-3 w-3" /> 그룹 추가
          </Button>
        )}
      </div>
    </div>
  );
}

function ComparisonClauseEditor({
  comparison, onChange, onDelete, idPrefix,
}: {
  comparison: ExpressionComparison;
  onChange: (next: ExpressionComparison) => void;
  onDelete: () => void;
  idPrefix: string;
}) {
  return (
    <div className="space-y-2 rounded-md border border-slate-300 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">비교 조건</Label>
        <Button type="button" variant="ghost" size="sm" onClick={onDelete} aria-label="조건 삭제">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div>
        <Label className="text-xs text-slate-600">좌변</Label>
        <ExpressionOperandPicker
          value={comparison.left}
          onChange={(left) => onChange({ ...comparison, left })}
          currentDepth={0}
          idPrefix={`${idPrefix}-L`}
        />
      </div>
      <div>
        <Label className="text-xs text-slate-600">비교</Label>
        <Select value={comparison.op} onValueChange={(v) =>
          onChange({ ...comparison, op: v as ExpressionComparison['op'] })
        }>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMPARISON_OPS.map((op) => (
              <SelectItem key={op} value={op}>{COMPARISON_OP_LABELS[op]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs text-slate-600">우변</Label>
        <ExpressionOperandPicker
          value={comparison.right}
          onChange={(right) => onChange({ ...comparison, right })}
          currentDepth={0}
          idPrefix={`${idPrefix}-R`}
        />
      </div>
    </div>
  );
}

function GroupClauseEditor({
  config, onChange, onDelete, currentGroupDepth, idPrefix,
}: {
  config: ExpressionConditionConfig;
  onChange: (next: ExpressionConditionConfig) => void;
  onDelete: () => void;
  currentGroupDepth: number;
  idPrefix: string;
}) {
  return (
    <div className="space-y-2 rounded-md border-2 border-slate-300 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">( 그룹 )</Label>
        <Button type="button" variant="ghost" size="sm" onClick={onDelete} aria-label="그룹 삭제">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ExpressionConditionEditor
        config={config}
        onChange={onChange}
        currentGroupDepth={currentGroupDepth}
        idPrefix={idPrefix}
      />
    </div>
  );
}
```

- [ ] **Step 2: tsc 통과**

Run: `pnpm exec tsc --noEmit`

- [ ] **Step 3: 커밋**

```bash
git add src/components/survey-builder/expression-condition-editor.tsx
git commit -m "feat: ExpressionConditionEditor 컴포넌트 + clause/그룹 편집"
```

---

## Task 5: question-condition-editor 통합

**Files:**
- Modify: `src/components/survey-builder/question-condition-editor.tsx`

- [ ] **Step 1: 드롭다운 expression 옵션 enable**

cleanup 작업에서 추가한 `<option value="expression" disabled>...</option>` 의 `disabled` 제거 + 그룹 라벨 "준비 중" 도 제거:

기존:
```tsx
<optgroup label="준비 중">
  <option value="expression" disabled>장기 계산식</option>
</optgroup>
```

교체:
```tsx
<option value="expression">장기 계산식</option>
```

- [ ] **Step 2: import 추가**

```ts
import { ExpressionConditionEditor } from './expression-condition-editor';
```

- [ ] **Step 3: expression 본문 안내 박스 → 실제 에디터로 교체**

cleanup 작업에서 placeholder 로 추가한:
```tsx
{condition.conditionType === 'expression' && (
  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
    본 조건 타입은 다음 업데이트에서 제공됩니다.
  </div>
)}
```

교체:
```tsx
{condition.conditionType === 'expression' && (
  <ExpressionConditionEditor
    config={condition.expressionConfig ?? { clauses: [], joinOps: [] }}
    onChange={(next) => updateCondition(condition.id, { expressionConfig: next })}
    idPrefix={`expr-${condition.id}`}
  />
)}
```

- [ ] **Step 4: conditionType 변경 시 expressionConfig 초기화**

`<select>` 의 `onChange` 안에서 `conditionType === 'expression'` 으로 바뀔 때 `expressionConfig: { clauses: [], joinOps: [] }` 기본값 세팅:

```tsx
onChange={(e) => {
  const newType = e.target.value as 'value-match'|'table-cell-check'|'expression'|'custom';
  updateCondition(condition.id, {
    conditionType: newType,
    ...(newType === 'expression' && !condition.expressionConfig
      ? { expressionConfig: { clauses: [], joinOps: [] } }
      : {}),
  });
}}
```

- [ ] **Step 5: tsc + 회귀**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm exec vitest run`

- [ ] **Step 6: 수동 검증**

`pnpm dev` 로:
- 표시 조건 추가 → 질문 선택 → 조건 타입 "장기 계산식" 선택 → editor 마운트
- "+ 조건 추가" 클릭 → comparison clause 생김
- 좌변 / 우변 OperandPicker 동작 (literal/cell/lookup 각 케이스)
- "+ 그룹 추가" → 그룹 안에서 "+ 그룹 추가" 비활성 확인

- [ ] **Step 7: 커밋**

```bash
git add src/components/survey-builder/question-condition-editor.tsx
git commit -m "feat: 표시 조건 에디터에 expression 모드 통합"
```

---

## Phase 4: 마이그레이션 헬퍼

## Task 6: 마이그레이션 함수 + 버튼

**Files:**
- Create: `src/utils/expression-migration.ts`
- Create: `tests/unit/utils/expression-migration.test.ts`
- Modify: `src/components/survey-builder/numeric-comparison-editor.tsx` (BinopReadonlyLabel 영역에 마이그레이션 버튼 추가)

- [ ] **Step 1: 실패 테스트**

`tests/unit/utils/expression-migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { NumericComparison } from '@/types/survey';
import { migrateNumericComparisonToExpression } from '@/utils/expression-migration';

const OUTER_CELL = { questionId: 'q1', cellId: 'cell-a' };

describe('migrateNumericComparisonToExpression', () => {
  it('legacy comparand (literal) → expression literal', () => {
    const nc: NumericComparison = {
      operator: '<=',
      comparand: { kind: 'literal', value: 100 },
    };
    const result = migrateNumericComparisonToExpression(nc, OUTER_CELL);
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0]).toEqual({
      kind: 'comparison',
      comparison: {
        left: { kind: 'cell', ...OUTER_CELL },
        op: '<=',
        right: { kind: 'literal', value: 100 },
      },
    });
  });

  it('legacy right.literal (new style) → expression literal', () => {
    const nc: NumericComparison = {
      operator: '==',
      right: { kind: 'literal', value: 5 },
    };
    const result = migrateNumericComparisonToExpression(nc, OUTER_CELL);
    expect(result.clauses[0]).toMatchObject({
      kind: 'comparison',
      comparison: { right: { kind: 'literal', value: 5 } },
    });
  });

  it('legacy right.lookup → expression lookup', () => {
    const nc: NumericComparison = {
      operator: '<=',
      right: {
        kind: 'lookup',
        surveyLookupId: 'lut1',
        keyMapping: [{ lutKey: '대륙', attrsKey: '대륙' }],
        valueColumn: '평균',
      },
    };
    const result = migrateNumericComparisonToExpression(nc, OUTER_CELL);
    expect(result.clauses[0]).toMatchObject({
      kind: 'comparison',
      comparison: { right: { kind: 'lookup', surveyLookupId: 'lut1' } },
    });
  });

  it('legacy left.cell → expression cell', () => {
    const nc: NumericComparison = {
      operator: '>',
      left: { kind: 'cell', questionId: 'q2', cellId: 'cell-x' },
      right: { kind: 'literal', value: 0 },
    };
    const result = migrateNumericComparisonToExpression(nc, OUTER_CELL);
    expect(result.clauses[0].kind).toBe('comparison');
    if (result.clauses[0].kind === 'comparison') {
      expect(result.clauses[0].comparison.left).toEqual({
        kind: 'cell', questionId: 'q2', cellId: 'cell-x',
      });
    }
  });

  it('legacy left.binop → expression binop', () => {
    const nc: NumericComparison = {
      operator: '<=',
      left: {
        kind: 'binop',
        op: '/',
        left:  { kind: 'cell', questionId: 'q1', cellId: 'a' },
        right: { kind: 'cell', questionId: 'q1', cellId: 'b' },
      },
      right: { kind: 'literal', value: 100 },
    };
    const result = migrateNumericComparisonToExpression(nc, OUTER_CELL);
    if (result.clauses[0].kind === 'comparison') {
      expect(result.clauses[0].comparison.left).toEqual({
        kind: 'binop',
        op: '/',
        left:  { kind: 'cell', questionId: 'q1', cellId: 'a' },
        right: { kind: 'cell', questionId: 'q1', cellId: 'b' },
      });
    }
  });

  it('left 없음 + comparand 만 → outer cell + literal', () => {
    const nc: NumericComparison = {
      operator: '>',
      comparand: { kind: 'literal', value: 0 },
    };
    const result = migrateNumericComparisonToExpression(nc, OUTER_CELL);
    if (result.clauses[0].kind === 'comparison') {
      expect(result.clauses[0].comparison.left).toEqual({
        kind: 'cell', ...OUTER_CELL,
      });
      expect(result.clauses[0].comparison.right).toEqual({
        kind: 'literal', value: 0,
      });
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec vitest run tests/unit/utils/expression-migration.test.ts`
Expected: 모두 FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/utils/expression-migration.ts`:

```ts
import type {
  ExpressionConditionConfig,
  ExpressionOperand,
  LeftOperand,
  NumericComparison,
  RightOperand,
} from '@/types/survey';

function convertLegacyLeft(
  left: LeftOperand,
  outerCellRef: { questionId: string; cellId: string },
): ExpressionOperand {
  if (left.kind === 'cell') {
    return { kind: 'cell', questionId: left.questionId, cellId: left.cellId };
  }
  // binop
  return {
    kind: 'binop',
    op: left.op,
    left:  convertLegacyLeftCell(left.left),
    right: left.right.kind === 'literal'
      ? { kind: 'literal', value: left.right.value }
      : convertLegacyLeftCell(left.right),
  };
}

function convertLegacyLeftCell(c: { kind: 'cell'; questionId: string; cellId: string }): ExpressionOperand {
  return { kind: 'cell', questionId: c.questionId, cellId: c.cellId };
}

function convertLegacyRight(right: RightOperand): ExpressionOperand {
  if (right.kind === 'literal') return { kind: 'literal', value: right.value };
  return {
    kind: 'lookup',
    surveyLookupId: right.surveyLookupId,
    keyMapping: right.keyMapping,
    valueColumn: right.valueColumn,
  };
}

export function migrateNumericComparisonToExpression(
  nc: NumericComparison,
  outerCellRef: { questionId: string; cellId: string },
): ExpressionConditionConfig {
  const left: ExpressionOperand = nc.left
    ? convertLegacyLeft(nc.left, outerCellRef)
    : { kind: 'cell', questionId: outerCellRef.questionId, cellId: outerCellRef.cellId };

  const right: ExpressionOperand = nc.right
    ? convertLegacyRight(nc.right)
    : nc.comparand
      ? { kind: 'literal', value: nc.comparand.value }
      : { kind: 'literal', value: 0 };

  return {
    clauses: [{
      kind: 'comparison',
      comparison: { left, op: nc.operator, right },
    }],
    joinOps: [],
  };
}
```

- [ ] **Step 4: 테스트 통과**

Run: `pnpm exec vitest run tests/unit/utils/expression-migration.test.ts`
Expected: 6개 PASS

- [ ] **Step 5: 마이그레이션 버튼 UI**

`numeric-comparison-editor.tsx` 의 `BinopReadonlyLabel` 컴포넌트 (cleanup 에서 추가됨) 안에 "[expression 으로 변환]" 버튼 추가. 클릭 시:
1. 사용자에게 confirm 다이얼로그
2. 부모로 onMigrate 콜백 → 부모(question-condition-editor) 가 새 expression 조건 생성 + 원본 조건의 numericComparison 삭제

이 통합은 question-condition-editor.tsx 도 함께 수정 — `BinopReadonlyLabel` 에 `onMigrate` prop 추가, NumericComparisonEditor 의 onChange 인터페이스 확장 또는 새 onMigrate prop 추가.

정확한 구현은 implementer 가 다음 가이드 따라:
- 가장 간단: BinopReadonlyLabel 자체에 마이그레이션 콜백 prop 받기
- NumericComparisonEditor 에 `onMigrate?: () => void` prop
- question-condition-editor 에서 prop 으로 전달 — outer-cell ref 와 함께 새 expression 조건 생성하는 로직

- [ ] **Step 6: tsc + vitest**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm exec vitest run`

- [ ] **Step 7: 커밋**

```bash
git add src/utils/expression-migration.ts tests/unit/utils/expression-migration.test.ts \
        src/components/survey-builder/numeric-comparison-editor.tsx \
        src/components/survey-builder/question-condition-editor.tsx
git commit -m "feat: legacy numericComparison → expression 마이그레이션 헬퍼 + 버튼"
```

---

## Phase 5: 회귀 검증

## Task 7: 전체 회귀 + 빌드

**Files:** 없음 (검증만)

- [ ] **Step 1: tsc**

Run: `pnpm exec tsc --noEmit`
Expected: 통과

- [ ] **Step 2: vitest**

Run: `pnpm exec vitest run`
Expected: 신규 expression-eval (10), expression-migration (6), cell-type-detector (16) 포함 모두 PASS

- [ ] **Step 3: build**

Run: `pnpm build`
Expected: 성공

- [ ] **Step 4: 수동 통합 시나리오**

`pnpm dev`:
1. 새 표시 조건 → conditionType "장기 계산식" 선택 → editor 마운트
2. clause 1개 추가 → 좌변 cell-binop (출장비 / 출장인원), 비교 ≤, 우변 lookup (항공요금 LUT, key 대륙 = attrs.대륙) 구성
3. 저장
4. 응답 페이지에서 실제로 출장비/인원 입력 후 조건 평가 통과/불통과 확인
5. 그룹 추가 + 그룹 안 조건 + AND/OR 토글 확인
6. depth 가드: binop 안의 binop 안에서 binop 옵션 비활성 확인
7. 기존 binop 데이터를 가진 표시 조건 → BinopReadonlyLabel 에서 "[expression 으로 변환]" 버튼 → 변환 후 새 expression 조건 생성 확인

---

## Self-Review Notes

| Spec § | 매핑 Task |
|---|---|
| 3.1 ExpressionOperand | Task 1 |
| 3.2 ExpressionComparison | Task 1 |
| 3.3 ExpressionClause | Task 1 |
| 3.4 ExpressionConditionConfig | Task 1 |
| 3.5 QuestionCondition.expressionConfig | Task 1 |
| 4.1 evaluateOperand | Task 2 |
| 4.2 evaluateComparison | Task 2 |
| 4.3 evaluateExpressionConfig | Task 2 |
| 4.4 shouldDisplayQuestion 통합 | Task 2 |
| 5.1 진입 (드롭다운 enable) | Task 5 |
| 5.2 ExpressionConditionEditor | Task 4 |
| 5.3 OperandPicker | Task 3 |
| 5.4 Depth 제한 | Task 3 + Task 4 |
| 5.5 ClauseList | Task 4 |
| 5.6 Validation (저장 시) | Task 4 (간단), Task 5 통합 시 확장 |
| 6 마이그레이션 | Task 6 |
| 7 cleanup 통합 | Phase 0 (브랜치 셋업) |
| 9 테스트 | Task 2 (evaluator), Task 6 (migration) |
