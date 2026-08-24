import type { SumConstraint, TableRow } from '@/types/survey';

/**
 * 빌더 저장용 — 삭제된 셀을 가리키는 cellId 제거.
 *
 * 평가 시 무시(numeric-validation)와 별개의 이중 방어다. 평가는 응답 시점 관심사라
 * 응답 흐름이 갖고, 이 정리는 저장 시점 관심사라 빌더가 갖는다.
 */
export function pruneSumConstraints(
  constraints: SumConstraint[],
  rows: TableRow[],
): SumConstraint[] {
  const ids = new Set((rows ?? []).flatMap((row) => row.cells).map((cell) => cell.id));
  return constraints.map((c) => ({ ...c, cellIds: c.cellIds.filter((id) => ids.has(id)) }));
}
