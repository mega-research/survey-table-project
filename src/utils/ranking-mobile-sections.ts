import type { TableCell, TableRow } from '@/types/survey';
import { findMobileHeaderCell } from '@/utils/mobile-display-cells';
import { buildTableRowspanCoverage } from '@/utils/table-rowspan-coverage';

export interface RankingMobileSectionItem {
  row: TableRow;
  optCell: TableCell;
  /** 행의 첫 보기 — 행의 표시 셀(바로표시·자세히)은 이 카드에만 붙인다 */
  isFirstInRow: boolean;
}

export interface RankingMobileSection {
  /** 구간 제목 — 행(또는 그 행을 rowspan 으로 덮는 셀) 중 「헤더」로 지정한 text 셀. 없으면 제목 없는 구간 */
  headerCell: TableCell | undefined;
  items: RankingMobileSectionItem[];
}

/**
 * 표 소스 순위형의 모바일 카드 목록을 구간으로 나눈다.
 *
 * 데스크톱 표에서는 첫 열 분류 셀이 rowspan 으로 여러 행을 덮어 소속이 보이지만, 카드 목록은
 * 보기만 나열해 소속 분류가 사라진다. 「헤더」로 지정한 text 셀을 구간 제목으로 올리고, 그 셀이
 * rowspan 으로 덮는 행의 보기까지 한 구간에 넣는다(rowspan 해석은 `buildTableRowspanCoverage`).
 * 헤더 셀이 같은 연속 행은 한 구간이고, 헤더가 없는 연속 행은 제목 없는 구간 하나다.
 *
 * 체크박스 표의 카드가 헤더 셀을 **카드 제목**으로 쓰는 것과 다르다 — 순위형 카드는 보기 자체가
 * 제목이라 헤더 셀이 들어갈 자리가 구간 제목뿐이다.
 */
export function buildRankingMobileSections(rows: TableRow[]): RankingMobileSection[] {
  const coverage = buildTableRowspanCoverage(rows);
  const sections: RankingMobileSection[] = [];

  for (const row of rows) {
    const optCells = row.cells.filter(
      (cell) => cell.type === 'ranking_opt' && !cell.isHidden && !cell._isContinuation,
    );
    if (optCells.length === 0) continue;

    const covered = (coverage.get(row.id) ?? row.cells).filter(
      (cell): cell is TableCell => cell !== undefined,
    );
    const headerCell = findMobileHeaderCell(covered);

    const last = sections[sections.length - 1];
    const continuesLast =
      last !== undefined &&
      (last.headerCell === undefined
        ? headerCell === undefined
        : last.headerCell.id === headerCell?.id);
    let section: RankingMobileSection;
    if (continuesLast) {
      section = last;
    } else {
      section = { headerCell, items: [] };
      sections.push(section);
    }
    optCells.forEach((optCell, idx) => {
      section.items.push({ row, optCell, isFirstInRow: idx === 0 });
    });
  }

  return sections;
}
