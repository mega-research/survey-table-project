# expression 조건 모드 — Design Spec

작성일: 2026-05-26
범위: `conditionType: 'expression'` 의 데이터 모델 / 평가기 / 빌더 UI / 기존 데이터 마이그레이션

전제: `feat/lookup-comparison` 위에 본 작업 베이스. LUT 시스템 + `inputType` + `NumericComparison.{left, right}` 모델이 이미 존재.

## 1. 배경

`table-cell-check` 모드는 "이 셀의 응답값" 을 좌변 anchor 로 강제한다. 사용자의 실제 도메인 케이스:

> 문3-6-2: `(셀: 출장비) ÷ (셀: 출장인원) ≤ lookup(평균 항공요금, 대륙 = attrs.대륙)`

는 좌변에 산술이 들어가고 우변에 LUT 가 들어간다. 현재 `LeftOperand.binop` 으로 1-deep 산술은 가능하지만 outer 셀 anchor 의 의미가 흐려진다 ([[project_display_condition_arithmetic_future]] L1~L5 스펙트럼 참조). 또한 left/right 양쪽이 임의 operand 인 케이스 (예: `cell ≤ attr`) 가 자연스럽게 표현되지 않는다.

신규 `'expression'` conditionType 은 outer 셀 anchor 없이 임의 산술/비교식을 표현한다. table-cell-check 는 단순 presence/match 용으로 유지, expression 은 깊은 수식 전용.

## 2. 비목표 (Out of scope)

- Excel-lite 수식 입력 (`=A1/B1`) — 파서/검증 UX 비용 큼
- 자유 변수 / 명명된 중간식
- 임의 다중 () 그룹 — Notion 스타일 1-level 그룹만 허용
- 분기(`branchRule`) 에서 expression 사용 — 표시 조건만 우선 지원

## 3. 데이터 모델

### 3.1 Operand — 재귀 union

5종 source + 1종 재귀 binop. 데이터 모델은 임의 깊이 표현 가능 (n-deep). UI 만 2-deep 제한.

```ts
// src/types/survey.ts 신규 export
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
```

`literal` 은 number 와 string 모두 허용. 비교 연산자에 따라 양쪽이 모두 number 거나 모두 string 이어야 함 (평가기에서 type check).

`question` 은 일반 질문(radio/select/text/textarea/number-input) 의 응답값 자체. 셀이 아닌 질문 단위.

`attr` 는 컨택 메타데이터 (`survey_responses.contactTargetId` 통해 `contact_targets.attrs` 룩업). `kind: 'lookup'` 의 `attrsKey` 와 같은 출처.

### 3.2 Comparison — 단일 비교 절

```ts
export interface ExpressionComparison {
  left: ExpressionOperand;
  op: '==' | '!=' | '>' | '<' | '>=' | '<=';
  right: ExpressionOperand;
}
```

### 3.3 Clause — 비교 또는 그룹

```ts
export type ExpressionClause =
  | { kind: 'comparison'; comparison: ExpressionComparison }
  | { kind: 'group'; group: ExpressionConditionConfig };
```

`group` 의 `group` 필드는 재귀적으로 `ExpressionConditionConfig` — 1-level 만 허용은 **UI 제약** (데이터 모델은 n-level 표현 가능).

### 3.4 ExpressionConditionConfig — clause 배열 + joinOps

```ts
export interface ExpressionConditionConfig {
  clauses: ExpressionClause[];
  // 각 clause 사이의 조인 — joinOps.length === max(0, clauses.length - 1)
  joinOps: Array<'AND' | 'OR'>;
}
```

빈 `clauses` 는 evaluator 가 `true` 반환 (보수적 SHOW).

### 3.5 QuestionCondition 확장

```ts
// src/types/survey.ts:147 부근
export interface QuestionCondition {
  // ... 기존 필드 유지
  conditionType: 'value-match' | 'table-cell-check' | 'expression' | 'custom';
  // ... 기존 필드 유지
  expressionConfig?: ExpressionConditionConfig; // 신규
}
```

`conditionType === 'expression'` 일 때 `expressionConfig` 가 source of truth. 다른 conditionType 의 필드 (`tableConditions`, `requiredValues` 등) 는 무시.

## 4. 평가기

`src/utils/branch-logic.ts` 에 확장.

### 4.1 evaluateOperand

```ts
function evaluateOperand(
  operand: ExpressionOperand,
  ctx: BranchEvalCtx,
): number | string | undefined {
  switch (operand.kind) {
    case 'literal':
      return operand.value;
    case 'cell':
      return getCellValue(ctx.responses, operand.questionId, operand.cellId);
    case 'question':
      return getQuestionAnswer(ctx.responses, operand.questionId);
    case 'lookup':
      return evaluateLookup(operand, ctx.attrs); // 기존 LUT 헬퍼 재사용
    case 'attr':
      return ctx.attrs?.[operand.attrsKey];
    case 'binop': {
      const L = toNumber(evaluateOperand(operand.left, ctx));
      const R = toNumber(evaluateOperand(operand.right, ctx));
      if (L === undefined || R === undefined) return undefined;
      switch (operand.op) {
        case '+': return L + R;
        case '-': return L - R;
        case '*': return L * R;
        case '/': return R === 0 ? undefined : L / R; // 0 divide fail-safe
      }
    }
  }
}
```

`undefined` 전파 정책:
- operand 가 데이터 부재 (응답 X, LUT miss, attr 누락) → `undefined`
- binop 한쪽이 `undefined` → 결과 `undefined`
- 0 division → `undefined`

### 4.2 evaluateComparison

```ts
function evaluateComparison(
  comparison: ExpressionComparison,
  ctx: BranchEvalCtx,
): boolean {
  const L = evaluateOperand(comparison.left, ctx);
  const R = evaluateOperand(comparison.right, ctx);

  if (L === undefined || R === undefined) {
    // fail-safe SHOW: 데이터 부재 시 조건 만족으로 처리 (기존 LUT 정책과 일치)
    return true;
  }

  // 비교 가능성 — number op number 또는 string == string / != string
  if (comparison.op === '==' || comparison.op === '!=') {
    const eq = String(L) === String(R);
    return comparison.op === '==' ? eq : !eq;
  }

  const ln = toNumber(L);
  const rn = toNumber(R);
  if (ln === undefined || rn === undefined) return true; // fail-safe

  switch (comparison.op) {
    case '>': return ln > rn;
    case '<': return ln < rn;
    case '>=': return ln >= rn;
    case '<=': return ln <= rn;
  }
}
```

### 4.3 evaluateExpressionConfig

```ts
function evaluateExpressionConfig(
  config: ExpressionConditionConfig,
  ctx: BranchEvalCtx,
): boolean {
  if (config.clauses.length === 0) return true;

  // 좌→우 평가, joinOp 적용. 우선순위 없음 (Notion 스타일).
  let acc = evaluateClause(config.clauses[0], ctx);
  for (let i = 1; i < config.clauses.length; i++) {
    const next = evaluateClause(config.clauses[i], ctx);
    const op = config.joinOps[i - 1] ?? 'AND';
    acc = op === 'AND' ? (acc && next) : (acc || next);
  }
  return acc;
}

function evaluateClause(clause: ExpressionClause, ctx: BranchEvalCtx): boolean {
  if (clause.kind === 'comparison') return evaluateComparison(clause.comparison, ctx);
  return evaluateExpressionConfig(clause.group, ctx);
}
```

좌→우 평가 + 그룹 우선이라 사용자가 우선순위 필요하면 그룹화. 산술 우선순위(`*` `/` 먼저) 는 binop 의 자연 재귀로 처리됨.

### 4.4 통합 — shouldDisplayQuestion

`shouldDisplayQuestion` 분기에 `case 'expression'` 추가:

```ts
case 'expression':
  if (condition.expressionConfig) {
    return evaluateExpressionConfig(condition.expressionConfig, ctx);
  }
  return true; // config 없으면 SHOW
```

## 5. 빌더 UI

### 5.1 진입

기존 conditionType 드롭다운에서 "장기 계산식" 옵션 enable (`disabled` 제거). 선택 시 `expressionConfig` 가 `{ clauses: [], joinOps: [] }` 로 초기화 + ExpressionConditionEditor 렌더.

### 5.2 ExpressionConditionEditor 컴포넌트

신규 파일 `src/components/survey-builder/expression-condition-editor.tsx`.

레이아웃:

```
계산식 조건
─────────────────────
[Clause 1]
  ┌─────────────────────────────────────────────┐
  │ 좌변  [▾ Operand picker]                   │
  │ 비교  [▾ ==] [▾ != >  <  >= <=]            │
  │ 우변  [▾ Operand picker]                   │
  │                                  [× 삭제]   │
  └─────────────────────────────────────────────┘

[AND ▾]  [+ 조건 추가] [+ 그룹 추가]

[Clause 2 — group]
  ┌─────────────────────────────────────────────┐
  │ ( 그룹                                       │
  │   [Clause 2.1] ...                          │
  │   [AND] [+ 조건 추가]                       │
  │   [Clause 2.2] ...                          │
  │ )                                            │
  └─────────────────────────────────────────────┘
```

### 5.3 OperandPicker 컴포넌트

신규 파일 `src/components/survey-builder/expression-operand-picker.tsx`.

```
[▾ Operand]
  - 직접 입력 (literal)
  - 질문 응답 (question)
  - 테이블 셀 (cell)
  - 컨택 메타데이터 (attr)
  - 외부 데이터 (lookup)
  - 계산 (binop)     ← currentDepth < MAX_DEPTH 일 때만
```

선택 후 각 kind 에 맞는 sub-editor 렌더:
- `literal` — 텍스트 입력
- `question` — 질문 셀렉트
- `cell` — 질문 + 셀 셀렉트
- `attr` — 컨택 attrs key 셀렉트 (현재 설문의 contactColumns 에서 추출)
- `lookup` — 기존 `LookupComparandEditor` 형태 재사용 (LUT + keyMapping + valueColumn 선택)
- `binop` — 연산자 + 재귀 OperandPicker × 2

### 5.4 Depth 제한 — 정확한 정책

**operand depth**: root operand 가 depth 0. binop 안의 left/right 는 depth 1. 그 안의 binop 의 left/right 는 depth 2. UI 는 **`MAX_OPERAND_DEPTH = 2`** — depth >= 2 인 위치에서 binop 옵션 비활성, leaf operand 만 허용. 결과적으로 `(A+B)/C` 같은 식은 OK, `((A+B)/C)+D` 는 UI 로 만들 수 없음 (외부 도구로 주입은 가능하고 평가도 됨).

**group depth**: clause 의 `group` 안은 다시 `clauses[]` 가지지만 UI 에서 **`MAX_GROUP_DEPTH = 1`** — 그룹 안의 clause 는 `comparison` 만 가능, 또 그룹 X. 외부 주입 데이터로 더 깊으면 read-only 표시.

```ts
const MAX_OPERAND_DEPTH = 2;
const MAX_GROUP_DEPTH = 1;

// OperandPicker prop
interface OperandPickerProps {
  value: ExpressionOperand | undefined;
  onChange: (next: ExpressionOperand) => void;
  currentDepth: number; // root operand 위치 = 0
}

// 'binop' 옵션 노출:
const canNestBinop = currentDepth < MAX_OPERAND_DEPTH;

// ClauseList prop
interface ClauseListProps {
  config: ExpressionConditionConfig;
  onChange: (next: ExpressionConditionConfig) => void;
  currentGroupDepth: number; // root = 0
}

// '+ 그룹 추가' 버튼 노출:
const canAddGroup = currentGroupDepth < MAX_GROUP_DEPTH;
```

depth 자르기는 UI 만. 데이터 모델/평가기는 임의 깊이 지원. n-deep 확장 시 상수 변경만.

### 5.5 ClauseList — Notion 스타일

```tsx
{clauses.map((clause, idx) => (
  <>
    {idx > 0 && (
      <JoinOpToggle
        value={joinOps[idx - 1]}
        onChange={(op) => updateJoinOp(idx - 1, op)}
      />
    )}
    <ClauseCard clause={clause} onChange={...} onDelete={...} />
  </>
))}

<div>
  <Button onClick={addComparisonClause}>+ 조건 추가</Button>
  <Button onClick={addGroupClause}>+ 그룹 추가</Button>
</div>
```

### 5.6 Validation — 저장 시점

- 각 comparison 의 left/right 가 모두 정의되었는지 (`undefined` operand 금지)
- binop 의 left/right 모두 정의
- lookup 의 surveyLookupId + valueColumn 필수
- 그룹의 clauses 가 비어있지 않은지

검증 실패 시 저장 버튼 비활성 + 인라인 에러 메시지.

## 6. 기존 데이터 마이그레이션

`feat/lookup-comparison` 의 `NumericComparison.{left, right}` 데이터는 다음 매핑으로 expression 으로 변환 가능:

```ts
// 변환 헬퍼 — src/utils/expression-migration.ts
function migrateNumericComparisonToExpression(
  nc: NumericComparison,
  outerCellRef: { questionId: string; cellId: string },
): ExpressionConditionConfig {
  const left: ExpressionOperand =
    nc.left
      ? convertLegacyLeft(nc.left, outerCellRef)
      : { kind: 'cell', ...outerCellRef };
  const right: ExpressionOperand =
    nc.right?.kind === 'lookup'
      ? { kind: 'lookup', ...nc.right }
      : nc.right?.kind === 'literal'
        ? { kind: 'literal', value: nc.right.value }
        : { kind: 'literal', value: nc.comparand?.value ?? 0 };

  return {
    clauses: [{
      kind: 'comparison',
      comparison: { left, op: nc.operator, right },
    }],
    joinOps: [],
  };
}
```

마이그레이션은 **수동 트리거** 만. 빌더에서 기존 `table-cell-check` + binop 데이터를 가진 조건의 read-only 라벨 옆에 `[expression 으로 변환]` 버튼 노출. 클릭 → 새 expression 조건 생성 + 원본 조건 삭제 + 확인 다이얼로그.

자동 마이그레이션 X (사용자가 의도 확인 필요).

## 7. 빌더 통합 (cleanup 작업과의 관계)

본 spec 은 `feat/lookup-comparison` 베이스. 기존 작업 `feat/display-condition-cleanup` (펼치기 패턴 + ValueComparisonExpander + detectCellTypeKind + binop read-only) 도 동시 적용해야 깔끔. 두 작업의 통합 순서:

1. `feat/lookup-comparison` 베이스에서 새 브랜치 `feat/expression-condition`
2. cleanup 작업 commits cherry-pick (충돌 해소 — 자세한 건 plan 참조)
3. 그 위에 expression 모드 구현

cleanup 의 conditionType union 'expression' 추가 + 드롭다운 placeholder + NumericComparisonEditor 간소화 + table-cell-check 펼치기 패턴 모두 expression 작업의 prerequisite 이므로 자연스럽게 cherry-pick.

## 8. 컴포넌트 변경 요약

| 파일 | 변경 내용 |
|---|---|
| `src/types/survey.ts` | `ExpressionOperand`, `ExpressionComparison`, `ExpressionClause`, `ExpressionConditionConfig` 추가; `QuestionCondition.expressionConfig?` 필드 |
| `src/db/schema/schema-types.ts` | 같은 필드 미러 |
| `src/utils/branch-logic.ts` | `evaluateOperand` / `evaluateComparison` / `evaluateExpressionConfig` 추가; `shouldDisplayQuestion` 의 `case 'expression'` |
| `src/components/survey-builder/expression-condition-editor.tsx` | **신규**. clause list + joinOp toggle + add 버튼 |
| `src/components/survey-builder/expression-operand-picker.tsx` | **신규**. 6 kinds 셀렉트 + sub-editor |
| `src/components/survey-builder/question-condition-editor.tsx` | conditionType=expression 시 `<ExpressionConditionEditor>` 마운트; 드롭다운 expression 옵션 enable |
| `src/utils/expression-migration.ts` | **신규**. legacy → expression 변환 헬퍼 |
| `tests/unit/utils/expression-eval.test.ts` | **신규**. evaluator TDD |
| `tests/unit/utils/expression-migration.test.ts` | **신규**. 마이그레이션 TDD |

## 9. 테스트 전략

### 9.1 evaluator 단위 테스트 (필수)

- literal 비교 (`5 > 3`, `'a' == 'a'`)
- cell 응답 추출 + 비교
- question 응답 추출 + 비교
- attr 추출 + 비교
- lookup 매칭 + value 추출 (LUT 시드 데이터로)
- binop 1-deep (`A + B`, `A / 0` → undefined)
- binop 2-deep (`(A+B) / C ≤ D`)
- undefined 전파 (응답 부재, LUT miss)
- 0 division
- AND/OR clause 조합
- 그룹 1-level
- 빈 clauses → true

### 9.2 마이그레이션 단위 테스트

- legacy `comparand` (literal) → expression literal
- legacy `right: lookup` → expression lookup
- legacy `left: binop` → expression binop
- legacy `left: undefined` (outer cell anchor) → expression cell with provided outerCellRef

### 9.3 컴포넌트 테스트 (선택)

ExpressionConditionEditor 의 clause 추가/삭제/그룹화 — vitest + testing-library. depth 가드 동작.

### 9.4 수동 회귀

`pnpm dev` 실행 후:
1. expression conditionType 선택 → editor 마운트
2. clause 추가 → operand picker 4 kinds 각각 동작
3. binop 1-deep 만들기 → 2-deep 시도 시 binop 옵션 비활성
4. AND/OR 토글
5. 그룹 추가 → 그룹 내부의 "+ 그룹 추가" 버튼 비활성 확인 (`MAX_GROUP_DEPTH = 1`)
6. 저장 후 응답 페이지 미리보기로 조건 평가 확인 (사용자 케이스: 출장비/인원 ≤ 항공료 LUT)

## 10. 마이그레이션 / 호환성

- DB 스키마 변경 없음 (`QuestionCondition` 은 JSONB 이미)
- 기존 `value-match` / `table-cell-check` / `custom` 조건 동작 무변경
- 기존 `binop` 데이터를 가진 `table-cell-check` 조건은 read-only 유지 + 수동 마이그레이션 버튼

## 11. Follow-up (별도 spec)

- branchRule 에 expression 사용 (질문 옵션별 분기)
- expression 의 결과를 변수로 명명 + 재사용
- 자유 수식 입력 (Excel-lite) — 검증 UX 비용 큼, 보류
- 응답 수집 후 분석 단계에서 expression 식 변경하여 재평가 (analytics 영역)
