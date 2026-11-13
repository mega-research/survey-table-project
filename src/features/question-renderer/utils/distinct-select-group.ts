/**
 * 중복 불가 묶음 — 같은 묶음 이름을 가진 표의 선택(select) 칸끼리는 같은 보기를 두 번 고를 수 없다.
 *
 * 화면의 회색 비활성과 차단형 검증이 이 모듈 하나의 판정을 쓴다 — 갈리면 "회색인데 검증은 통과"
 * 하거나 "고를 수 있었는데 다음에서 막힘"이 생긴다 (CONTEXT.md "중복 불가 묶음").
 *
 * ── 배선과 규칙 ──
 * - **중복 불가 묶음** (`cell.distinctGroup`, select 셀 전용, 2026-10-06): 같은 묶음 이름을 가진 선택 칸끼리는
 *   같은 보기를 두 번 고를 수 없다.
 * - 묶음은 열·행 배치와 무관하게 **이름으로만** 정해지고(셀 편집 모달의 「중복 불가 묶음 이름」 + 「같은 열의
 *   다른 선택 칸에도 적용」), 비교는 보기 값(`option.value ?? option.id`)이다 — 칸마다 보기 값이 다르면
 *   아무것도 막지 않으므로 모달이 경고한다(`survey-builder/lib/distinct-group-diagnostics`).
 * - 다른 칸이 고른 보기는 목록에 남되 `disabled` 다(순위형 드롭다운과 같은 얼굴 — 목록에서 빼지 않는다).
 * - 이미 들어온 중복은 `NumericIssue.kind: 'distinct'`(클라이언트 전용, 고정 문구, 관리자 수정에서도 완화하지
 *   않는다)가 막는다.
 * - 화면 비활성과 검증이 `features/question-renderer/utils/distinct-select-group.ts` 하나의 판정을 쓰고,
 *   게이팅으로 닫힌 칸·병합에 가려진 칸(`isHidden` — 병합 저장이 덮인 칸에 내용을 통째 복사한다)은 구성원에서
 *   뺀다.
 * - 행·열 표시 조건이나 동적 행 선택으로 지금 보이지 않는 칸도 뺀다(2026-10-12 — 숨은 칸의 값은 제출 때까지
 *   응답에 남아 있어, 세면 보이지 않는 칸이 보기를 차지하고 「다음」을 막는다).
 * - 범위는 화면과 검증이 같아야 한다: 검증은 `collectVisibleTableCells` 의 칸 id 를, 화면은
 *   `GatingTableCellsProvider` 의 `visibleCellIds`(응답자가 볼 수 있는 행의 칸 — 본문 격자의 행에 응답자가 고른
 *   동적 행을 더한 `selectionVisibleRows`. 데스크톱은 동적 행을 본문이 아니라 선택 줄 아래에 그려 본문 행
 *   목록에는 없다, 2026-11-12)를 판정 함수의 `visibleCellIds` 로 넘긴다.
 * - 게이팅 평가용 셀 정의(`tableCells`)는 좁히지 않는다.
 * - 「닫혔는가」는 셀 게이팅 평가기에 **보기 선택 집합까지 넘겨** 판정한다(`collectTableChoiceSelection` —
 *   빠뜨리면 choice-selected 로 열린 칸이 늘 닫힌 것으로 빠져 중복이 통과한다).
 * - 응답 화면은 묶음 구성원의 값과 그 게이팅이 읽는 키만 구독한다(`createKeyedValueSelector` +
 *   `gateSubscriptionKeys` — 컨트롤러의 컨트롤러·보기 선택 예약 키 포함).
 * - **테이블 유형 문항에서만 동작한다** — 보기·순위 문항의 내장 표(레거시 보기 소스 표)의 선택 칸은
 *   `ChoiceTableCellControl` 로 그려지고 값이 `__optTexts__` 사이드카에 있어 비활성도 검증도 걸리지 않는다.
 * - 셀 필드 정책(`utils/table-cell-field-policy.ts`)에 폼 소유·보관함 제외(표 위치에 종속)로 적혀 있고, 셀
 *   직렬화(`serialize-cell.ts`)는 폼 상태 · hydrate · select 조건부 spread 에서 다룬다.
 * - CONTEXT.md "중복 불가 묶음".
 */
import { gateSubscriptionKeys } from '@/features/question-renderer/cells/gate-value-selector';
import { isCellEnabled } from '@/lib/survey/cell-gating';
import { collectTableChoiceSelection } from '@/lib/survey/choice-selection';
import type { TableCell } from '@/types/survey';
import { findOptionByStored, unwrapOptionId } from '@/utils/table-cell-semantics';

/**
 * 이 칸의 묶음 이름 — 묶음 구성원이 아니면 null.
 * 선택 칸만 구성원이고, 병합에 가려진 칸은 뺀다(병합 저장이 덮인 칸에 내용을 통째 복사해
 * 이름까지 따라간다 — 보이지 않는 칸이 보기를 차지하면 안 된다).
 */
export function distinctGroupOf(cell: TableCell): string | null {
  if (cell.type !== 'select' || cell.isHidden) return null;
  const name = cell.distinctGroup?.trim();
  return name ? name : null;
}

/**
 * 이 칸이 지금 고른 보기 값 — 없거나, 게이팅으로 닫힌 칸이면 null.
 *
 * 「닫혔는가」는 셀 게이팅 평가기가 정한다. 보기 선택으로 열리는 칸(choice-selected)은 표 응답 안
 * 예약 키의 선택 집합이 있어야 판정된다 — 넘기지 않으면 그 조건이 늘 미충족이라, 실제로 열린 칸이
 * 닫힌 것으로 빠져 중복이 통과한다.
 */
function liveSelection(
  cell: TableCell,
  cellValues: Record<string, unknown>,
  tableCells: readonly TableCell[],
  choiceSelection: ReadonlySet<string>,
): string | null {
  const stored = unwrapOptionId(cellValues[cell.id]);
  if (!stored) return null;
  // 선택 칸이 목록에서 쓰는 키와 같아야 한다(`option.value ?? option.id`). 목록에 없는 낡은 값은
  // 고른 것으로 치지 않는다 — 화면에 보이지 않는 값이 보기를 차지하면 응답자가 풀 수 없다.
  const option = findOptionByStored(cell.selectOptions ?? [], stored);
  if (!option) return null;
  return isCellEnabled(cell, cellValues, tableCells, choiceSelection)
    ? (option.value ?? option.id)
    : null;
}

/**
 * 지금 화면에 보이는 칸인가. `visibleCellIds` 는 행·열 표시 조건과 동적 행 선택을 거쳐 남은 칸의
 * id 집합이다 — 숨은 칸의 값은 응답에 남아 있어(제출 때 지워진다) 구성원으로 세면 보이지 않는 칸이
 * 보기를 차지하고, 응답자는 풀 수 없는 중복에 막힌다. 집합을 주지 않으면 표 전체가 보이는 것으로
 * 본다(표시 조건을 모르는 호출자 — 종전 동작).
 *
 * `tableCells` 는 좁히지 않는다. 게이팅 평가는 숨은 행의 컨트롤러 정의도 찾아야 한다.
 */
function isVisibleMember(
  cell: TableCell,
  visibleCellIds: ReadonlySet<string> | undefined,
): boolean {
  return visibleCellIds === undefined || visibleCellIds.has(cell.id);
}

/** 같은 묶음의 다른 칸들 (자기 제외). 묶음 이름이 없으면 빈 목록. */
export function distinctGroupPeers(
  cell: TableCell,
  tableCells: readonly TableCell[],
  visibleCellIds?: ReadonlySet<string>,
): TableCell[] {
  const group = distinctGroupOf(cell);
  if (group === null) return [];
  return tableCells.filter(
    (other) =>
      other.id !== cell.id &&
      distinctGroupOf(other) === group &&
      isVisibleMember(other, visibleCellIds),
  );
}

/**
 * 이 칸의 목록에서 비활성으로 보일 보기 값 — 같은 묶음의 다른 칸이 고른 것.
 * 자기가 고른 보기는 들지 않는다(고른 값이 보이고 바꿀 수 있어야 한다).
 */
export function takenDistinctValues(
  cell: TableCell,
  tableCells: readonly TableCell[],
  cellValues: Record<string, unknown>,
  visibleCellIds?: ReadonlySet<string>,
): Set<string> {
  const taken = new Set<string>();
  const choiceSelection = collectTableChoiceSelection(cellValues);
  for (const peer of distinctGroupPeers(cell, tableCells, visibleCellIds)) {
    const selected = liveSelection(peer, cellValues, tableCells, choiceSelection);
    if (selected !== null) taken.add(selected);
  }
  return taken;
}

/** 같은 묶음에 같은 보기를 고른 칸이 둘 이상이면 그 칸 id 전부. */
export function findDistinctViolations(
  tableCells: readonly TableCell[],
  cellValues: Record<string, unknown>,
  visibleCellIds?: ReadonlySet<string>,
): string[] {
  const cellIdsByChoice = new Map<string, string[]>();
  const choiceSelection = collectTableChoiceSelection(cellValues);
  for (const cell of tableCells) {
    const group = distinctGroupOf(cell);
    if (group === null || !isVisibleMember(cell, visibleCellIds)) continue;
    const selected = liveSelection(cell, cellValues, tableCells, choiceSelection);
    if (selected === null) continue;
    const key = JSON.stringify([group, selected]);
    cellIdsByChoice.set(key, [...(cellIdsByChoice.get(key) ?? []), cell.id]);
  }
  return [...cellIdsByChoice.values()].filter((ids) => ids.length > 1).flat();
}

/**
 * 비활성 보기 계산이 읽는 응답 키 — 같은 묶음 다른 칸들의 값과, 그 칸들의 게이팅이 읽는 키 전부.
 * 게이팅 키는 셀 게이팅 구독과 같은 함수로 구한다(컨트롤러의 컨트롤러까지, 보기 선택 조건이면
 * 표 응답 안 예약 키) — 평가기가 보는 값과 구독하는 값이 어긋나면 상류가 바뀌어도 비활성 표시가
 * 따라오지 않는다. 묶음 구성원이 아니면 빈 목록.
 */
export function distinctSubscriptionKeys(
  cell: TableCell,
  tableCells: readonly TableCell[],
): string[] {
  const keys = new Set<string>();
  for (const peer of distinctGroupPeers(cell, tableCells)) {
    keys.add(peer.id);
    if (!peer.enabledWhen) continue;
    for (const key of gateSubscriptionKeys(peer.enabledWhen, tableCells)) keys.add(key);
  }
  return [...keys];
}
