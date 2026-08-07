import type { QuestionCondition, QuestionConditionGroup, TableRow } from '@/types/survey';

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
