/**
 * "다음"/제출 차단형 검증 순수 로직.
 * - 단답형·셀 min 미달 / 합계 제약(SumConstraint) / 필수 셀(TableCell.required)
 * - 필수 질문·셀에서 선택된 allowTextInput/랭킹 기타 상세기입 누락
 *
 * tableValidationRules(분기 전용, utils/branch-logic.ts)와 완전히 별개다.
 * 응답 shape: 단답형 = raw 숫자 문자열, 테이블 = { [cellId]: value } 평면 객체.
 */
import type { Question, SumConstraint, SurveyLookup, TableCell, TableRow } from '@/types/survey';
import {
  shouldDisplayColumn,
  shouldDisplayDynamicGroup,
  shouldDisplayRow,
} from '@/utils/branch-logic';
import { rangeViolationMessage } from '@/utils/number-format';
import { parseNumericInput } from '@/utils/numeric-input';
import { REQUIRED_CELL_TYPES } from '@/utils/serialize-cell';
import { DEFAULT_REQUIRED_CELL_MESSAGE } from '@/utils/required-message';
import { isCellValuePresent } from '@/utils/table-cell-semantics';

import { evaluateCellFormula, roundFormulaValue } from './cell-formula';
import { isCellEnabled } from './cell-gating';
import { collectRequiredOptionTextIssues } from './required-option-text-validation';

export interface NumericIssue {
  kind: 'range' | 'sum' | 'required-cells' | 'required-detail' | 'formula';
  message: string;
  /** 위반 셀 id (테이블 전용 — 셀 하이라이트용) */
  cellIds?: string[];
  /** 실제 상세 입력 요소를 우선 탐색하기 위한 안정 DOM 타깃 ID */
  detailTargetIds?: string[];
}

/**
 * 열/행 displayCondition 평가용 컨텍스트. 렌더러(interactive-table-response)가
 * shouldDisplayColumn/Row 로 숨기는 열·행과 검증 대상을 일치시키기 위해 필요하다.
 * 미전달 시 조건 평가를 생략(전부 표시로 간주) — 조건 없는 표는 동작 동일.
 */
export interface NumericValidationCtx {
  allResponses: Record<string, unknown>;
  allQuestions: Question[];
  optionTexts?: Record<string, string> | undefined;
  /** 수식 검증(evaluateCellFormula)용 — 미주입 시 수식 검증만 스킵 */
  lookups?: SurveyLookup[];
  contactAttrs?: Record<string, string | undefined>;
}

function flatCells(rows: TableRow[] | null | undefined): TableCell[] {
  return (rows ?? []).flatMap((row) => row.cells);
}

function isEmptyCellValue(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * 셀 필수 판정 수렴식 — (required || requiredWhenEnabled). 게이팅되지 않은 기존 required=true
 * 셀도 이 식으로 커버된다(requiredWhenEnabled 는 그냥 false/undefined).
 * required-option-text-validation.ts 가 이미 이 파일의 collectVisibleTableCells 를 재사용하는
 * 의존 방향과 일관되게, 셀 필수 판정도 여기서 export 해 공유한다(중복 정의 금지 — 두 파일이
 * 갈리면 "검증은 필수인데 상세기입 누락 판정은 필수 아님" 불일치가 재발한다).
 */
export function isRequiredCell(cell: TableCell): boolean {
  return cell.required === true || cell.requiredWhenEnabled === true;
}

/**
 * 응답자에게 실제로 "보이는" 셀 목록 — 다음을 제외한다.
 * - 미선택 동적 행(enabledDynamicGroupIds에 속하고 __selectedRowIds에 없는 행)의 셀
 * - isHidden 셀(병합 피복 셀)
 * - ctx 전달 시: displayCondition 미충족으로 렌더러가 숨기는 열의 셀(위치 기반 매핑,
 *   row.cells[i] ↔ tableColumns[i])과 행의 셀
 * 필수 셀·범위·합계 검증이 이 필터를 공유한다: 화면에 없는 셀의 잔존 값이나 미입력이
 * 검증에 기여하면 안 된다 (숨은 열의 필수 셀이 "다음"을 영구 차단하는 버그 방지).
 */
export function collectVisibleTableCells(
  question: Question,
  cellValues: Record<string, unknown>,
  ctx: NumericValidationCtx | undefined,
): TableCell[] {
  const rows = question.tableRowsData ?? [];
  const enabledDynamicGroupIds = new Set(
    (question.dynamicRowConfigs ?? []).filter((c) => c.enabled).map((c) => c.groupId),
  );
  const visibleDynamicGroupIds = new Set(
    (question.dynamicRowConfigs ?? [])
      .filter(
        (config) =>
          config.enabled &&
          (!ctx || shouldDisplayDynamicGroup(config, ctx.allResponses, ctx.allQuestions)),
      )
      .map((config) => config.groupId),
  );
  const selectedRowIds = new Set(
    Array.isArray(cellValues['__selectedRowIds'])
      ? (cellValues['__selectedRowIds'] as string[])
      : [],
  );
  const hasEnabledDynamicRows = rows.some(
    (row) => row.dynamicGroupId && enabledDynamicGroupIds.has(row.dynamicGroupId),
  );
  const groupsWithSelections = new Set<string>();
  for (const row of rows) {
    if (
      row.dynamicGroupId &&
      visibleDynamicGroupIds.has(row.dynamicGroupId) &&
      selectedRowIds.has(row.id)
    ) {
      groupsWithSelections.add(row.dynamicGroupId);
    }
  }
  const hiddenColIndices = new Set<number>();
  if (ctx) {
    (question.tableColumns ?? []).forEach((col, idx) => {
      if (col.displayCondition && !shouldDisplayColumn(col, ctx.allResponses, ctx.allQuestions)) {
        hiddenColIndices.add(idx);
      }
    });
  }
  return rows
    .filter(
      (row) =>
        (!(row.dynamicGroupId && enabledDynamicGroupIds.has(row.dynamicGroupId)) ||
          (visibleDynamicGroupIds.has(row.dynamicGroupId) && selectedRowIds.has(row.id))) &&
        (!(
          hasEnabledDynamicRows &&
          row.showWhenDynamicGroupId &&
          enabledDynamicGroupIds.has(row.showWhenDynamicGroupId)
        ) ||
          (visibleDynamicGroupIds.has(row.showWhenDynamicGroupId) &&
            groupsWithSelections.has(row.showWhenDynamicGroupId))),
    )
    .filter(
      (row) =>
        !ctx || !row.displayCondition || shouldDisplayRow(row, ctx.allResponses, ctx.allQuestions),
    )
    .flatMap((row) => row.cells.filter((_, idx) => !hiddenColIndices.has(idx)))
    .filter((c) => !c.isHidden);
}

/** 비교 판정 공통 헬퍼 — 반올림 완료된 좌/우값. tolerance 는 eq/ne 에만 의미가 있다. */
function compareValues(
  left: number,
  right: number,
  op: SumConstraint['operator'],
  tolerance: number,
): boolean {
  switch (op) {
    case 'eq':
      return Math.abs(left - right) <= tolerance;
    case 'ne':
      return Math.abs(left - right) > tolerance;
    case 'gte':
      return left >= right;
    case 'lte':
      return left <= right;
    case 'gt':
      return left > right;
    case 'lt':
      return left < right;
  }
}

/** leftExpr/targetExpr 평가용 옵션 — 미전달 시 확장 규칙은 skipped(fail-safe) */
export interface SumConstraintEvalOpts {
  ownQuestionId: string;
  ctx: NumericValidationCtx;
}

function toFormulaCtx(ctx: NumericValidationCtx) {
  return {
    questions: ctx.allQuestions,
    responses: ctx.allResponses,
    lookups: ctx.lookups ?? [],
    contactAttrs: ctx.contactAttrs ?? {},
  };
}

/**
 * 비교 제약 평가 — 좌변은 cellIds 합계(레거시) 또는 leftExpr 수식, 우변은 target 리터럴
 * 또는 targetExpr 수식. 어느 변이든 평가 불능(null)이면 skipped — fail-safe 통과.
 * 레거시 경로: 빈 셀은 0, 전부 빈 값이거나 유효 셀 0개면 skipped. 소수 9자리 반올림 후 비교.
 * @param existingCellIds 합산 대상으로 유효한(=보이는) 셀 id 집합. 호출부가 미선택 동적 행·isHidden
 *   셀을 미리 걸러 넘긴다 — 화면에 없는 잔존 값이 합계에 기여하지 않도록.
 */
export function evaluateSumConstraint(
  constraint: SumConstraint,
  cellValues: Record<string, unknown>,
  existingCellIds: Set<string>,
  evalOpts?: SumConstraintEvalOpts,
): { skipped: boolean; ok: boolean; sum: number } {
  // 좌변
  let left: number;
  if (constraint.leftExpr) {
    if (!evalOpts) return { skipped: true, ok: true, sum: 0 };
    const v = evaluateCellFormula(constraint.leftExpr, evalOpts.ownQuestionId, toFormulaCtx(evalOpts.ctx));
    if (v === null) return { skipped: true, ok: true, sum: 0 };
    left = v;
  } else {
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
    left = Math.round(sum * 1e9) / 1e9;
  }

  // 우변
  let right: number;
  if (constraint.targetExpr) {
    if (!evalOpts) return { skipped: true, ok: true, sum: left };
    const v = evaluateCellFormula(constraint.targetExpr, evalOpts.ownQuestionId, toFormulaCtx(evalOpts.ctx));
    if (v === null) return { skipped: true, ok: true, sum: left };
    right = v;
  } else {
    right = constraint.target;
  }

  const ok = compareValues(left, right, constraint.operator, constraint.tolerance ?? 0);
  return { skipped: false, ok, sum: left };
}

const SUM_OPERATOR_PHRASES: Record<SumConstraint['operator'], string> = {
  eq: '이 되어야 합니다',
  ne: '이 아니어야 합니다',
  lte: ' 이하여야 합니다',
  gte: ' 이상이어야 합니다',
  lt: ' 미만이어야 합니다',
  gt: ' 초과여야 합니다',
};

// 우변이 수식(targetExpr)이면 값을 노출하지 않는다 — 이전 응답·attrs 기반 기준값은
// 응답자에게 힌트가 되므로 "기준값" 으로만 지칭 (셀 수식 검증의 계산값 미노출 원칙과 동일).
function sumConstraintMessage(constraint: SumConstraint, sum: number): string {
  const subject = constraint.leftExpr ? '계산 값' : '선택된 셀 합계';
  const target = constraint.targetExpr ? '기준값' : String(constraint.target);
  const base =
    constraint.errorMessage?.trim() ||
    `${subject}가 ${target}${SUM_OPERATOR_PHRASES[constraint.operator]}`;
  return `${base} (현재 ${sum})`;
}

/**
 * 질문 하나의 차단형 검증 위반 목록.
 * - 단답형(text + inputType 'number'): numberFormat.min 미달 (빈 값은 검증 안 함)
 * - table: 셀 min 미달, 합계 제약 위반, 필수 셀 미입력
 *   테이블 미접촉(응답 키 0개)이면 전부 스킵 — 미응답 차단은 question.required 소관.
 */
export function collectNumericIssues(
  question: Question,
  response: unknown,
  ctx?: NumericValidationCtx,
): NumericIssue[] {
  if (question.type === 'text' && question.inputType === 'number') {
    if (typeof response !== 'string') return [];
    const message = rangeViolationMessage(response, question.numberFormat);
    return message ? [{ kind: 'range', message }] : [];
  }

  if (question.type !== 'table') {
    const optionTextIssues = collectRequiredOptionTextIssues(question, response, ctx?.optionTexts);
    return optionTextIssues.questionMissing
      ? [
          {
            kind: 'required-detail',
            message: DEFAULT_REQUIRED_CELL_MESSAGE,
            detailTargetIds: optionTextIssues.detailTargetIds ?? [],
          },
        ]
      : [];
  }
  const cellValues =
    typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {};
  // 미접촉 판정은 실제 셀 값 키 기준 — __selectedRowIds/__optTexts__ 등 사이드카 키는 세지 않는다.
  // (emptyDefault 자동 채움이 있으면 셀 키가 생겨 검증 대상이 된다 — 의도됨, Q1 그릴링 확정)
  const hasAnyCellValue = Object.keys(cellValues).some((k) => !k.startsWith('__'));
  if (!hasAnyCellValue) return [];

  const visible = collectVisibleTableCells(question, cellValues, ctx);
  // 게이팅 — 비활성 셀은 모든 차단형 검증에서 제외한다 (비활성 필수 셀이 "다음"을
  // 영구 차단하는 것 방지). isCellEnabled 는 같은 질문의 cellValues 만 본다.
  // rowCells(같은 행 셀 목록)를 함께 전달해야 option 조건의 {optionId} 래핑·id 저장
  // 응답을 정확히 해석한다 — tableRowsData 에서 셀 id → row.cells 매핑을 만든다.
  const rowOfCell = new Map<string, TableCell[]>();
  for (const row of question.tableRowsData ?? []) {
    for (const cell of row.cells) rowOfCell.set(cell.id, row.cells);
  }
  const enabled = visible.filter((c) => isCellEnabled(c, cellValues, rowOfCell.get(c.id)));
  const inputCells = enabled.filter((c) => c.type === 'input');
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

  // 2) 합계 제약 — 합산 대상은 "보이고 활성인 셀"로 한정 (미선택 동적 행 잔존 값·isHidden 셀·
  //    숨은 열/행·비활성 게이팅 셀 제외)
  const existingIds = new Set(enabled.map((c) => c.id));
  for (const constraint of question.sumConstraints ?? []) {
    const result = evaluateSumConstraint(
      constraint,
      cellValues,
      existingIds,
      ctx ? { ownQuestionId: question.id, ctx } : undefined,
    );
    if (!result.skipped && !result.ok) {
      // leftExpr 규칙은 하이라이트할 선택 셀이 없다 — cellIds 를 싣지 않는다.
      const highlightIds = constraint.leftExpr
        ? []
        : constraint.cellIds.filter((id) => existingIds.has(id));
      issues.push({
        kind: 'sum',
        message: sumConstraintMessage(constraint, result.sum),
        ...(highlightIds.length > 0 ? { cellIds: highlightIds } : {}),
      });
    }
  }

  // 3) 필수 셀 — "표시되고 활성일 때만 필수": isHidden 셀·미선택 동적 행의 셀·비활성 게이팅
  //    셀은 제외 (영구 차단 방지). 대상은 REQUIRED_CELL_TYPES(input/radio/checkbox/select/ranking).
  //    필수 판정은 (required || requiredWhenEnabled) 수렴식 — enabled 목록 위에서 검사하므로
  //    "&& 활성" 은 목록 필터로 이미 성립한다. 응답됨 판정은 isCellValuePresent 정본(배열
  //    length>0, 문자열 trim, 그 외 truthy) — checkbox/ranking 빈 배열을 미응답으로 본다.
  const ordinaryMissingCells = enabled.filter(
    (c) =>
      REQUIRED_CELL_TYPES.has(c.type) &&
      isRequiredCell(c) &&
      !isCellValuePresent(cellValues[c.id]),
  );
  // 셀별 지정 문구(requiredMessage)가 있으면 문구 단위로 별도 이슈를 만든다 —
  // 지정 문구 없는 셀들은 아래 기본 문구 통합 이슈(상세기입 포함)로 묶인다.
  const customMessageCellIds = new Map<string, string[]>();
  const defaultMissingIds: string[] = [];
  for (const c of ordinaryMissingCells) {
    const custom = c.requiredMessage?.trim();
    if (custom) {
      customMessageCellIds.set(custom, [...(customMessageCellIds.get(custom) ?? []), c.id]);
    } else {
      defaultMissingIds.push(c.id);
    }
  }
  for (const [message, cellIds] of customMessageCellIds) {
    issues.push({ kind: 'required-cells', message, cellIds });
  }
  const visibleOptionTextIssues = collectRequiredOptionTextIssues(
    question,
    cellValues,
    ctx?.optionTexts,
    { visibleCellIds: existingIds },
  );
  const missingIds = [
    ...new Set([
      ...defaultMissingIds,
      ...visibleOptionTextIssues.cellIds,
      ...(visibleOptionTextIssues.detailCellIds ?? []),
    ]),
  ].filter((id) => existingIds.has(id));
  if (missingIds.length > 0) {
    issues.push({
      kind: 'required-cells',
      message: DEFAULT_REQUIRED_CELL_MESSAGE,
      cellIds: missingIds,
      ...(visibleOptionTextIssues.detailTargetIds
        ? { detailTargetIds: visibleOptionTextIssues.detailTargetIds }
        : {}),
    });
  }

  // 4) 수식 검증 (스펙 §7) — 입력값 vs 계산값. 빈 입력은 스킵 (입력 강제는 required 소관).
  //    비활성 셀은 제외 — 지워지기 전 잔존 값이 수식 불일치로 차단하면 안 됨.
  for (const cell of enabled) {
    if (cell.type !== 'input' || cell.inputType !== 'number' || !cell.formula) continue;
    const raw = cellValues[cell.id];
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const entered = parseNumericInput(raw);
    if (entered === null) continue;
    if (!ctx) continue; // 컨텍스트 없으면 평가 불가 — fail-safe 통과
    const computed = evaluateCellFormula(
      cell.formula,
      question.id,
      {
        questions: ctx.allQuestions,
        responses: ctx.allResponses,
        lookups: ctx.lookups ?? [],
        contactAttrs: ctx.contactAttrs ?? {},
      },
      cell.numberFormat?.decimalPlaces,
    );
    if (computed === null) continue; // 순환·LUT 미해결 — fail-safe 통과
    const tolerance = cell.formulaTolerance ?? 0;
    const roundedInput = roundFormulaValue(entered, cell.numberFormat?.decimalPlaces);
    if (Math.abs(roundedInput - computed) > tolerance) {
      issues.push({
        kind: 'formula',
        message:
          cell.formulaErrorMessage?.trim() ||
          '입력하신 값이 앞서 입력한 값들의 계산 결과와 일치하지 않습니다.',
        cellIds: [cell.id],
      });
    }
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
