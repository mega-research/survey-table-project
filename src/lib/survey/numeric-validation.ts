/**
 * 숫자 입력의 "다음"/제출 차단형 검증 순수 로직.
 * - 단답형·셀 min 미달 / 합계 제약(SumConstraint) / 필수 셀(TableCell.required)
 *
 * tableValidationRules(분기 전용, utils/branch-logic.ts)와 완전히 별개다.
 * 응답 shape: 단답형 = raw 숫자 문자열, 테이블 = { [cellId]: value } 평면 객체.
 */

import type { Question, SumConstraint, TableCell, TableRow } from '@/types/survey';
import { rangeViolationMessage } from '@/utils/number-format';
import { parseNumericInput } from '@/utils/numeric-input';
import { REQUIRED_CELL_TYPES } from '@/utils/serialize-cell';
import { isCellValuePresent } from '@/utils/table-cell-semantics';

export interface NumericIssue {
  kind: 'range' | 'sum' | 'required-cells';
  message: string;
  /** 위반 셀 id (테이블 전용 — 셀 하이라이트용) */
  cellIds?: string[];
}

function flatCells(rows: TableRow[] | null | undefined): TableCell[] {
  return (rows ?? []).flatMap((row) => row.cells);
}

function isEmptyCellValue(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * 응답자에게 실제로 "보이는" 셀 목록 — 미선택 동적 행(enabledDynamicGroupIds에 속하고
 * __selectedRowIds에 없는 행)의 셀과 isHidden 셀을 제외한다.
 * 필수 셀 검증과 합계 검증이 이 필터를 공유한다: 동적 행을 선택→입력→선택 해제하면 셀 값이
 * 응답 객체에 잔존하는데(use-dynamic-row-state 는 __selectedRowIds 만 patch), 화면에 없는
 * 그 값이 필수 판정·합계에 기여하면 안 된다.
 */
function visibleCells(
  rows: TableRow[],
  cellValues: Record<string, unknown>,
  dynamicRowConfigs: Question['dynamicRowConfigs'],
): TableCell[] {
  const enabledDynamicGroupIds = new Set(
    (dynamicRowConfigs ?? []).filter((c) => c.enabled).map((c) => c.groupId),
  );
  const selectedRowIds = new Set(
    Array.isArray(cellValues['__selectedRowIds'])
      ? (cellValues['__selectedRowIds'] as string[])
      : [],
  );
  return rows
    .filter(
      (row) =>
        !(row.dynamicGroupId && enabledDynamicGroupIds.has(row.dynamicGroupId)) ||
        selectedRowIds.has(row.id),
    )
    .flatMap((row) => row.cells)
    .filter((c) => !c.isHidden);
}

/**
 * 합계 평가 — 빈 셀은 0, 전부 빈 값이거나 유효 셀 0개면 skipped. 소수 9자리 반올림 후 비교.
 * @param existingCellIds 합산 대상으로 유효한(=보이는) 셀 id 집합. 호출부가 미선택 동적 행·isHidden
 *   셀을 미리 걸러 넘긴다 — 화면에 없는 잔존 값이 합계에 기여하지 않도록.
 */
export function evaluateSumConstraint(
  constraint: SumConstraint,
  cellValues: Record<string, unknown>,
  existingCellIds: Set<string>,
): { skipped: boolean; ok: boolean; sum: number } {
  const targetIds = constraint.cellIds.filter((id) => existingCellIds.has(id));
  if (targetIds.length === 0) return { skipped: true, ok: true, sum: 0 };
  if (targetIds.every((id) => isEmptyCellValue(cellValues[id]))) {
    return { skipped: true, ok: true, sum: 0 };
  }
  const sum = targetIds.reduce((acc, id) => {
    const v = cellValues[id];
    const n = typeof v === 'string' ? parseNumericInput(v) : null;
    return acc + (n ?? 0);
  }, 0);
  const rounded = Math.round(sum * 1e9) / 1e9;
  const ok =
    constraint.operator === 'eq'
      ? rounded === constraint.target
      : constraint.operator === 'lte'
        ? rounded <= constraint.target
        : rounded >= constraint.target;
  return { skipped: false, ok, sum: rounded };
}

const SUM_OPERATOR_PHRASES: Record<SumConstraint['operator'], string> = {
  eq: '이 되어야 합니다',
  lte: ' 이하여야 합니다',
  gte: ' 이상이어야 합니다',
};

function sumConstraintMessage(constraint: SumConstraint, sum: number): string {
  const base =
    constraint.errorMessage?.trim() ||
    `선택된 셀 합계가 ${constraint.target}${SUM_OPERATOR_PHRASES[constraint.operator]}`;
  return `${base} (현재 ${sum})`;
}

/**
 * 질문 하나의 차단형 숫자 검증 위반 목록.
 * - 단답형(text + inputType 'number'): numberFormat.min 미달 (빈 값은 검증 안 함)
 * - table: 셀 min 미달, 합계 제약 위반, 필수 셀 미입력
 *   테이블 미접촉(응답 키 0개)이면 전부 스킵 — 미응답 차단은 question.required 소관.
 */
export function collectNumericIssues(question: Question, response: unknown): NumericIssue[] {
  if (question.type === 'text' && question.inputType === 'number') {
    if (typeof response !== 'string') return [];
    const message = rangeViolationMessage(response, question.numberFormat);
    return message ? [{ kind: 'range', message }] : [];
  }

  if (question.type !== 'table') return [];
  const cellValues =
    typeof response === 'object' && response !== null
      ? (response as Record<string, unknown>)
      : {};
  // 미접촉 판정은 실제 셀 값 키 기준 — __selectedRowIds/__optTexts__ 등 사이드카 키는 세지 않는다.
  // (emptyDefault 자동 채움이 있으면 셀 키가 생겨 검증 대상이 된다 — 의도됨, Q1 그릴링 확정)
  const hasAnyCellValue = Object.keys(cellValues).some((k) => !k.startsWith('__'));
  if (!hasAnyCellValue) return [];

  const rows = question.tableRowsData ?? [];
  const cells = flatCells(rows);
  const inputCells = cells.filter((c) => c.type === 'input' && !c.isHidden);
  const issues: NumericIssue[] = [];

  // 1) 셀 범위 위반 — min 미달 + max 초과 (max 는 타이핑 차단이 원칙이지만
  //    emptyDefault 오설정·레거시 응답의 우회 값을 다음/제출에서 봉합한다)
  const rangeViolations = inputCells.filter((c) => {
    if (c.inputType !== 'number') return false;
    const v = cellValues[c.id];
    if (typeof v !== 'string') return false;
    return rangeViolationMessage(v, c.numberFormat) !== null;
  });
  if (rangeViolations.length > 0) {
    issues.push({
      kind: 'range',
      message: '허용 범위를 벗어난 값이 입력된 셀이 있습니다',
      cellIds: rangeViolations.map((c) => c.id),
    });
  }

  // 2) 합계 제약 — 합산 대상은 "보이는 셀"로 한정 (미선택 동적 행 잔존 값·isHidden 셀 제외)
  const visible = visibleCells(rows, cellValues, question.dynamicRowConfigs);
  const existingIds = new Set(visible.map((c) => c.id));
  for (const constraint of question.sumConstraints ?? []) {
    const result = evaluateSumConstraint(constraint, cellValues, existingIds);
    if (!result.skipped && !result.ok) {
      issues.push({
        kind: 'sum',
        message: sumConstraintMessage(constraint, result.sum),
        cellIds: constraint.cellIds.filter((id) => existingIds.has(id)),
      });
    }
  }

  // 3) 필수 셀 — "표시될 때만 필수": isHidden 셀과 미선택 동적 행의 셀은 제외 (영구 차단 방지)
  //    대상은 REQUIRED_CELL_TYPES(input/radio/checkbox/select/ranking). 응답됨 판정은
  //    isCellValuePresent 정본(배열 length>0, 문자열 trim, 그 외 truthy) — checkbox/ranking
  //    빈 배열을 미응답으로 본다.
  const missingRequired = visible.filter(
    (c) => REQUIRED_CELL_TYPES.has(c.type) && c.required && !isCellValuePresent(cellValues[c.id]),
  );
  if (missingRequired.length > 0) {
    issues.push({
      kind: 'required-cells',
      message: '필수 응답이 비어있습니다',
      cellIds: missingRequired.map((c) => c.id),
    });
  }

  return issues;
}

/** 빌더 저장용 — 삭제된 셀을 가리키는 cellId 제거 (평가 시 무시와 별개의 이중 방어) */
export function pruneSumConstraints(
  constraints: SumConstraint[],
  rows: TableRow[],
): SumConstraint[] {
  const ids = new Set(flatCells(rows).map((c) => c.id));
  return constraints.map((c) => ({ ...c, cellIds: c.cellIds.filter((id) => ids.has(id)) }));
}
