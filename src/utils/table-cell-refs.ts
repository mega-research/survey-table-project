/**
 * 표 셀이 품고 있는 **다른 셀 참조**를 새 id 로 옮긴다.
 *
 * 셀 id 를 새로 발번하는 경로(질문 복제, 행 반복 펼치기)는 참조를 함께 옮기지 않으면
 * 사본이 원본의 셀을 계속 가리킨다. 게이팅은 원본 컨트롤러를 보고 열리고 닫히며,
 * 검증 수식은 남의 칸 값으로 판정한다.
 *
 * **대응표에 없는 id 는 건드리지 않는다.** 복사 범위 밖을 가리키는 참조는 모든 사본이
 * 같은 바깥 셀에 매이는 것이 옳고, 다른 질문 참조(`questionId` 명시)도 그대로 둔다.
 * 죽은 참조를 지우는 일은 이 모듈 소관이 아니다 — 붙여넣기 경로의
 * `resolvePastedGating`/`pruneDeadGatingAfterPaste` 가 그 판정을 소유한다.
 */
import type { CalcExpr, TableCell } from '@/types/survey';

export function remapCalcExprCellIds(
  expr: CalcExpr,
  idMap: ReadonlyMap<string, string>,
): CalcExpr {
  switch (expr.kind) {
    case 'cell': {
      if (expr.questionId) return expr;
      const mapped = idMap.get(expr.cellId);
      return mapped ? { ...expr, cellId: mapped } : expr;
    }
    case 'agg': {
      const items = expr.items.map((item) => remapCalcExprCellIds(item, idMap));
      return items.every((item, i) => item === expr.items[i]) ? expr : { ...expr, items };
    }
    case 'group': {
      const terms = expr.terms.map((term) => remapCalcExprCellIds(term, idMap));
      return terms.every((term, i) => term === expr.terms[i]) ? expr : { ...expr, terms };
    }
    default:
      return expr;
  }
}

/** 셀 하나의 게이팅·수식 참조를 대응표로 옮긴다 (바뀔 것이 없으면 원본 참조 반환). */
export function remapCellRefs(
  cell: TableCell,
  idMap: ReadonlyMap<string, string>,
): TableCell {
  let next = cell;

  if (cell.enabledWhen) {
    const mapped = idMap.get(cell.enabledWhen.controllerCellId);
    if (mapped) {
      next = { ...next, enabledWhen: { ...cell.enabledWhen, controllerCellId: mapped } };
    }
  }

  if (cell.formula) {
    const formula = remapCalcExprCellIds(cell.formula, idMap);
    if (formula !== cell.formula) next = { ...next, formula };
  }

  if (cell.calcValidation) {
    const target = remapCalcExprCellIds(cell.calcValidation.target, idMap);
    if (target !== cell.calcValidation.target) {
      next = { ...next, calcValidation: { ...cell.calcValidation, target } };
    }
  }

  return next;
}
