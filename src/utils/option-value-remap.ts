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

/** requiredValues / tableConditions.expectedValues / additionalConditions.expectedValues 에서 oldValue→newValue 치환 */
function remapConditionValues(
  condition: QuestionCondition,
  questionId: string,
  oldValue: string,
  newValue: string,
): QuestionCondition {
  if (condition.sourceQuestionId !== questionId) return condition;

  let changed = false;
  const next: QuestionCondition = { ...condition };

  if (condition.requiredValues?.includes(oldValue)) {
    changed = true;
    next.requiredValues = condition.requiredValues.map((v) => (v === oldValue ? newValue : v));
  }

  if (condition.tableConditions?.expectedValues?.includes(oldValue)) {
    changed = true;
    next.tableConditions = {
      ...condition.tableConditions,
      expectedValues: condition.tableConditions.expectedValues.map((v) => (v === oldValue ? newValue : v)),
    };
  }

  if (condition.additionalConditions?.expectedValues?.includes(oldValue)) {
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
 * tableConditions.expectedValues / additionalConditions.expectedValues 에서
 * oldValue → newValue 치환. 변경이 없으면 원본 그룹 참조를 그대로 반환한다.
 */
export function remapConditionGroupValues(
  group: QuestionConditionGroup,
  questionId: string,
  oldValue: string,
  newValue: string,
): QuestionConditionGroup {
  let changed = false;

  const nextConditions = group.conditions.map((condition) => {
    const next = remapConditionValues(condition, questionId, oldValue, newValue);
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
