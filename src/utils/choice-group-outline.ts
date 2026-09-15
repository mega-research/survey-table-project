import type { TableRow } from '@/types/survey';

/** 셀의 어느 변에 표시선을 그릴지. */
export interface CellOutlineEdges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

/**
 * 표시 대상 셀들을 **그룹 덩어리**로 묶어 바깥 변만 낸다.
 *
 * 칸마다 사방 테두리를 두르면 다섯 칸짜리 척도가 다섯 개의 상자로 보여, 하나만 고르면
 * 되는 자리인지 다섯 개를 다 채워야 하는 자리인지 읽히지 않는다. 덩어리 하나로 두르면
 * "이 묶음에서 하나" 라는 것이 모양으로 드러난다.
 *
 * 묶는 단위는 **가로·세로로 맞닿은 같은 그룹 셀**이다. 가로 이웃은 그 행의 보이는 셀
 * 순서로, 세로 이웃은 authored 격자의 같은 열 자리(row.cells 인덱스)로 판정한다 —
 * 척도가 한 행에 눕는 표도, 열마다 하나씩 고르는 표(12월 기준 / 현재)처럼 그룹이 열
 * 방향으로 서는 표도 덩어리 하나로 보인다. 위아래 자리가 숨은 셀이면 이웃이 아니다.
 *
 * @param rows 표 행 목록 (숨은 셀·연속 셀은 이웃 판정에서 건너뛴다)
 * @param highlightCellIds 표시할 셀 id
 */
export function buildChoiceGroupOutline(
  rows: readonly TableRow[] | undefined,
  highlightCellIds: ReadonlySet<string>,
): Map<string, CellOutlineEdges> {
  const edges = new Map<string, CellOutlineEdges>();
  if (highlightCellIds.size === 0) return edges;

  const rowList = rows ?? [];
  for (let r = 0; r < rowList.length; r += 1) {
    const row = rowList[r];
    if (!row) continue;
    const cells = row.cells ?? [];
    // 숨은 셀은 그려지지 않으므로 이웃 판정에서도 없는 것으로 본다 — 그대로 두면
    // 보이지 않는 칸 때문에 덩어리가 끊겨 중간에 선이 생긴다.
    const visible = cells.filter((c) => !c.isHidden && !c._isContinuation);
    for (let i = 0; i < visible.length; i += 1) {
      const cell = visible[i];
      if (!cell || !highlightCellIds.has(cell.id)) continue;
      const sameRun = (other: TableRow['cells'][number] | undefined) =>
        Boolean(
          other &&
            !other.isHidden &&
            !other._isContinuation &&
            highlightCellIds.has(other.id) &&
            other.choiceGroupId !== undefined &&
            other.choiceGroupId === cell.choiceGroupId,
        );
      // 세로 이웃 — authored 격자에서 같은 열 자리의 위·아래 셀
      const col = cells.indexOf(cell);
      const above = rowList[r - 1]?.cells?.[col];
      const below = rowList[r + 1]?.cells?.[col];
      edges.set(cell.id, {
        top: !sameRun(above),
        bottom: !sameRun(below),
        left: !sameRun(visible[i - 1]),
        right: !sameRun(visible[i + 1]),
      });
    }
  }
  return edges;
}

/** 표시선 색 — 필수 미충족 안내의 빨강과 같은 계열. */
const OUTLINE_COLOR = '#ef4444';
const OUTLINE_WIDTH = '2px';

/**
 * 변 표시를 inset box-shadow 로 바꾼다. border 를 바꾸면 격자 두께가 달라져 표가
 * 흔들리므로, 레이아웃을 건드리지 않는 inset 그림자로 그린다.
 */
export function outlineBoxShadow(edges: CellOutlineEdges | undefined): string | undefined {
  if (!edges) return undefined;
  const parts: string[] = [];
  if (edges.top) parts.push(`inset 0 ${OUTLINE_WIDTH} 0 0 ${OUTLINE_COLOR}`);
  if (edges.right) parts.push(`inset -${OUTLINE_WIDTH} 0 0 0 ${OUTLINE_COLOR}`);
  if (edges.bottom) parts.push(`inset 0 -${OUTLINE_WIDTH} 0 0 ${OUTLINE_COLOR}`);
  if (edges.left) parts.push(`inset ${OUTLINE_WIDTH} 0 0 0 ${OUTLINE_COLOR}`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}
