import type { CellEnableCondition, Question, TableCell } from '@/types/survey';
import { parseNumericInput } from '@/utils/numeric-input';
import { resolveSelectedValues } from '@/utils/table-cell-semantics';

/**
 * 셀 게이팅 평가기 (CONTEXT.md "셀 게이팅").
 *
 * 응답 페이지·테스트 모드·차단형 검증·저장 strip 이 전부 이 모듈을 부른다 —
 * 판정이 갈리면 "화면에선 비활성인데 검증은 필수라 함"이 생기므로 복제 금지
 * (answer-quote / cell-formula 와 같은 규약). server-only 의존 금지.
 *
 * - 컨트롤러 미응답 = 미충족 = 비활성.
 * - 깨진 컨트롤러 참조(값 키 부재와 구분 불가)는 조건 평가 실패 = 비활성이 아니라,
 *   **컨트롤러 셀 자체가 표에 없을 때는 빌더 진단이 잡는다** — 런타임은 값만 본다.
 *   단 prefill 셀은 게이팅 무시(항상 활성) — 서버 prefill 강제 복원과 양립 불가라
 *   설정 자체가 금지이며, 외부 유입 데이터 방어다.
 * - 표시 조건(displayCondition)은 보지 않는다 — 값 기준 판정만.
 * - option 조건은 컨트롤러 셀의 실제 응답 형태(flat string | `{optionId}` 래핑 | 그 배열)를
 *   `table-cell-semantics.ts` 의 정본 규칙(resolveSelectedValues, 내부적으로 unwrapOptionId/
 *   findOptionByStored 사용)으로 옵션 value 로 해석한 뒤 condition.values 와 비교한다.
 *   컨트롤러 셀 정의(rowCells)를 못 구하면 raw 값을 문자열로만 취급하는 flat 비교로 폴백한다
 *   (예: 컨트롤러가 이미 value 그대로 저장하는 legacy/테스트 데이터).
 */

function toValueSet(raw: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v) out.add(v);
      return;
    }
    if (Array.isArray(v)) for (const item of v) walk(item);
    else if (v && typeof v === 'object') {
      for (const item of Object.values(v as Record<string, unknown>)) walk(item);
    }
  };
  walk(raw);
  return out;
}

function resolveOptionValueSet(
  condition: Extract<CellEnableCondition, { kind: 'option' }>,
  raw: unknown,
  rowCells: readonly TableCell[] | undefined,
): Set<string> {
  const controller = rowCells?.find((c) => c.id === condition.controllerCellId);
  if (!controller) return toValueSet(raw);
  return new Set(resolveSelectedValues(controller, raw));
}

function evaluate(
  condition: CellEnableCondition,
  cellValues: Record<string, unknown>,
  rowCells: readonly TableCell[] | undefined,
): boolean {
  const raw = cellValues[condition.controllerCellId];
  switch (condition.kind) {
    case 'option': {
      const selected = resolveOptionValueSet(condition, raw, rowCells);
      return condition.values.some((v) => selected.has(v));
    }
    case 'filled':
      return typeof raw === 'string' ? raw.trim().length > 0 : false;
    case 'numeric': {
      if (typeof raw !== 'string') return false;
      const n = parseNumericInput(raw);
      if (n === null) return false;
      switch (condition.op) {
        case '>': return n > condition.value;
        case '>=': return n >= condition.value;
        case '<': return n < condition.value;
        case '<=': return n <= condition.value;
        case '==': return n === condition.value;
        case '!=': return n !== condition.value;
      }
    }
  }
}

/**
 * 이 셀이 현재 입력 가능한가. cellValues = 그 질문의 응답 객체({ [cellId]: value }).
 * rowCells = 같은 행의 셀 목록(컨트롤러 셀 정의 탐색용, option 조건 전용). 생략 시 하위호환
 * flat 비교로 폴백한다 — 새 호출부는 항상 그 행의 row.cells 를 넘겨야 옵션 id/value 래핑을
 * 정확히 해석한다.
 */
export function isCellEnabled(
  cell: TableCell,
  cellValues: Record<string, unknown>,
  rowCells?: readonly TableCell[],
): boolean {
  if (!cell.enabledWhen) return true;
  // prefill 우선 — 게이팅 설정은 빌더에서 금지되지만 외부 유입 데이터를 방어한다
  if (cell.defaultValueTemplate?.trim()) return true;
  return evaluate(cell.enabledWhen, cellValues, rowCells);
}

/**
 * 저장 페이로드에서 비활성 셀 값을 제거한다 (스펙 그릴링 §저장 경계 보증).
 * useEffect 지움은 렌더 후 실행이라 컨트롤러 변경 직후 이탈하는 beacon 이
 * 지움 전 값을 실을 수 있다 — 저장 경계에서 한 번 더 보증한다.
 * calc 주입(withCalcValues)보다 먼저 불러야 수식이 지워진 값 기준으로 계산된다.
 */
export function stripDisabledCellValues(
  questions: Question[],
  payloadAnswers: Record<string, unknown>,
): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const q of questions) {
    const rows = q.tableRowsData ?? [];
    const hasGatedCell = rows.some((row) =>
      row.cells.some((c) => c.type === 'input' && c.enabledWhen && !c.isHidden),
    );
    if (!hasGatedCell) continue;

    const payload = payloadAnswers[q.id];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    const cellValues = payload as Record<string, unknown>;

    // 컨트롤러 옵션 id/value 래핑을 정확히 해석하려면 같은 행의 셀 목록(row.cells)이
    // 필요하다 — 행을 벗어나 통짜로 flatMap 하면 그 컨텍스트를 잃는다.
    const disabledIds: string[] = [];
    for (const row of rows) {
      for (const cell of row.cells) {
        if (cell.type !== 'input' || !cell.enabledWhen || cell.isHidden) continue;
        if (!(cell.id in cellValues)) continue;
        if (!isCellEnabled(cell, cellValues, row.cells)) disabledIds.push(cell.id);
      }
    }
    if (disabledIds.length === 0) continue;

    out ??= { ...payloadAnswers };
    const next = { ...cellValues };
    for (const id of disabledIds) delete next[id];
    out[q.id] = next;
  }
  return out ?? payloadAnswers;
}
