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
 * 묶는 단위는 **한 행 안에서 연속한 같은 그룹 셀**이다. 그룹이 여러 행에 걸치면 행마다
 * 따로 덩어리가 생긴다 — 행을 건너뛰어 이어 그리려면 표 전체의 격자 좌표가 필요한데,
 * 실제 조사표에서 보기 그룹은 한 행 안에 놓인다.
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

  for (const row of rows ?? []) {
    // 숨은 셀은 그려지지 않으므로 이웃 판정에서도 없는 것으로 본다 — 그대로 두면
    // 보이지 않는 칸 때문에 덩어리가 끊겨 중간에 선이 생긴다.
    const visible = (row.cells ?? []).filter((c) => !c.isHidden && !c._isContinuation);
    for (let i = 0; i < visible.length; i += 1) {
      const cell = visible[i];
      if (!cell || !highlightCellIds.has(cell.id)) continue;
      const sameRun = (other: (typeof visible)[number] | undefined) =>
        Boolean(
          other &&
            highlightCellIds.has(other.id) &&
            other.choiceGroupId !== undefined &&
            other.choiceGroupId === cell.choiceGroupId,
        );
      edges.set(cell.id, {
        top: true,
        bottom: true,
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
