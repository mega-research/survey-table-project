import type { CellEnableCondition, Question, TableCell } from '@/types/survey';
import { parseNumericInput } from '@/utils/numeric-input';

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

function evaluate(condition: CellEnableCondition, cellValues: Record<string, unknown>): boolean {
  const raw = cellValues[condition.controllerCellId];
  switch (condition.kind) {
    case 'option': {
      const selected = toValueSet(raw);
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

/** 이 셀이 현재 입력 가능한가. cellValues = 그 질문의 응답 객체({ [cellId]: value }). */
export function isCellEnabled(cell: TableCell, cellValues: Record<string, unknown>): boolean {
  if (!cell.enabledWhen) return true;
  // prefill 우선 — 게이팅 설정은 빌더에서 금지되지만 외부 유입 데이터를 방어한다
  if (cell.defaultValueTemplate?.trim()) return true;
  return evaluate(cell.enabledWhen, cellValues);
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
    const gatedCells = (q.tableRowsData ?? [])
      .flatMap((row) => row.cells)
      .filter((c) => c.type === 'input' && c.enabledWhen && !c.isHidden);
    if (gatedCells.length === 0) continue;

    const payload = payloadAnswers[q.id];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    const cellValues = payload as Record<string, unknown>;

    const disabledIds = gatedCells
      .filter((c) => !isCellEnabled(c, cellValues) && c.id in cellValues)
      .map((c) => c.id);
    if (disabledIds.length === 0) continue;

    out ??= { ...payloadAnswers };
    const next = { ...cellValues };
    for (const id of disabledIds) delete next[id];
    out[q.id] = next;
  }
  return out ?? payloadAnswers;
}
