import type {
  ExpressionConditionConfig,
  ExpressionOperand,
  QuestionCondition,
  QuestionConditionGroup,
  TableRow,
} from '@/types/survey';

/**
 * 옵션 value 변경 시 표 셀의 게이팅(enabledWhen) 참조를 리매핑한다.
 * controllerCellId 가 일치하고 kind === 'option' 인 셀의 values 배열에서만
 * oldValue → newValue 치환. 변경이 없으면 원본 배열 참조를 그대로 반환한다
 * (React 리렌더 최소화 관례).
 */
export function remapGatingValues(
  rows: TableRow[],
  controllerCellId: string,
  oldValue: string,
  newValue: string,
): TableRow[] {
  let changed = false;

  const nextRows = rows.map((row) => {
    let rowChanged = false;

    const nextCells = row.cells.map((cell) => {
      const enabledWhen = cell.enabledWhen;
      if (
        !enabledWhen ||
        enabledWhen.kind !== 'option' ||
        enabledWhen.controllerCellId !== controllerCellId ||
        !enabledWhen.values.includes(oldValue)
      ) {
        return cell;
      }

      rowChanged = true;
      return {
        ...cell,
        enabledWhen: {
          ...enabledWhen,
          values: enabledWhen.values.map((v) => (v === oldValue ? newValue : v)),
        },
      };
    });

    if (!rowChanged) return row;
    changed = true;
    return { ...row, cells: nextCells };
  });

  return changed ? nextRows : rows;
}

/**
 * 셀 옵션 value 변경의 스코프 — 같은 표의 다른 셀이 같은 옵션 value(자동 발번
 * option-N)를 쓰는 것이 일상이므로, 셀 편집에서 온 변경은 그 셀을 실제로 참조하는
 * 조건(tableConditions 행·열 좌표, expression 의 cellId 피연산자)만 바꿔야 한다.
 */
export interface CellRemapScope {
  rowId: string;
  columnIndex: number;
  cellId: string;
}

/** 대상 질문(그리고 cellScope 가 있으면 그 셀)을 참조하는 피연산자인지 판정 */
function operandRefersToTarget(
  operand: ExpressionOperand,
  questionId: string,
  cellScope: CellRemapScope | undefined,
): boolean {
  if (operand.kind === 'question') return !cellScope && operand.questionId === questionId;
  if (operand.kind === 'cell') {
    return operand.questionId === questionId && (!cellScope || operand.cellId === cellScope.cellId);
  }
  return false;
}

/**
 * expression 비교에서 대상 질문/셀 피연산자와 비교되는 문자열 literal 을 치환한다.
 * binop(산술) 내부 literal 은 숫자 공간이므로 건드리지 않는다.
 */
function remapExpressionLiterals(
  config: ExpressionConditionConfig,
  questionId: string,
  oldValue: string,
  newValue: string,
  cellScope: CellRemapScope | undefined,
): ExpressionConditionConfig {
  let changed = false;
  const clauses = config.clauses.map((clause) => {
    if (clause.kind === 'group') {
      const inner = remapExpressionLiterals(clause.group, questionId, oldValue, newValue, cellScope);
      if (inner === clause.group) return clause;
      changed = true;
      return { ...clause, group: inner };
    }

    const { left, right } = clause.comparison;
    let nextLeft = left;
    let nextRight = right;
    if (operandRefersToTarget(left, questionId, cellScope) && right.kind === 'literal' && right.value === oldValue) {
      nextRight = { ...right, value: newValue };
    }
    if (operandRefersToTarget(right, questionId, cellScope) && left.kind === 'literal' && left.value === oldValue) {
      nextLeft = { ...left, value: newValue };
    }
    if (nextLeft === left && nextRight === right) return clause;
    changed = true;
    return { ...clause, comparison: { ...clause.comparison, left: nextLeft, right: nextRight } };
  });
  return changed ? { ...config, clauses } : config;
}

/** tableConditions 가 cellScope 의 셀을 실제로 포함하는지 (열 미지정 = 모든 열) */
function tableConditionsCoverCell(
  tableConditions: NonNullable<QuestionCondition['tableConditions']>,
  cellScope: CellRemapScope,
): boolean {
  if (!tableConditions.rowIds.includes(cellScope.rowId)) return false;
  return (
    tableConditions.cellColumnIndex === undefined
    || tableConditions.cellColumnIndex === cellScope.columnIndex
  );
}

/** additionalConditions 가 cellScope 의 셀을 참조하는지 (행 범위는 메인 조건 rowIds 폴백) */
function additionalConditionsCoverCell(
  condition: QuestionCondition,
  additionalConditions: NonNullable<QuestionCondition['additionalConditions']>,
  cellScope: CellRemapScope,
): boolean {
  if (additionalConditions.cellColumnIndex !== cellScope.columnIndex) return false;
  const rowIds =
    additionalConditions.rowIds && additionalConditions.rowIds.length > 0
      ? additionalConditions.rowIds
      : condition.tableConditions?.rowIds ?? [];
  return rowIds.includes(cellScope.rowId);
}

/** requiredValues / tableConditions.expectedValues / additionalConditions.expectedValues 에서 oldValue→newValue 치환 */
function remapConditionValues(
  condition: QuestionCondition,
  questionId: string,
  oldValue: string,
  newValue: string,
  cellScope: CellRemapScope | undefined,
): QuestionCondition {
  let changed = false;
  const next: QuestionCondition = { ...condition };

  // expression 은 피연산자가 참조 질문을 지정하므로 sourceQuestionId 게이트보다 먼저 처리
  if (condition.expressionConfig) {
    const remapped = remapExpressionLiterals(
      condition.expressionConfig,
      questionId,
      oldValue,
      newValue,
      cellScope,
    );
    if (remapped !== condition.expressionConfig) {
      changed = true;
      next.expressionConfig = remapped;
    }
  }

  if (condition.sourceQuestionId !== questionId) return changed ? next : condition;

  // requiredValues 는 질문 레벨 옵션 value 공간 — 셀 값 변경과는 무관
  if (!cellScope && condition.requiredValues?.includes(oldValue)) {
    changed = true;
    next.requiredValues = condition.requiredValues.map((v) => (v === oldValue ? newValue : v));
  }

  if (
    condition.tableConditions?.expectedValues?.includes(oldValue)
    && (!cellScope || tableConditionsCoverCell(condition.tableConditions, cellScope))
  ) {
    changed = true;
    next.tableConditions = {
      ...condition.tableConditions,
      expectedValues: condition.tableConditions.expectedValues.map((v) => (v === oldValue ? newValue : v)),
    };
  }

  if (
    condition.additionalConditions?.expectedValues?.includes(oldValue)
    && (!cellScope || additionalConditionsCoverCell(condition, condition.additionalConditions, cellScope))
  ) {
    changed = true;
    next.additionalConditions = {
      ...condition.additionalConditions,
      expectedValues: condition.additionalConditions.expectedValues.map((v) => (v === oldValue ? newValue : v)),
    };
  }

  return changed ? next : condition;
}

/**
 * 옵션 value 변경 시 질문 표시조건 그룹의 참조를 리매핑한다.
 * sourceQuestionId 가 questionId 와 일치하는 조건의 requiredValues /
 * tableConditions.expectedValues / additionalConditions.expectedValues 와,
 * 대상 질문 피연산자와 비교되는 expression literal 에서 oldValue → newValue 치환.
 * cellScope 가 주어지면(셀 옵션 변경) 그 셀을 실제로 참조하는 조건만 대상으로 한다.
 * 변경이 없으면 원본 그룹 참조를 그대로 반환한다.
 */
export function remapConditionGroupValues(
  group: QuestionConditionGroup,
  questionId: string,
  oldValue: string,
  newValue: string,
  cellScope?: CellRemapScope,
): QuestionConditionGroup {
  let changed = false;

  const nextConditions = group.conditions.map((condition) => {
    const next = remapConditionValues(condition, questionId, oldValue, newValue, cellScope);
    if (next !== condition) changed = true;
    return next;
  });

  return changed ? { ...group, conditions: nextConditions } : group;
}

// ── 질문 id 참조 리매핑 (질문 생성 시 temp id → DB id 스왑용) ──

function remapExpressionOperand(
  operand: ExpressionOperand,
  oldId: string,
  newId: string,
): ExpressionOperand {
  switch (operand.kind) {
    case 'question':
    case 'cell':
      return operand.questionId === oldId ? { ...operand, questionId: newId } : operand;
    case 'binop': {
      const left = remapExpressionOperand(operand.left, oldId, newId);
      const right = remapExpressionOperand(operand.right, oldId, newId);
      return left === operand.left && right === operand.right
        ? operand
        : { ...operand, left, right };
    }
    default:
      return operand;
  }
}

function remapExpressionConfig(
  config: ExpressionConditionConfig,
  oldId: string,
  newId: string,
): ExpressionConditionConfig {
  let changed = false;
  const clauses = config.clauses.map((clause) => {
    if (clause.kind === 'comparison') {
      const left = remapExpressionOperand(clause.comparison.left, oldId, newId);
      const right = remapExpressionOperand(clause.comparison.right, oldId, newId);
      if (left === clause.comparison.left && right === clause.comparison.right) return clause;
      changed = true;
      return { ...clause, comparison: { ...clause.comparison, left, right } };
    }
    const inner = remapExpressionConfig(clause.group, oldId, newId);
    if (inner === clause.group) return clause;
    changed = true;
    return { ...clause, group: inner };
  });
  return changed ? { ...config, clauses } : config;
}

/**
 * 질문 표시조건 그룹의 "질문 참조"를 oldId → newId 로 리매핑한다.
 * 대상: 조건의 sourceQuestionId + expression 모드의 question/cell/binop 피연산자.
 * 질문 생성 직후 temp id 가 DB id 로 스왑될 때, 이 질문을 참조하는 타 질문/그룹/
 * 행/열 조건이 끊어지지 않도록 스왑 지점에서 함께 호출한다.
 * 변경이 없으면 원본 그룹 참조를 그대로 반환한다.
 */
export function remapConditionGroupQuestionRefs(
  group: QuestionConditionGroup,
  oldId: string,
  newId: string,
): QuestionConditionGroup {
  let changed = false;

  const nextConditions = group.conditions.map((condition) => {
    let next = condition;
    if (condition.sourceQuestionId === oldId) {
      next = { ...next, sourceQuestionId: newId };
    }
    if (condition.expressionConfig) {
      const remapped = remapExpressionConfig(condition.expressionConfig, oldId, newId);
      if (remapped !== condition.expressionConfig) {
        next = next === condition ? { ...condition, expressionConfig: remapped } : { ...next, expressionConfig: remapped };
      }
    }
    if (next !== condition) changed = true;
    return next;
  });

  return changed ? { ...group, conditions: nextConditions } : group;
}
