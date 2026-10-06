/**
 * "다음"/제출 차단형 검증 순수 로직.
 * - 단답형·셀 min 미달 / 합계 제약(SumConstraint) / 필수 셀(TableCell.required)
 * - 필수 질문·셀에서 선택된 allowTextInput/랭킹 기타 상세기입 누락
 *
 * tableValidationRules(분기 전용, utils/branch-logic.ts)와 완전히 별개다.
 * 응답 shape: 단답형 = raw 숫자 문자열, 테이블 = { [cellId]: value } 평면 객체.
 */
import { projectConditionalTableLayout } from '@/features/question-renderer/utils/conditional-table-layout';
import { optionTextTargetId } from '@/features/question-renderer/utils/option-text-target';
import { stagedOptionalCellIds } from '@/features/question-renderer/utils/staged-rows';
import {
  areAllFormulaRefsEmpty,
  evaluateCellFormula,
  roundFormulaValue,
} from '@/lib/survey/cell-formula';
import { collectTableCells, isCellEnabled } from '@/lib/survey/cell-gating';
import { resolveCellTextQualityViolation } from '@/features/question-renderer/utils/cell-text-quality';
import { isTokenPrefilled } from '@/features/question-renderer/utils/token-prefill';
import {
  collectSelectedChoiceCellIds,
  isChoiceGroupTableQuestion,
  readTableChoiceGroups,
} from '@/lib/survey/choice-selection';
import {
  CHOICE_TABLE_CONTROL_CELL_TYPES,
  isChoiceTableCellEmpty,
} from '@/lib/survey/choice-table-cell-value';
import {
  type PriorAnswers,
  isUntouchedPriorValue,
  priorAnswerText,
  priorOptionText,
} from '@/lib/survey/prior-answers';
import { isInputFormat } from '@/types/input-type';
import type { Question, SumConstraint, SurveyLookup, TableCell } from '@/types/survey';
import { type BranchEvalCtx, responsesToLookupShape } from '@/utils/branch-eval';
import {
  shouldDisplayColumn,
  shouldDisplayDynamicGroup,
  shouldDisplayRow,
} from '@/utils/branch-logic';
import { isChoiceTableSource, resolveChoiceOptions } from '@/utils/choice-source';
import { formatFailureMessage, parseInputFormat } from '@/features/question-renderer/utils/input-format';
import { rangeViolationMessage } from '@/utils/number-format';
import { parseNumericInput } from '@/utils/numeric-input';
import { collectSelectedOptionIds } from '@/utils/option-text-migration';
import { DEFAULT_REQUIRED_CELL_MESSAGE } from '@/utils/required-message';
import { REQUIRED_CELL_TYPES, isCellValuePresent } from '@/utils/table-cell-semantics';
import { recalculateRowspansForVisibleRows } from '@/utils/table-merge-helpers';
import {
  type TextQualityViolation,
  isPlainTextInput,
  textQualityViolation,
} from '@/features/question-renderer/utils/text-quality';

import { resolveMaxSelections } from '@/features/question-renderer/utils/dynamic-selection-limit';
import { countSelectionsTowardMax } from '@/features/question-renderer/utils/exclusive-choice';
import { isGroupedChoiceQuestion } from '@/utils/choice-group-helpers';

import { isExclusiveChoiceValue } from './answer-validation';
import { collectRequiredOptionTextIssues } from './required-option-text-validation';

export interface NumericIssue {
  kind:
    | 'range'
    | 'sum'
    | 'required-cells'
    | 'required-detail'
    | 'formula'
    | 'format'
    /** 단답형·장문형 응답 품질(최소 글자 수·의미 없는 입력) — 입력칸 아래에 문구가 붙는다 */
    | 'text-quality'
    /** 체크박스 최대 선택 개수 초과 — 상한이 다른 문항 응답을 따라갈 때만 생긴다 */
    | 'selection-max';
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
  /**
   * 이월 응답 한 벌(원본). 입력 형식 검사의 면제 판정에만 쓴다 — 값이 이월 원본과
   * 글자 그대로 같으면 응답자가 손대지 않은 것이므로 검사하지 않는다. 미전달 시 전부 검사.
   */
  priorAnswers?: PriorAnswers | null;
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
 * - isHidden 셀(병합 피복 셀). 단 숨은 행에서 시작한 세로 병합 셀이 가시 행에 올라와 그려지면
 *   그 셀은 포함한다 (렌더러와 같은 투영)
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
          (!ctx ||
            shouldDisplayDynamicGroup(
              config,
              ctx.allResponses,
              ctx.allQuestions,
              toBranchEvalCtx(ctx),
            )),
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
      if (
        col.displayCondition &&
        !shouldDisplayColumn(col, ctx.allResponses, ctx.allQuestions, toBranchEvalCtx(ctx))
      ) {
        hiddenColIndices.add(idx);
      }
    });
  }
  const visibleRows = rows
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
        !ctx ||
        !row.displayCondition ||
        shouldDisplayRow(row, ctx.allResponses, ctx.allQuestions, toBranchEvalCtx(ctx)),
    );
  // 숨은 행에서 시작한 세로 병합 셀은 렌더러가 같은 id 로 첫 가시 행에 올려 그린다 — 화면에
  // 있는 칸이므로 검증 대상이다. 렌더러와 같은 투영(recalculateRowspansForVisibleRows)을 쓴다.
  // 행이 하나도 숨지 않았거나 세로 병합이 없으면 투영이 필요 없다(대다수 표).
  const projectedRows =
    visibleRows.length < rows.length &&
    rows.some((row) => row.cells.some((cell) => (cell.rowspan ?? 1) > 1))
      ? recalculateRowspansForVisibleRows(rows, new Set(visibleRows.map((row) => row.id)))
      : visibleRows;
  return projectedRows
    .flatMap((row) => row.cells.filter((_, idx) => !hiddenColIndices.has(idx)))
    .filter((c) => !c.isHidden);
}

/**
 * 보기 그룹 표의 필수 판정에 넘길 **보이는 셀 id 집합** (`answer-validation` 의 visibleCellIds).
 *
 * 필수 셀·범위 검증과 같은 필터(collectVisibleTableCells)를 써서, 행·열 표시조건이나 선택 안 된
 * 동적 행으로 숨은 보기 그룹이 「다음」을 막지 않게 한다. 보기 그룹 표가 아니면 undefined —
 * 레거시 보기 소스 표(radio/checkbox)는 동적 행 선택이 표 응답 밖(루트 사이드카)에 있어 이
 * 필터로 판정하면 선택된 동적 행까지 숨은 것으로 오판한다.
 */
export function resolveChoiceGroupVisibleCellIds(
  question: Question,
  response: unknown,
  ctx: NumericValidationCtx,
): ReadonlySet<string> | undefined {
  if (!isChoiceGroupTableQuestion(question)) return undefined;
  const cellValues =
    response && typeof response === 'object' && !Array.isArray(response)
      ? (response as Record<string, unknown>)
      : {};
  return new Set(collectVisibleTableCells(question, cellValues, ctx).map((cell) => cell.id));
}

/**
 * 필수 판정에서 빼는 셀 — 반복 2벌 이후의 셀.
 * 1벌은 평범한 필수 셀이고, 그 뒤 벌은 "더 적을 것이 있으면 적는" 자리다.
 */
function collectRepeatOptionalCellIds(question: Question): Set<string> {
  const ids = new Set<string>();
  for (const row of question.tableRowsData ?? []) {
    if ((row.repeatIndex ?? 1) < 2) continue;
    for (const cell of row.cells) ids.add(cell.id);
  }
  return ids;
}

/**
 * NumericValidationCtx → 조건 평가 컨텍스트.
 *
 * 렌더러(interactive-table-response)와 같은 ctx 로 평가해야 "화면엔 안 보이는데 검증에
 * 걸린다"가 생기지 않는다. attr 피연산자를 빠뜨리면 `!=` 비교가 항상 참이 되어
 * 조건이 조용히 무력화된다(2026-09-08 사고).
 */
function toBranchEvalCtx(ctx: NumericValidationCtx): BranchEvalCtx {
  return {
    responses: responsesToLookupShape(ctx.allResponses),
    contactAttrs: ctx.contactAttrs ?? {},
    lookups: ctx.lookups ?? [],
  };
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
 * 수식 평가용 ctx 에서 자기 질문 응답을 existingCellIds(보이고 활성인 셀)로 마스킹한다.
 * 미선택 동적 행·isHidden 셀·비활성 게이팅 셀은 값이 보존된 채 existingCellIds 에서만
 * 빠지므로, 마스킹 없이 수식을 평가하면 화면에 없는 잔존값이 합계에 되살아나 응답자를
 * 오차단한다 — 레거시 cellIds 경로의 필터와 동일 의미론을 수식 경로에도 적용한다.
 * 다른 질문 참조는 이 검증의 가시성 범위 밖이므로 건드리지 않는다.
 */
function toMaskedFormulaCtx(
  ctx: NumericValidationCtx,
  ownQuestionId: string,
  existingCellIds: Set<string>,
) {
  const base = toFormulaCtx(ctx);
  const own = base.responses[ownQuestionId];
  if (!own || typeof own !== 'object' || Array.isArray(own)) return base;
  const masked: Record<string, unknown> = {};
  for (const [cellId, value] of Object.entries(own)) {
    if (existingCellIds.has(cellId)) masked[cellId] = value;
  }
  return { ...base, responses: { ...base.responses, [ownQuestionId]: masked } };
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
): { skipped: boolean; ok: boolean; sum: number; target?: number } {
  // 좌변
  let left: number;
  if (constraint.leftExpr) {
    if (!evalOpts) return { skipped: true, ok: true, sum: 0 };
    // 보이는 셀에 실제 값이 하나도 없으면(미접촉이거나 숨은 잔존값뿐) skipped —
    // 레거시 cellIds 경로의 "전부 빈 값이면 skipped" 와 동일 의미론. 이 가드가 없으면
    // 외부 참조(question/attrs) 수식은 자기 질문 마스킹과 무관하게 평가돼, 아무것도
    // 보고 입력하지 않은 표에서 응답자의 진행을 오차단한다.
    const visibleTouched = [...existingCellIds].some((id) => !isEmptyCellValue(cellValues[id]));
    if (!visibleTouched) return { skipped: true, ok: true, sum: 0 };
    const fCtx = toMaskedFormulaCtx(evalOpts.ctx, evalOpts.ownQuestionId, existingCellIds);
    // 참조 항이 전부 빈 값이면(group/SUM 이 0으로 접기 전) skipped — 레거시 cellIds 모드의
    // "전부 빈 값이면 skipped" 와 동일 의미론.
    if (areAllFormulaRefsEmpty(constraint.leftExpr, evalOpts.ownQuestionId, fCtx)) {
      return { skipped: true, ok: true, sum: 0 };
    }
    const v = evaluateCellFormula(constraint.leftExpr, evalOpts.ownQuestionId, fCtx);
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
    const fCtx = toMaskedFormulaCtx(evalOpts.ctx, evalOpts.ownQuestionId, existingCellIds);
    // 좌변과 동일 의미론 — 기준값 수식의 참조가 전부 빈 값이면 skipped.
    if (areAllFormulaRefsEmpty(constraint.targetExpr, evalOpts.ownQuestionId, fCtx)) {
      return { skipped: true, ok: true, sum: left };
    }
    const v = evaluateCellFormula(constraint.targetExpr, evalOpts.ownQuestionId, fCtx);
    if (v === null) return { skipped: true, ok: true, sum: left };
    right = v;
  } else {
    right = constraint.target;
  }

  const ok = compareValues(left, right, constraint.operator, constraint.tolerance ?? 0);
  return { skipped: false, ok, sum: left, target: right };
}

/** 합계 제약이 「입력된 칸 수」 모드인가 — 좌변 수식(leftExpr)이 있으면 수식이 우선이다. */
export function isFilledCountConstraint(constraint: SumConstraint): boolean {
  return constraint.aggregate === 'count' && !constraint.leftExpr;
}

/**
 * 「입력된 칸 수」 제약 평가 — 선택한 칸 중 응답이 들어 있는 칸의 수를 기준값과 비교한다.
 *
 * 합계 모드와 다른 점은 **대상이 전부 비어도 건너뛰지 않는다**는 것이다. "이 칸들 중 하나는
 * 적어야 한다" 가 이 모드의 존재 이유라, 비었다고 넘어가면 규칙이 아무것도 막지 못한다.
 * 건너뛰는 경우는 화면에 대상 칸이 하나도 없을 때뿐이다(전부 숨었거나 비활성 — 채울 길이 없는
 * 규칙이 「다음」을 영영 막으면 안 된다).
 *
 * "입력됨" 은 필수 셀 판정과 같은 정본(isCellValuePresent)을 쓴다 — 공백만 있는 문자열·빈 배열은
 * 미입력, 숫자 0 은 입력이다. 기준값은 리터럴(target)만 본다.
 * @param existingCellIds 보이고 활성인 셀 id 집합 (합계 모드와 같은 필터)
 */
export function evaluateFilledCountConstraint(
  constraint: SumConstraint,
  cellValues: Record<string, unknown>,
  existingCellIds: Set<string>,
): { skipped: boolean; ok: boolean; count: number; filledIds: string[]; emptyIds: string[] } {
  const targetIds = constraint.cellIds.filter((id) => existingCellIds.has(id));
  if (targetIds.length === 0) {
    return { skipped: true, ok: true, count: 0, filledIds: [], emptyIds: [] };
  }
  const filledIds = targetIds.filter((id) => isCellValuePresent(cellValues[id]));
  const emptyIds = targetIds.filter((id) => !filledIds.includes(id));
  const ok = compareValues(filledIds.length, constraint.target, constraint.operator, 0);
  return { skipped: false, ok, count: filledIds.length, filledIds, emptyIds };
}

const FILLED_COUNT_PHRASES: Record<SumConstraint['operator'], (target: number) => string> = {
  eq: (n) => `정확히 ${n}칸을 입력해야 합니다`,
  ne: (n) => `입력한 칸이 ${n}칸이 아니어야 합니다`,
  gte: (n) => `${n}칸 이상 입력해야 합니다`,
  lte: (n) => `${n}칸까지만 입력할 수 있습니다`,
  gt: (n) => `${n}칸보다 많이 입력해야 합니다`,
  lt: (n) => `${n}칸보다 적게 입력해야 합니다`,
};

/** 저작자 문구에서 실제 숫자로 바뀌는 자리표시자 — 쓰지 않으면 문구는 종전 그대로다. */
export const MESSAGE_CURRENT_TOKEN = '{현재값}';
export const MESSAGE_TARGET_TOKEN = '{기준값}';

function formatMessageNumber(n: number): string {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 9 });
}

/**
 * 저작자 문구의 `{현재값}`·`{기준값}` 을 검증에 쓴 실제 숫자로 바꾼다. 숫자를 보일지는 문구를
 * 쓴 사람이 고른다 — 자리표시자가 없으면 값은 드러나지 않는다(기준값 미노출 원칙은 기본 문구와
 * 자리표시자 없는 문구에서 그대로다). 값을 구하지 못한 자리표시자는 그대로 둔다.
 */
export function fillMessageValues(
  message: string,
  values: { current?: number; target?: number },
): string {
  let out = message;
  if (values.current !== undefined) {
    out = out.replaceAll(MESSAGE_CURRENT_TOKEN, formatMessageNumber(values.current));
  }
  if (values.target !== undefined) {
    out = out.replaceAll(MESSAGE_TARGET_TOKEN, formatMessageNumber(values.target));
  }
  return out;
}

// 저작자 문구가 있으면 그대로, 없으면 기준과 현재 칸 수를 알려 준다(합계 문구와 같은 원칙).
function filledCountMessage(constraint: SumConstraint, count: number): string {
  const custom = constraint.errorMessage?.trim();
  if (custom) return fillMessageValues(custom, { current: count, target: constraint.target });
  return `선택된 칸 중 ${FILLED_COUNT_PHRASES[constraint.operator](constraint.target)} (현재 ${count}칸)`;
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
// 저작자가 문구를 직접 썼으면 그대로 보여 준다 — "(현재 24324)" 같은 꼬리는 달력 환산값처럼
// 응답자에게 의미 없는 수를 노출하고, 문구를 쓴 사람이 고를 방법이 없었다(셀 수식 검증과 동일).
// 기본 문구에만 현재 합을 붙인다 — 퍼센트 합계 100 맞추기처럼 합을 알아야 고칠 수 있어서다.
function sumConstraintMessage(
  constraint: SumConstraint,
  sum: number,
  targetValue: number | undefined,
): string {
  const custom = constraint.errorMessage?.trim();
  if (custom) {
    return fillMessageValues(custom, {
      current: sum,
      ...(targetValue !== undefined ? { target: targetValue } : {}),
    });
  }
  const subject = constraint.leftExpr ? '계산 값' : '선택된 셀 합계';
  const target = constraint.targetExpr ? '기준값' : String(constraint.target);
  return `${subject}가 ${target}${SUM_OPERATOR_PHRASES[constraint.operator]} (현재 ${sum})`;
}

/**
 * 질문 하나의 차단형 검증 위반 목록.
 * - 단답형(text + inputType 'number'): numberFormat.min 미달 (빈 값은 검증 안 함)
 * - table: 셀 min 미달, 합계 제약 위반, 필수 셀 미입력
 *   테이블 미접촉(응답 키 0개)이면 전부 스킵 — 미응답 차단은 question.required 소관.
 */
/**
 * 숫자 모드(textInputType='number')·형식 지정 옵션 텍스트의 위반 — 선택된 옵션의 비어있지 않은
 * 텍스트만 본다 (선택 해제된 옵션의 잔존 텍스트는 required-option-text-validation 과 같은
 * 이유로 신뢰하지 않는다). max·소수·허용값은 타이핑에서 차단되므로 여기서는 min 이 실질이다.
 */
function collectOptionTextIssues(
  question: Question,
  response: unknown,
  optionTexts: Record<string, string> | undefined,
  priorAnswers?: PriorAnswers | null,
): NumericIssue[] {
  if (!optionTexts) return [];
  const options = resolveChoiceOptions(question);
  const checkedOptions = options.filter(
    (o) =>
      o.allowTextInput === true && (o.textInputType === 'number' || isInputFormat(o.textInputType)),
  );
  if (checkedOptions.length === 0) return [];
  const selected = collectSelectedOptionIds(response, options);
  const issues: NumericIssue[] = [];
  for (const opt of checkedOptions) {
    if (!selected.has(opt.id)) continue;
    const raw = optionTexts[opt.id] ?? '';
    const text = raw.trim();
    if (!text) continue;
    // 형식 판정에는 원문을 넘긴다 — 이월 면제가 글자 그대로 비교라 trim 하면 어긋난다.
    const formatMessage = formatViolationMessage(
      opt.textInputType,
      raw,
      priorOptionText(priorAnswers, question.id, opt.id),
    );
    if (formatMessage) {
      issues.push({
        kind: 'format',
        message: formatMessage,
        detailTargetIds: [optionTextTargetId(question.id, opt.id)],
      });
      continue;
    }
    const message = rangeViolationMessage(text, opt.textInputNumberFormat);
    if (message) {
      issues.push({
        kind: 'range',
        message,
        detailTargetIds: [optionTextTargetId(question.id, opt.id)],
      });
    }
  }
  return issues;
}

/**
 * 보기-소스 표(choice_opt) 안에 놓인 단답형 셀의 차단형 검증 — 필수 미입력·범위 위반.
 *
 * 값이 `__optTexts__` 사이드카에 셀 id 로 저장돼 표 문항 경로(cellValues)를 타지 않으므로
 * 여기서 따로 본다. **행 표시조건으로 숨은 행의 셀은 보지 않는다** — 화면에 없는 칸이
 * "다음"을 막으면 응답자가 따를 수 있는 길이 없다 (게이팅 셀을 검증에서 빼는 것과 같은 이유).
 */
function collectChoiceTableInputCellIssues(
  question: Question,
  ctx: NumericValidationCtx | undefined,
): NumericIssue[] {
  if (question.type !== 'radio' && question.type !== 'checkbox') return [];
  if (!isChoiceTableSource(question)) return [];
  const texts = ctx?.optionTexts;
  const issues: NumericIssue[] = [];
  const missingTargets: string[] = [];

  // 렌더러(choice-table-response)와 **같은 투영**을 쓴다 — 조건으로 숨은 열의 셀은
  // 화면에 없으므로 검증 대상이 아니다. 행 조건만 보면 숨은 열에 남은 잔존값이
  // "고칠 입력칸이 없는 채로" 다음을 영구 차단한다.
  // 열 정의가 없는 표는 투영하지 않는다 — 보이는 열이 0개로 잡혀 셀이 통째로 사라지고
  // 필수 셀 검사까지 조용히 꺼진다(레거시 데이터 방어).
  const columns = question.tableColumns ?? [];
  const rows = question.tableRowsData ?? [];
  const visibleRows =
    columns.length === 0
      ? rows.filter(
          (row) =>
            !ctx ||
            !row.displayCondition ||
            shouldDisplayRow(row, ctx.allResponses, ctx.allQuestions, toBranchEvalCtx(ctx)),
        )
      : projectConditionalTableLayout({
          columns,
          rows,
          ...(question.tableHeaderGrid ? { headerGrid: question.tableHeaderGrid } : {}),
          ...(ctx ? { allResponses: ctx.allResponses, allQuestions: ctx.allQuestions } : {}),
          ...(ctx ? { evalCtx: toBranchEvalCtx(ctx) } : {}),
        }).rows;

  // 게이팅 — 미충족 셀은 화면에 컨트롤이 없으므로(choice-table-gated-cell) 검증하지 않는다.
  // 컨트롤러가 보기 옵션이면 선택된 보기 id 집합, 같은 표의 셀이면 사이드카 값으로 판정한다.
  const selection = collectSelectedChoiceCellIds(question, ctx?.allResponses[question.id]);
  const tableCells = collectTableCells(rows);
  const isGateOpen = (cell: TableCell) =>
    !cell.enabledWhen || isCellEnabled(cell, texts ?? {}, tableCells, selection);

  for (const row of visibleRows) {
    for (const cell of row.cells) {
      if (cell.isHidden) continue;
      if (!isGateOpen(cell)) continue;
      // 선택형 셀(radio/checkbox/select)도 같은 사이드카에 값을 넣는다 —
      // 필수 판정만 하고 숫자 범위 검사는 건너뛴다(입력이 아니라 선택이다).
      if (CHOICE_TABLE_CONTROL_CELL_TYPES.has(cell.type)) {
        if (isRequiredCell(cell) && isChoiceTableCellEmpty(texts?.[cell.id] ?? '', cell.type)) {
          missingTargets.push(optionTextTargetId(question.id, cell.id));
        }
        continue;
      }
      if (cell.type !== 'input') continue;
      const rawValue = texts?.[cell.id] ?? '';
      const value = rawValue.trim();
      if (isRequiredCell(cell) && value === '') {
        missingTargets.push(optionTextTargetId(question.id, cell.id));
        continue;
      }
      if (value === '') continue;
      // 형식 판정에는 원문을 넘긴다 — 이월 면제가 글자 그대로 비교다.
      const formatMessage = isTokenPrefilled(cell.defaultValueTemplate)
        ? null
        : formatViolationMessage(
            cell.inputType,
            rawValue,
            priorOptionText(ctx?.priorAnswers, question.id, cell.id),
          );
      if (formatMessage) {
        issues.push({
          kind: 'format',
          message: formatMessage,
          detailTargetIds: [optionTextTargetId(question.id, cell.id)],
        });
        continue;
      }
      const quality = resolveCellTextQualityViolation(
        cell,
        rawValue,
        priorOptionText(ctx?.priorAnswers, question.id, cell.id),
      );
      if (quality) {
        issues.push({
          kind: 'text-quality',
          message: quality.message,
          detailTargetIds: [optionTextTargetId(question.id, cell.id)],
        });
        continue;
      }
      if (cell.inputType !== 'number') continue;
      const message = rangeViolationMessage(value, cell.numberFormat);
      if (message) {
        issues.push({
          kind: 'range',
          message,
          detailTargetIds: [optionTextTargetId(question.id, cell.id)],
        });
      }
    }
  }

  if (missingTargets.length > 0) {
    issues.unshift({
      kind: 'required-detail',
      message: DEFAULT_REQUIRED_CELL_MESSAGE,
      detailTargetIds: missingTargets,
    });
  }
  return issues;
}

/**
 * 문항 하나의 응답 품질 위반 — 응답 화면(입력칸 아래 문구)과 차단 검증이 같은 판정을 쓴다.
 * 평문 모드 단답형·장문형만 대상이고, 토큰 prefill 칸(응답자가 못 고침)과 **손대지 않은
 * 이월 값**(형식 검사와 같은 면제, ADR 0023)은 보지 않는다.
 */
export function resolveTextQualityViolation(
  question: Question,
  value: unknown,
  priorAnswers?: PriorAnswers | null,
): TextQualityViolation | null {
  if (!question.textValidation || !isPlainTextInput(question)) return null;
  if (question.type === 'text' && isTokenPrefilled(question.defaultValueTemplate)) return null;
  if (
    typeof value === 'string' &&
    isUntouchedPriorValue(value, priorAnswerText(priorAnswers, question.id) ?? null)
  ) {
    return null;
  }
  return textQualityViolation(question.textValidation, value);
}

/**
 * 값 하나를 형식에 비추어 본다. 통과·빈 값이면 null.
 * 형식 검사는 값이 있는 칸만 본다 — 미입력 차단은 필수 판정 소관이다.
 *
 * `value` 는 **가공하지 않은 원문**을 넘긴다 — 이월 면제가 글자 그대로 비교이기 때문이다.
 * 앞뒤 공백을 미리 떼면 화면(훅)은 면제인데 검증은 아닌 상태가 되어, 손대지 않은 값에
 * 문구도 없이 막힌다.
 */
function formatViolationMessage(
  inputType: Question['inputType'] | undefined,
  value: unknown,
  priorOriginal?: string | null,
): string | null {
  if (!isInputFormat(inputType)) return null;
  if (typeof value !== 'string') return null;
  // 이월 원본 그대로면 면제 — 응답자가 치지도 않은 지난 회차 값이다.
  if (isUntouchedPriorValue(value, priorOriginal ?? null)) return null;
  const result = parseInputFormat(inputType, value);
  return result.ok ? null : formatFailureMessage(inputType, result.reason);
}

/**
 * 최대 선택 개수 초과 — 상한이 다른 문항 응답을 따라가는 비그룹 체크박스만 본다.
 *
 * 고정 상한은 선택 가드(꽉 차면 나머지 비활성)만으로 넘을 수 없지만, 따라가는 상한은 참조
 * 문항을 나중에 줄이면 이미 고른 것이 초과 상태로 남는다. 선택을 대신 지우지 않고 「다음」을
 * 막아 응답자가 뺄 것을 고르게 한다. 개수는 선택 가드와 같이 단독 선택 보기를 빼고 센다.
 */
function selectionMaxIssue(
  question: Question,
  response: unknown,
  ctx: NumericValidationCtx | undefined,
): NumericIssue | null {
  if (question.type !== 'checkbox' || !question.maxSelectionsSource?.questionId) return null;
  if (isGroupedChoiceQuestion(question) || !Array.isArray(response)) return null;
  const max = resolveMaxSelections(question, ctx?.allResponses);
  if (max === undefined) return null;
  const count = countSelectionsTowardMax(response, (val) => isExclusiveChoiceValue(question, val));
  if (count <= max) return null;
  return {
    kind: 'selection-max',
    message: `최대 ${max}개까지 선택할 수 있습니다. (현재 ${count}개 선택)`,
  };
}

export function collectNumericIssues(
  question: Question,
  response: unknown,
  ctx?: NumericValidationCtx,
): NumericIssue[] {
  if (question.type === 'text' && isInputFormat(question.inputType)) {
    if (isTokenPrefilled(question.defaultValueTemplate)) return [];
    const message = formatViolationMessage(
      question.inputType,
      response,
      priorAnswerText(ctx?.priorAnswers, question.id),
    );
    return message ? [{ kind: 'format', message }] : [];
  }

  if (question.type === 'text' && question.inputType === 'number') {
    if (typeof response !== 'string') return [];
    const message = rangeViolationMessage(response, question.numberFormat);
    return message ? [{ kind: 'range', message }] : [];
  }

  if (question.type !== 'table') {
    const issues: NumericIssue[] = [];
    const quality = resolveTextQualityViolation(question, response, ctx?.priorAnswers);
    if (quality) issues.push({ kind: 'text-quality', message: quality.message });
    const optionTextIssues = collectRequiredOptionTextIssues(question, response, ctx?.optionTexts);
    if (optionTextIssues.questionMissing) {
      issues.push({
        kind: 'required-detail',
        message: DEFAULT_REQUIRED_CELL_MESSAGE,
        detailTargetIds: optionTextIssues.detailTargetIds ?? [],
      });
    }
    issues.push(
      ...collectOptionTextIssues(question, response, ctx?.optionTexts, ctx?.priorAnswers),
    );
    issues.push(...collectChoiceTableInputCellIssues(question, ctx));
    const selectionMax = selectionMaxIssue(question, response, ctx);
    if (selectionMax) issues.push(selectionMax);
    return issues;
  }
  const cellValues =
    typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {};
  // 미접촉 판정은 실제 셀 값 키 기준 — __selectedRowIds/__optTexts__ 등 사이드카 키는 세지 않는다.
  // 숨은 셀 잔존값도 접촉으로 친다 — 열 전환으로 숨겨진 잔존값만 남아도 보이는 필수 셀
  // 차단은 유지돼야 한다 (아래 "보이는 열의 필수 셀" 테스트). 잔존값-only 표에서 외부 참조
  // 수식이 오차단하는 문제는 evaluateSumConstraint 의 보이는-셀 빈 값 가드가 막는다.
  // (emptyDefault 자동 채움이 있으면 셀 키가 생겨 검증 대상이 된다 — 의도됨, Q1 그릴링 확정)
  // 보기 그룹 표의 그룹 선택(`__choiceGroups`)은 예약 키지만 응답이다 — 보기만 고르고 입력 셀을
  // 비운 표에서 필수 셀 차단이 "미접촉" 으로 풀리면 안 된다.
  const hasAnyCellValue =
    Object.keys(cellValues).some((k) => !k.startsWith('__')) ||
    Object.keys(readTableChoiceGroups(cellValues)).length > 0;

  // 보기 그룹 표 — 고른 보기의 상세기재(숫자 모드·형식)는 레거시 보기 소스 표와 같은 규칙.
  // 선택은 표 응답 안 예약 키에 있어 그 맵을 응답으로 넘긴다.
  const groupOptionTextIssues = isChoiceGroupTableQuestion(question)
    ? collectOptionTextIssues(
        question,
        readTableChoiceGroups(cellValues),
        ctx?.optionTexts,
        ctx?.priorAnswers,
      )
    : [];

  const visible = collectVisibleTableCells(question, cellValues, ctx);
  // 게이팅 — 비활성 셀은 모든 차단형 검증에서 제외한다 (비활성 필수 셀이 "다음"을
  // 영구 차단하는 것 방지). isCellEnabled 는 같은 질문의 cellValues 만 본다.
  // 표 전체 셀을 함께 전달해야 option 조건의 {optionId} 래핑·id 저장 응답을 컨트롤러 셀
  // 정의로 정확히 해석한다 — 컨트롤러는 다른 행일 수 있다.
  const tableCells = collectTableCells(question.tableRowsData);
  // 보기 그룹 표의 choice-selected 컨트롤러는 표 응답 안 예약 키의 선택으로 판정한다.
  const choiceSelection = collectSelectedChoiceCellIds(question, cellValues);
  const enabled = visible.filter((c) => isCellEnabled(c, cellValues, tableCells, choiceSelection));
  const issues: NumericIssue[] = [...groupOptionTextIssues];

  const existingIds = new Set(enabled.map((c) => c.id));

  // 0) 입력된 칸 수 제약 — 미접촉 표에서도 평가한다. "이 칸들 중 N칸은 적어야 한다" 는 표를
  //    건드리지 않은 응답자에게도 걸려야 하므로 아래 미접촉 스킵 밖에 둔다. 모자라면 빈 칸을,
  //    넘치면 채운 칸을 짚는다.
  for (const constraint of question.sumConstraints ?? []) {
    if (!isFilledCountConstraint(constraint)) continue;
    const result = evaluateFilledCountConstraint(constraint, cellValues, existingIds);
    if (result.skipped || result.ok) continue;
    const highlightIds = result.count < constraint.target ? result.emptyIds : result.filledIds;
    issues.push({
      kind: 'sum',
      message: filledCountMessage(constraint, result.count),
      ...(highlightIds.length > 0 ? { cellIds: highlightIds } : {}),
    });
  }

  // 미접촉 표는 입력 기반 검증(1~4)만 스킵 — 계산 셀 비교 검증(5)은 표시값이
  // 존재하므로 항상 평가한다 (미응답 데이터 참조는 group/SUM 이 0으로 접어 표시되고,
  // 그 표시값이 기준 수식과 어긋나면 표를 통째로 건너뛴 것과 무관하게 차단돼야 한다).
  if (hasAnyCellValue) {
    const inputCells = enabled.filter((c) => c.type === 'input');

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

    // 1-2) 셀 입력 형식 위반 — 값이 있는 칸만 본다. 사유별 문구는 셀 아래에 붙으므로
    //      여기서는 어느 칸인지만 짚는다(범위 위반과 같은 모양).
    const formatViolations = inputCells.filter(
      (c) =>
        !isTokenPrefilled(c.defaultValueTemplate) &&
        formatViolationMessage(
          c.inputType,
          cellValues[c.id],
          priorAnswerText(ctx?.priorAnswers, question.id, c.id),
        ) !== null,
    );
    if (formatViolations.length > 0) {
      issues.push({
        kind: 'format',
        message: '입력 형식이 맞지 않은 칸이 있습니다',
        cellIds: formatViolations.map((c) => c.id),
      });
    }

    // 1-3) 셀 응답 품질 위반(최소 글자 수·의미 없는 입력) — 형식과 같은 모양으로 어느 칸인지만 짚는다.
    const qualityViolations = inputCells.filter(
      (c) =>
        resolveCellTextQualityViolation(
          c,
          cellValues[c.id],
          priorAnswerText(ctx?.priorAnswers, question.id, c.id),
        ) !== null,
    );
    if (qualityViolations.length > 0) {
      issues.push({
        kind: 'text-quality',
        message: '응답 조건(글자 수·내용)에 맞지 않는 칸이 있습니다',
        cellIds: qualityViolations.map((c) => c.id),
      });
    }

    // 2) 합계 제약 — 합산 대상은 "보이고 활성인 셀"로 한정 (미선택 동적 행 잔존 값·isHidden 셀·
    //    숨은 열/행·비활성 게이팅 셀 제외)
    for (const constraint of question.sumConstraints ?? []) {
      if (isFilledCountConstraint(constraint)) continue; // 위 0) 에서 평가했다
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
          message: sumConstraintMessage(constraint, result.sum, result.target),
          ...(highlightIds.length > 0 ? { cellIds: highlightIds } : {}),
        });
      }
    }

    // 3) 필수 셀 — "표시되고 활성일 때만 필수": isHidden 셀·미선택 동적 행의 셀·비활성 게이팅
    //    셀은 제외 (영구 차단 방지). 대상은 REQUIRED_CELL_TYPES(input/radio/checkbox/select/ranking).
    //    필수 판정은 (required || requiredWhenEnabled) 수렴식 — enabled 목록 위에서 검사하므로
    //    "&& 활성" 은 목록 필터로 이미 성립한다. 응답됨 판정은 isCellValuePresent 정본(배열
    //    length>0, 문자열 trim, 그 외 truthy) — checkbox/ranking 빈 배열을 미응답으로 본다.
    // 행 반복: 필수는 1벌만 본다. 2벌부터는 열어도 비워 둘 수 있어야 한다 —
    // 실수로 `+` 를 누른 응답자가 제출하지 못하는 상황을 막는다. 범위·합계 검증은
    // 값이 있을 때만 위반이 나므로 벌 수와 무관하게 그대로 둔다.
    const repeatOptionalCellIds = collectRepeatOptionalCellIds(question);
    // 행 차례로 열기: 「처음 보이는 행」과 「값이 있는 마지막 행」 뒤의 묶음 행은 필수에서 뺀다.
    // 행 반복과 달리 범위가 값에서 나온다 — 적기 시작한 행까지는 평범한 행으로 검사한다.
    const stagedOptional = stagedOptionalCellIds(
      question.tableRowsData,
      question.stagedRowsConfig,
      cellValues,
    );
    const ordinaryMissingCells = enabled.filter(
      (c) =>
        REQUIRED_CELL_TYPES.has(c.type) &&
        isRequiredCell(c) &&
        !repeatOptionalCellIds.has(c.id) &&
        !stagedOptional.has(c.id) &&
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
            fillMessageValues(cell.formulaErrorMessage?.trim() ?? '', {
              current: roundedInput,
              target: computed,
            }) || '입력하신 값이 앞서 입력한 값들의 계산 결과와 일치하지 않습니다.',
          cellIds: [cell.id],
        });
      }
    }
  }

  // 5) 계산 셀 비교 검증 — 표시된 계산값이 기준 수식을 만족해야 진행. fail-safe 계약은
  //    수식 검증과 동일: ctx 없음·계산/기준 평가 불능이면 통과. 미접촉 표라도 실행한다 —
  //    계산 셀은 표시값이 항상 존재하므로(group/SUM 의 빈 항 0 처리) 표를 건너뛴 것과
  //    무관하게 기준 위반을 잡아야 한다 (위 hasAnyCellValue 가드는 1~4 단계 전용).
  //    단, 기준값(target) 수식의 참조가 전부 빈 값이면 skipped — group 이 무응답을 0으로
  //    접어 "0과 비교"로 오차단하는 것을 방지한다. 계산 수식(cell.formula) 쪽에는 적용하지
  //    않는다 — 셀에 표시되는 값 자체가 비교 대상이라는 것이 이 검증의 의미이기 때문.
  for (const cell of enabled) {
    if (cell.type !== 'calc' || !cell.formula || !cell.calcValidation) continue;
    if (!ctx) continue;
    const fCtx = toFormulaCtx(ctx);
    const computed = evaluateCellFormula(
      cell.formula,
      question.id,
      fCtx,
      cell.numberFormat?.decimalPlaces,
    );
    if (computed === null) continue;
    if (areAllFormulaRefsEmpty(cell.calcValidation.target, question.id, fCtx)) continue;
    const target = evaluateCellFormula(
      cell.calcValidation.target,
      question.id,
      fCtx,
      cell.numberFormat?.decimalPlaces,
    );
    if (target === null) continue;
    const v = cell.calcValidation;
    if (!compareValues(computed, target, v.operator, v.tolerance ?? 0)) {
      issues.push({
        kind: 'formula',
        message:
          fillMessageValues(v.errorMessage?.trim() ?? '', { current: computed, target }) ||
          `계산 결과가 기준값${SUM_OPERATOR_PHRASES[v.operator]} (현재 ${computed})`,
        cellIds: [cell.id],
      });
    }
  }

  return issues;
}
