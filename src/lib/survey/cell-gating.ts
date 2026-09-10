import { collectSelectedChoiceCellIds } from '@/lib/survey/choice-selection';
import { OPT_TEXTS_KEY } from '@/lib/survey/response-sidecars';
import type { CellEnableCondition, Question, TableCell, TableRow } from '@/types/survey';
import { parseNumericInput } from '@/utils/numeric-input';
import { resolveSelectedValues } from '@/utils/table-cell-semantics';

/**
 * 셀 게이팅 평가기 (CONTEXT.md "셀 게이팅").
 *
 * 컨트롤러는 **같은 표 안이면 어느 행이든** 된다(2026-09-10 — 처음엔 같은 행만이었다). 값은
 * 문항 단위 응답 객체에서 셀 id 로 찾으므로 행 경계가 원래 없고, 옵션 조건의 컨트롤러 정의
 * 탐색만 표 전체 셀로 넓혔다.
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
 *   컨트롤러 셀 정의(tableCells)를 못 구하면 raw 값을 문자열로만 취급하는 flat 비교로 폴백한다
 *   (예: 컨트롤러가 이미 value 그대로 저장하는 legacy/테스트 데이터).
 */

/**
 * 게이팅(enabledWhen) 설정 대상 셀 타입 SSOT — 인터랙티브 셀 전부.
 * 렌더 배선(interactive-cell)·저장 strip·빌더 모달 노출·직렬화가 모두 이 집합을 본다.
 * choice_opt/ranking_opt 는 응답이 질문 레벨에 저장돼 셀 값 게이팅 모델과 맞지 않아 제외.
 */
export const GATABLE_CELL_TYPES = new Set<TableCell['type']>([
  'input',
  'radio',
  'checkbox',
  'select',
  'ranking',
]);

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
  tableCells: readonly TableCell[] | undefined,
): Set<string> {
  const controller = tableCells?.find((c) => c.id === condition.controllerCellId);
  if (!controller) return toValueSet(raw);
  return new Set(resolveSelectedValues(controller, raw));
}

function evaluate(
  condition: CellEnableCondition,
  cellValues: Record<string, unknown>,
  tableCells: readonly TableCell[] | undefined,
  choiceSelection: ReadonlySet<string> | undefined,
): boolean {
  const raw = cellValues[condition.controllerCellId];
  switch (condition.kind) {
    case 'choice-selected':
      return choiceSelection?.has(condition.controllerCellId) === true;
    case 'option': {
      const selected = resolveOptionValueSet(condition, raw, tableCells);
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
 * 표의 모든 셀(행 순서). 컨트롤러 셀 정의 탐색용 — 컨트롤러는 같은 표 안이면 어느 행이든 된다.
 * 호출부마다 `rows.flatMap(r => r.cells)` 를 쓰지 말고 이것을 쓴다.
 */
export function collectTableCells(rows: readonly TableRow[] | null | undefined): TableCell[] {
  return (rows ?? []).flatMap((row) => row.cells);
}

/**
 * 이 셀이 현재 입력 가능한가. cellValues = 그 질문의 응답 객체({ [cellId]: value }).
 * tableCells = 컨트롤러 셀 정의 탐색용 셀 목록(option 조건 전용) — **표 전체 셀**을 넘긴다.
 * choiceSelection = 보기 소스 표에서 선택된 보기 id 집합(choice-selected 조건 전용).
 * (collectTableCells). 컨트롤러는 같은 행일 필요가 없다(2026-09-10 결정) — 값은 문항 단위
 * 응답 객체에서 id 로 찾으므로 행 경계가 없고, 정의 탐색만 표 전체면 된다. 생략 시 하위호환
 * flat 비교로 폴백한다.
 */
export function isCellEnabled(
  cell: TableCell,
  cellValues: Record<string, unknown>,
  tableCells?: readonly TableCell[],
  /** 보기 소스 표의 선택된 보기 id 집합(collectSelectedChoiceCellIds) — choice-selected 조건 전용. */
  choiceSelection?: ReadonlySet<string>,
): boolean {
  if (!cell.enabledWhen) return true;
  // prefill 우선 — 게이팅 설정은 빌더에서 금지되지만 외부 유입 데이터를 방어한다
  if (cell.defaultValueTemplate?.trim()) return true;
  return evaluate(cell.enabledWhen, cellValues, tableCells, choiceSelection);
}

/**
 * 보기 소스 표의 게이팅 셀 사이드카 정리 — 미충족 셀의 `__optTexts__[q.id][cell.id]` 를 뺀다.
 * 지울 것이 없으면 null. 보기 선택 자체는 건드리지 않는다(보기는 게이팅 대상이 아니다).
 */
function stripDisabledChoiceTableSidecar(
  q: Question,
  payloadAnswers: Record<string, unknown>,
  base: Record<string, unknown>,
): Record<string, unknown> | null {
  const sidecar = payloadAnswers[OPT_TEXTS_KEY];
  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) return null;
  const texts = (sidecar as Record<string, unknown>)[q.id];
  if (!texts || typeof texts !== 'object' || Array.isArray(texts)) return null;
  const textMap = texts as Record<string, unknown>;
  const selection = collectSelectedChoiceCellIds(q, payloadAnswers[q.id]);
  const tableCells = collectTableCells(q.tableRowsData);
  // 사이드카 값은 셀 값이 아니지만 filled·numeric 조건의 컨트롤러가 같은 표의 input 셀일 수
  // 있어 그 값 자리로 넘긴다.
  const next = { ...textMap };
  let changed = false;
  for (const cell of tableCells) {
    if (!GATABLE_CELL_TYPES.has(cell.type) || !cell.enabledWhen || cell.isHidden) continue;
    if (!Object.hasOwn(next, cell.id)) continue;
    if (!isCellEnabled(cell, next, tableCells, selection)) {
      delete next[cell.id];
      changed = true;
    }
  }
  if (!changed) return null;
  return {
    ...base,
    [OPT_TEXTS_KEY]: { ...(sidecar as Record<string, unknown>), [q.id]: next },
  };
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
      row.cells.some((c) => GATABLE_CELL_TYPES.has(c.type) && c.enabledWhen && !c.isHidden),
    );
    if (!hasGatedCell) continue;

    // 보기 소스 표(radio/checkbox 문항의 내장 표) — 게이팅 셀 값이 문항 응답이 아니라
    // `__optTexts__[q.id][cell.id]` 사이드카에 있고, 컨트롤러는 선택된 보기 id 집합이다.
    if (q.type === 'radio' || q.type === 'checkbox') {
      const stripped = stripDisabledChoiceTableSidecar(q, payloadAnswers, out ?? payloadAnswers);
      if (stripped) out = stripped;
      continue;
    }

    const payload = payloadAnswers[q.id];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    const cellValues = payload as Record<string, unknown>;

    // 컨트롤러 옵션 id/value 래핑 해석용 셀 정의는 표 전체에서 찾는다 — 컨트롤러가 다른 행에
    // 있을 수 있다.
    const tableCells = collectTableCells(rows);
    //
    // 게이팅 체인(A→B→C) 정리는 고정점 수렴으로 — 한 pass 는 상류 셀의 잔존 값으로
    // 하류를 활성으로 오판할 수 있다(B 가 지워지기 전 값으로 C 의 filled 조건이 참).
    // 지워진 상태 기준으로 제거가 더 없을 때까지 재평가한다. 매 반복이 키를 최소
    // 하나 지우므로 게이팅 셀 수 이내에 종료한다. (클라이언트는 useEffect 연쇄가
    // 렌더 사이클로 같은 일을 한다 — 서버 strip 은 일회 호출이라 여기서 수렴시킨다.)
    // own key 판정은 반드시 Object.hasOwn — `in` 은 프로토타입 체인까지 보므로
    // 셀 id 가 toString/constructor 같은 Object.prototype 프로퍼티명과 겹치면
    // delete 이후에도 계속 true 가 되어 고정점 루프가 영원히 돈다 (동기 루프라
    // 테스트 타임아웃조차 개입 못 하는 저장 경로 행). maxPasses 는 이중 안전벨트.
    const next = { ...cellValues };
    const gatedCellCount = rows.reduce(
      (n, row) =>
        n +
        row.cells.filter(
          (c) => GATABLE_CELL_TYPES.has(c.type) && c.enabledWhen && !c.isHidden,
        ).length,
      0,
    );
    let changed = false;
    let removedInPass = true;
    for (let pass = 0; pass <= gatedCellCount && removedInPass; pass++) {
      removedInPass = false;
      for (const row of rows) {
        for (const cell of row.cells) {
          if (!GATABLE_CELL_TYPES.has(cell.type) || !cell.enabledWhen || cell.isHidden) continue;
          if (!Object.hasOwn(next, cell.id)) continue;
          if (!isCellEnabled(cell, next, tableCells)) {
            delete next[cell.id];
            removedInPass = true;
            changed = true;
          }
        }
      }
    }
    if (!changed) continue;

    out ??= { ...payloadAnswers };
    out[q.id] = next;
  }
  return out ?? payloadAnswers;
}
