import type { Question, TableCell, TableRow } from '@/types/survey';
import { formatCellLabel } from '@/utils/cell-label';

/**
 * 셀 게이팅 저작 실수 진단 수집기 (스펙 5절 — cell-formula-diagnostics 패턴).
 *
 * 런타임(cell-gating.ts)은 값만 보고 판정하므로 저작 실수에 관대하다 — 깨진 컨트롤러
 * 참조는 활성으로 폴백하고, prefill 충돌은 게이팅을 무시한다. 저작자에게 알리는
 * 방어선은 이 모듈이다. 응답값 없이 셀 구조만 정적으로 순회한다 (isomorphic).
 *
 * 진단 5종:
 * - gating-broken-ref: 컨트롤러 셀이 설문에 없음 (red — 런타임은 활성 폴백)
 * - gating-cross-row-ref: 컨트롤러가 다른 행에 있음 (red — 같은 행 값만 평가되므로 영구 비활성)
 * - gating-self-ref: 자기 자신을 컨트롤러로 지정 (red)
 * - gating-cycle: 게이팅 체인 순환 (amber — 런타임은 안정: 양쪽 빈 값이면 양쪽 비활성)
 * - gating-prefill-conflict: prefill(defaultValueTemplate) 셀에 게이팅 설정 (amber — 게이팅 무시됨)
 */

export interface GatingDiagnostic {
  kind:
    | 'gating-broken-ref'
    | 'gating-cross-row-ref'
    | 'gating-self-ref'
    | 'gating-cycle'
    | 'gating-prefill-conflict';
  questionId: string;
  cellId: string;
  message: string;
}

function checkRow(question: Question, row: TableRow, out: GatingDiagnostic[]): void {
  const rowCellIds = new Set(row.cells.map((c) => c.id));
  const allCells = (question.tableRowsData ?? []).flatMap((r) => r.cells);
  const gated = row.cells.filter(
    (c): c is TableCell & { enabledWhen: NonNullable<TableCell['enabledWhen']> } =>
      c.enabledWhen !== undefined,
  );

  for (const cell of gated) {
    const label = formatCellLabel(cell);
    const controllerId = cell.enabledWhen.controllerCellId;

    if (controllerId === cell.id) {
      out.push({
        kind: 'gating-self-ref',
        questionId: question.id,
        cellId: cell.id,
        message: `활성 조건이 자기 자신을 컨트롤러로 참조합니다: ${label}. 조건을 다시 지정하세요.`,
      });
    } else if (!rowCellIds.has(controllerId)) {
      const elsewhere = allCells.find((c) => c.id === controllerId);
      if (elsewhere) {
        out.push({
          kind: 'gating-cross-row-ref',
          questionId: question.id,
          cellId: cell.id,
          message: `활성 조건 컨트롤러가 다른 행에 있습니다: ${label} → ${formatCellLabel(elsewhere)}. 같은 행 값만 평가되므로 이 셀은 항상 비활성이 됩니다.`,
        });
      } else {
        out.push({
          kind: 'gating-broken-ref',
          questionId: question.id,
          cellId: cell.id,
          message: `활성 조건이 존재하지 않는 셀을 참조합니다: ${label}. 게이팅이 무시되고 항상 활성으로 동작합니다.`,
        });
      }
    }

    if (cell.defaultValueTemplate && cell.defaultValueTemplate.trim().length > 0) {
      out.push({
        kind: 'gating-prefill-conflict',
        questionId: question.id,
        cellId: cell.id,
        message: `자동 입력(prefill) 셀에 활성 조건이 설정되어 있습니다: ${label}. prefill 이 우선되어 게이팅이 무시됩니다.`,
      });
    }
  }

  // 게이팅 체인 순환 — 행 내부 gated 셀 → 컨트롤러 간선의 사이클 (filled 상호 참조 등).
  // 자기 참조는 전용 진단(gating-self-ref)이 이미 잡으므로 간선에서 제외한다.
  const edges = new Map<string, string>();
  for (const cell of gated) {
    if (cell.enabledWhen.controllerCellId !== cell.id) {
      edges.set(cell.id, cell.enabledWhen.controllerCellId);
    }
  }
  const reported = new Set<string>();
  for (const start of edges.keys()) {
    if (reported.has(start)) continue;
    const path = new Set<string>();
    let node: string | undefined = start;
    while (node !== undefined && edges.has(node) && !path.has(node)) {
      path.add(node);
      node = edges.get(node);
    }
    if (node !== undefined && path.has(node)) {
      // node 부터 사이클 — 사이클 구성원 전체를 보고 1건으로 접는다
      for (const id of path) reported.add(id);
      const cell = row.cells.find((c) => c.id === node);
      out.push({
        kind: 'gating-cycle',
        questionId: question.id,
        cellId: node,
        message: `활성 조건이 서로를 순환 참조합니다: ${cell ? formatCellLabel(cell) : node.slice(0, 6)} 포함 ${path.size}개 셀. 모두 빈 값이면 함께 비활성으로 유지됩니다.`,
      });
    }
  }
}

/** 설문 전체의 게이팅 진단 수집 (경고 패널 전용) */
export function collectGatingDiagnostics(questions: Question[]): GatingDiagnostic[] {
  const out: GatingDiagnostic[] = [];
  for (const question of questions) {
    if (question.type !== 'table') continue;
    for (const row of question.tableRowsData ?? []) {
      checkRow(question, row, out);
    }
  }
  return out;
}
