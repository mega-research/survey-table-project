import type { NumericComparison, TableCell, TableRow } from '@/types/survey';
import { emptyBranchEvalCtx, evaluateNumericComparisonV2, type BranchEvalCtx } from '@/utils/branch-eval';

/**
 * 테이블 셀 의미론 (table-cell-semantics) — 셀 응답값의 해석·판정 규칙의 단일 거처.
 *
 * branch-logic.ts 에 5벌 복제돼 있던 셀 값 해석 switch(검증 메인 / 검증 추가조건 /
 * 분기값 추출 / 표시조건 추가조건 / checkTableCellCondition)를 흡수한다.
 * 이 모듈이 소유하는 지식:
 *   - 응답값 이중 형태(string | { optionId } | 그 배열)의 언랩 규칙
 *   - optionId → 옵션 value 해석 (응답은 optionId 저장, 기대값은 value 저장)
 *   - input 값 정본화: String(raw).trim() 강제 변환
 *   - 셀 타입별 "응답됨" 판정과, 타입 불문 "값 존재" 판정(exclusive 전수 스캔)의 구분
 *   - numericComparison 의 적용 범위(input 셀 전용, expectedValues 보다 우선)
 *   - 비인터랙티브 셀 폴백(라벨 열 지정 시 행의 첫 인터랙티브 셀로 대체)
 *   - isHidden 셀 평가 정책 (isEvaluableCell 게이트 — 아래 참조)
 *
 * 검증 규칙 5종 수량자(exclusive-check 등)와 표시조건 checkType(any/all/none)의 어휘,
 * AND/OR/NOT 조건 그룹 조합, 비테이블 질문의 checkValueMatch 는 이 모듈 범위 밖이다.
 *
 * 에러 모드: 어떤 함수도 throw 하지 않는다. 형태 위반·stale optionId·옵션 목록 부재는
 * 전부 "불일치(false)" 또는 "빈 결과([] / null)" 로 수렴한다 (fail-closed).
 */

/**
 * 조건 평가에 참여하는 인터랙티브 셀 타입.
 * 비공개 — table-cell-code-generator.ts 의 동명 export(SPSS 변수 대상, ranking_opt/choice_opt
 * 포함)와 의미·멤버가 달라 auto-import 오선택을 막기 위해 모듈 내부에만 둔다.
 */
const INTERACTIVE_CELL_TYPES = ['checkbox', 'radio', 'select', 'input'] as const;

/**
 * 셀 매칭 기준. 모든 필드 생략 = "응답됨" 판정.
 *
 * - expectedValues: 옵션의 value 기준 (응답에 저장된 optionId 가 아님 — 변환은 이 모듈 책임).
 *   빈 배열은 미지정과 동일하게 취급한다.
 * - numericComparison: input 셀 전용. 지정 시 input 셀에서 expectedValues 보다 우선하며,
 *   input 이 아닌 셀은 expectedValues/응답됨 판정으로 폴백한다.
 *   검증 규칙(TableValidationRule) 경로는 타입 구조상 이 필드가 없어 전달 자체가 차단된다.
 * - ctx: numericComparison 의 lookup 우변 평가용. 미주입 시 빈 컨텍스트 → fail-safe 동작.
 */
export interface CellCriteria {
  expectedValues?: string[] | undefined;
  numericComparison?: NumericComparison | undefined;
  ctx?: BranchEvalCtx | undefined;
}

/**
 * 행 스캔 범위.
 *
 * - rowIds: 멤버십 필터로만 쓰인다. 순회·반환 순서는 항상 rows 배열 순서(테이블 순서)다.
 *   생략 = 모든 행. 존재하지 않는 id 는 무시된다.
 * - columnIndex: 생략 = 행의 모든 셀 검사. 범위 밖 인덱스는 그 행을 건너뛴다.
 * - fallbackToFirstInteractive: columnIndex 가 지정되고 그 셀이 비인터랙티브(text/image/video)면
 *   행의 첫 인터랙티브 셀로 대체. 기본 false — 검증 메인/exclusive 스캔만 켠다(현행 보존).
 */
export interface RowScanSpec {
  rowIds?: string[] | undefined;
  columnIndex?: number | undefined;
  fallbackToFirstInteractive?: boolean | undefined;
}

// ─── isHidden 평가 정책 ──────────────────────────────────────────────────────

/**
 * isHidden 셀 평가 게이트 — 이 모듈의 유일한 동작 전환점.
 *
 * isHidden 셀은 렌더되지 않아(interactive-table-response 의 isHidden return null) 응답이
 * 불가능하다. 행 완료 판정(table-row-completion)과 동일하게 평가에서도 제외해, colspan 병합
 * 등으로 숨겨진 셀의 잔존 응답값이 분기·검증 결과를 바꾸는 비대칭을 막는다.
 * 셀 후보 선정과 비인터랙티브 폴백 탐색이 모두 이 게이트를 통과한다.
 */
const isEvaluableCell = (cell: TableCell): boolean => !cell.isHidden;

// ─── 내부: criterion 정규화 ──────────────────────────────────────────────────

type CellCriterion =
  | { kind: 'answered' }
  | { kind: 'value-in'; expectedValues: string[] }
  | { kind: 'numeric'; comparison: NumericComparison; fallback: CellCriterion; ctx?: BranchEvalCtx };

/**
 * 호출자의 평면 criteria 를 내부 criterion 으로 정규화하는 정본 규칙.
 * 우선순위: numericComparison > 비어있지 않은 expectedValues > 응답됨.
 */
function criterionFrom(criteria?: CellCriteria): CellCriterion {
  const valueCriterion: CellCriterion =
    criteria?.expectedValues && criteria.expectedValues.length > 0
      ? { kind: 'value-in', expectedValues: criteria.expectedValues }
      : { kind: 'answered' };
  if (criteria?.numericComparison) {
    return {
      kind: 'numeric',
      comparison: criteria.numericComparison,
      fallback: valueCriterion,
      ...(criteria.ctx ? { ctx: criteria.ctx } : {}),
    };
  }
  return valueCriterion;
}

// ─── 내부: 셀 타입별 의미론 registry ─────────────────────────────────────────

/**
 * 응답값에서 optionId 를 언랩 — string | { optionId } 두 형태만 인정, 그 외 null.
 *
 * 표 radio/select 셀 응답의 정본 언랩 규칙(SSOT). SPSS 데이터 변환기
 * (lib/spss/data-transformer.ts)도 이 함수를 재사용해 저장 형태와 동기화를 유지한다.
 */
export function unwrapOptionId(value: unknown): string | null {
  if (typeof value === 'object' && value !== null && 'optionId' in value) {
    return (value as { optionId: string }).optionId;
  }
  return typeof value === 'string' ? value : null;
}

/** 셀 타입별 옵션 목록 (checkbox/radio/select 외 null) */
function optionsOf(cell: TableCell): Array<{ id: string; value: string }> | null {
  switch (cell.type) {
    case 'checkbox':
      return cell.checkboxOptions ?? null;
    case 'radio':
      return cell.radioOptions ?? null;
    case 'select':
      return cell.selectOptions ?? null;
    default:
      return null;
  }
}

interface CellTypeSemantics {
  /** 셀 타입 인지 "응답됨" 판정 (expectedValues 미지정 경로의 정본) */
  isAnswered(cell: TableCell, raw: unknown): boolean;
  /** 해석된 선택값 전부 — 매칭용. 해석 불능 항목은 조용히 탈락 */
  selectedValues(cell: TableCell, raw: unknown): string[];
  /**
   * 대표 선택값 1개 — 분기값 추출(targetQuestionMap)용.
   * checkbox 는 "첫 번째 체크 optionId" 를 해석하며, 그것이 stale 이면 두 번째가
   * 유효해도 null 이다 (현행 동작 보존 — characterization 핀 참조).
   */
  representativeValue(cell: TableCell, raw: unknown): string | null;
  /** numericComparison 적용 가능 여부 (현재 input 만 true) */
  supportsNumeric: boolean;
}

/**
 * 저장값으로 옵션 역참조. 인터랙티브 셀(radio/select/checkbox-cell.tsx)은 응답값으로
 * flat string `option.value ?? option.id` 를 저장하므로 id 와 value 둘 다로 찾는다.
 * (id 매칭은 value 미지정 옵션 및 legacy { optionId } 저장 호환용 —
 * branch-logic getBranchRuleForTable 의 matchesOption 과 동일 정책.)
 */
function findOptionByStored(
  options: ReadonlyArray<{ id: string; value?: string }>,
  stored: string,
): { id: string; value?: string } | undefined {
  return options.find((opt) => opt.id === stored || (opt.value != null && opt.value === stored));
}

const checkboxSemantics: CellTypeSemantics = {
  isAnswered: (_cell, raw) => Array.isArray(raw) && raw.length > 0,
  selectedValues: (cell, raw) => {
    if (!Array.isArray(raw)) return [];
    const options = optionsOf(cell);
    if (!options) return [];
    const ids = raw.map(unwrapOptionId).filter((id): id is string => id !== null);
    return ids
      .map((id) => findOptionByStored(options, id)?.value)
      .filter((v): v is string => v !== undefined);
  },
  representativeValue: (cell, raw) => {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const options = optionsOf(cell);
    if (!options) return null;
    const ids = raw.map(unwrapOptionId).filter((id): id is string => id !== null);
    if (ids.length === 0) return null;
    return findOptionByStored(options, ids[0]!)?.value ?? null;
  },
  supportsNumeric: false,
};

const singleSelectSemantics: CellTypeSemantics = {
  isAnswered: (_cell, raw) => Boolean(raw),
  selectedValues: (cell, raw) => {
    const options = optionsOf(cell);
    const id = unwrapOptionId(raw);
    if (!options || id === null) return [];
    const value = findOptionByStored(options, id)?.value;
    return value !== undefined ? [value] : [];
  },
  representativeValue: (cell, raw) => {
    const options = optionsOf(cell);
    const id = unwrapOptionId(raw);
    if (!options || id === null) return null;
    return findOptionByStored(options, id)?.value ?? null;
  },
  supportsNumeric: false,
};

const inputSemantics: CellTypeSemantics = {
  isAnswered: (_cell, raw) => Boolean(raw) && String(raw).trim() !== '',
  selectedValues: (_cell, raw) => {
    const trimmed = String(raw).trim();
    return trimmed !== '' ? [trimmed] : [];
  },
  representativeValue: (_cell, raw) => {
    const trimmed = String(raw).trim();
    return trimmed !== '' ? trimmed : null;
  },
  supportsNumeric: true,
};

const SEMANTICS: Partial<Record<TableCell['type'], CellTypeSemantics>> = {
  checkbox: checkboxSemantics,
  radio: singleSelectSemantics,
  select: singleSelectSemantics,
  input: inputSemantics,
};

// ─── 단일 셀 의미론 (공개) ───────────────────────────────────────────────────

/**
 * 셀 응답값 존재 판정 — 셀 타입 불문. exclusive-check 전수 스캔의 정본.
 * 배열 = length > 0, 문자열 = trim 후 비어있지 않음, 그 외 = truthy.
 * (table-row-completion 의 isCellAnswered 와 빈 배열·공백 엣지 의미가 다르다 — 통합 금지.)
 */
export function isCellValuePresent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return Boolean(value);
}

/**
 * 해석된 선택값 전부 — optionId 를 옵션 value 로 언랩한 string 배열.
 * checkbox: 체크 순서대로 0~N개 / radio·select: 0~1개 / input: trim 값 0~1개 / 그 외: [].
 */
export function resolveSelectedValues(cell: TableCell, value: unknown): string[] {
  if (!value) return [];
  return SEMANTICS[cell.type]?.selectedValues(cell, value) ?? [];
}

/**
 * 셀의 대표 선택값 1개 — 분기값 추출(targetQuestionMap) 어휘.
 * checkbox 는 첫 번째 체크 optionId 만 해석한다(stale 이면 null — 현행 동작 보존).
 */
export function resolveSelectedValue(cell: TableCell, value: unknown): string | null {
  if (!value) return null;
  return SEMANTICS[cell.type]?.representativeValue(cell, value) ?? null;
}

/**
 * 셀이 기준과 매칭되는가. criteria 생략 = "인터랙티브 셀이 응답됨".
 *
 * - checkbox/radio/select/input 외의 셀 타입은 criteria 와 무관하게 항상 false.
 *   (타입 불문 존재 판정이 필요하면 isCellValuePresent — 두 디폴트는 다른 함수다.)
 * - 미응답(falsy 응답값)은 항상 false.
 */
export function matchCell(cell: TableCell, value: unknown, criteria?: CellCriteria): boolean {
  return matchCellCriterion(cell, value, criterionFrom(criteria));
}

function matchCellCriterion(cell: TableCell, value: unknown, criterion: CellCriterion): boolean {
  if (!value) return false;
  const semantics = SEMANTICS[cell.type];
  if (!semantics) return false;

  switch (criterion.kind) {
    case 'answered':
      return semantics.isAnswered(cell, value);
    case 'value-in':
      return semantics
        .selectedValues(cell, value)
        .some((v) => criterion.expectedValues.includes(v));
    case 'numeric': {
      if (!semantics.supportsNumeric) {
        return matchCellCriterion(cell, value, criterion.fallback);
      }
      const trimmed = String(value).trim();
      if (trimmed === '') return false;
      return evaluateNumericComparisonV2(
        criterion.comparison,
        trimmed,
        criterion.ctx ?? emptyBranchEvalCtx(),
      ).satisfied;
    }
  }
}

// ─── 행 스캔 (공개) ──────────────────────────────────────────────────────────

/** 스캔 명세에 따라 행에서 검사할 셀 후보를 고른다 (비인터랙티브 폴백·isHidden 게이트 포함) */
function candidateCells(row: TableRow, spec: RowScanSpec): TableCell[] {
  let cells: Array<TableCell | undefined>;
  if (spec.columnIndex !== undefined) {
    const target = row.cells[spec.columnIndex];
    if (
      spec.fallbackToFirstInteractive &&
      target &&
      ['text', 'image', 'video'].includes(target.type)
    ) {
      // 라벨 열을 지정한 사용자 의도는 그 행의 첫 입력 셀 — 첫 인터랙티브 셀로 대체
      const firstInteractive = row.cells.find(
        (c) =>
          (INTERACTIVE_CELL_TYPES as readonly string[]).includes(c.type) && isEvaluableCell(c),
      );
      cells = [firstInteractive ?? target];
    } else {
      cells = [target];
    }
  } else {
    cells = row.cells;
  }
  return cells.filter((c): c is TableCell => c !== undefined && isEvaluableCell(c));
}

/**
 * 기준과 매칭되는 셀이 하나 이상 있는 행들의 id 수집.
 * 행당 최대 1회 수집, rows 배열 순서, 중복 없음.
 */
export function collectMatchedRows(
  rows: TableRow[],
  response: Record<string, unknown>,
  spec: RowScanSpec & { criteria?: CellCriteria } = {},
): string[] {
  const criterion = criterionFrom(spec.criteria);
  const matched: string[] = [];
  for (const row of rows) {
    if (spec.rowIds && !spec.rowIds.includes(row.id)) continue;
    for (const cell of candidateCells(row, spec)) {
      if (matchCellCriterion(cell, response[cell.id], criterion)) {
        matched.push(row.id);
        break;
      }
    }
  }
  return matched;
}

/** collectMatchedRows(...).length > 0 의 단락 평가 버전 — 추가조건(같은 행 any-of)의 지름길 */
export function someRowMatches(
  rows: TableRow[],
  response: Record<string, unknown>,
  spec: RowScanSpec & { criteria?: CellCriteria } = {},
): boolean {
  const criterion = criterionFrom(spec.criteria);
  for (const row of rows) {
    if (spec.rowIds && !spec.rowIds.includes(row.id)) continue;
    for (const cell of candidateCells(row, spec)) {
      if (matchCellCriterion(cell, response[cell.id], criterion)) return true;
    }
  }
  return false;
}

/**
 * 셀 타입 불문 값이 존재하는 행 수집 — exclusive-check 전수 스캔 전용.
 * matchCell 의 인터랙티브 타입 게이트가 아니라 isCellValuePresent 판정을 쓴다.
 */
export function collectAnsweredRows(
  rows: TableRow[],
  response: Record<string, unknown>,
  spec: RowScanSpec = {},
): string[] {
  const answered: string[] = [];
  for (const row of rows) {
    if (spec.rowIds && !spec.rowIds.includes(row.id)) continue;
    for (const cell of candidateCells(row, spec)) {
      if (isCellValuePresent(response[cell.id])) {
        answered.push(row.id);
        break;
      }
    }
  }
  return answered;
}

/**
 * 행 순서대로 대표 선택값을 수집 — 분기값 추출(targetQuestionMap) 전용.
 * 값이 추출되지 않는 행(미응답·stale·비인터랙티브)은 결과에서 빠진다.
 */
export function collectSelectedValues(
  rows: TableRow[],
  response: Record<string, unknown>,
  spec: RowScanSpec = {},
): string[] {
  const values: string[] = [];
  for (const row of rows) {
    if (spec.rowIds && !spec.rowIds.includes(row.id)) continue;
    for (const cell of candidateCells(row, spec)) {
      const value = resolveSelectedValue(cell, response[cell.id]);
      if (value !== null) {
        values.push(value);
        break;
      }
    }
  }
  return values;
}

/**
 * 행 매칭 결과의 수량 판정 — 표시조건 checkType(any/all/none)의 정본.
 * 검증 규칙은 any-of→any, all-of/required-combination→all, none-of→none 으로 매핑해 쓰고,
 * exclusive-check 는 검증 고유 로직으로 호출자에 남는다.
 *
 * 계약: matchedRowIds 는 같은 rows/spec 으로 얻은 collect* 결과여야 한다.
 */
export function quantifyRows(
  matchedRowIds: string[],
  targetRowIds: string[],
  mode: 'any' | 'all' | 'none',
): boolean {
  switch (mode) {
    case 'any':
      return matchedRowIds.length > 0;
    case 'all':
      return targetRowIds.every((id) => matchedRowIds.includes(id));
    case 'none':
      return matchedRowIds.length === 0;
    default:
      return false;
  }
}
