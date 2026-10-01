/**
 * 「항목 단위 카드」 투영 (CONTEXT.md "항목 단위 카드") — 한 행에 "라벨 + 입력" 쌍이 여럿 놓인
 * 양식형 표를 모바일에서 **라벨(항목)마다 카드 하나**로 세운다. 행 단위 카드는 그런 표에서 서로
 * 다른 항목을 한 카드에 섞고(설립연도 + 기획/개발 시점), 세로 병합된 입력 칸을 병합이 시작된
 * 행에만 붙여 아래 행 카드를 반쪽으로 만든다.
 *
 * 규칙은 행을 왼쪽에서 오른쪽으로 한 번 훑는 것 하나다.
 * - 글자 셀(내용 있음)은 **라벨**이다. 입력 칸이 나오기 전까지 이어진 라벨은 제목 경로로 쌓인다
 *   (「(4) 인공지능 시작연도」 → 「(4-1) 기획/개발 시점」). 입력 칸 뒤에 라벨이 오면 새 항목이다.
 * - 위 행에서 세로 병합으로 내려온 라벨도 경로에 든다 — 아래 행 카드가 상위 제목을 잃지 않는다.
 *   내려온 것이 **입력 칸**이면 그 항목은 병합이 시작된 행의 것이라, 쌓인 경로를 버린다
 *   (「(3) 설립연도」가 아래 행 카드 제목에 따라붙지 않는다).
 * - 라벨이 아닌 글자 셀은 저작자가 모바일 표시 설정으로 정한다: 「숨김」은 무시, 「바로 표시」·
 *   「접기」는 카드 본문에 붙는 설명이다(열린 카드가 있으면 거기, 없으면 다음 카드). 단위·주석처럼
 *   입력 칸 뒤에 오는 글자를 새 카드로 오인하지 않게 하는 유일한 손잡이다 — 자동 추정은 없다.
 * - 라벨 없이 입력 칸만 있는 행은 행 이름을 제목으로 쓴다(격자형 표는 행 카드와 같은 모양이 된다).
 *
 * 표시 조건·동적 행은 호스트가 displayRows 로 이미 걸러 넘긴다. 응답값·검증·내보내기는 무변경 —
 * 표시만 바뀐다.
 */

import type { TableCell, TableRow } from '@/types/survey';

import { buildTableRowspanCoverage } from './table-rowspan-coverage';

export interface ItemCardInput {
  cell: TableCell;
  /** 게이팅·라디오 그룹 판정용 — 이 칸이 놓인 행 */
  row: TableRow;
}

export interface ItemCard {
  /** 안정 키 — 첫 입력 칸 id (행 안에서 카드가 여럿이라 행 id 로는 모자란다) */
  key: string;
  /** 오류 위치 이동·테스트용 — 카드가 속한 행 */
  rowId: string;
  /** 제목 경로(상위 → 하위). 비면 fallbackTitle 을 쓴다 */
  titleCells: TableCell[];
  /** 라벨이 없는 행의 제목 — 행 이름 */
  fallbackTitle: string;
  inputs: ItemCardInput[];
  /** 「바로 표시」·「접기」 글자·이미지·영상 셀 */
  displayCells: TableCell[];
}

const DISPLAY_TYPES = new Set<TableCell['type']>(['text', 'image', 'video']);

function isAttachedDisplay(cell: TableCell): boolean {
  return cell.mobileDisplay === 'inline' || cell.mobileDisplay === 'collapsed';
}

/** 옵션 1개짜리 라디오는 입력이 아니라 라벨이다 (행 카드와 같은 규칙) */
function labelOnlyRadioText(cell: TableCell): string | null {
  if (cell.type !== 'radio' || (cell.radioOptions?.length ?? 0) !== 1) return null;
  return cell.radioOptions?.[0]?.label?.trim() || null;
}

function isLabelCell(cell: TableCell): boolean {
  if (labelOnlyRadioText(cell)) return true;
  return (
    cell.type === 'text' &&
    (cell.content ?? '').trim() !== '' &&
    cell.mobileDisplay !== 'hidden' &&
    cell.mobileDisplay !== 'legend' &&
    !isAttachedDisplay(cell)
  );
}

/** 카드 제목 한 마디의 평문 — 옵션 1개짜리 라디오는 그 옵션 라벨 */
export function itemCardTitleText(cell: TableCell): string {
  return labelOnlyRadioText(cell) ?? (cell.content ?? '').trim();
}

export function buildItemCards(displayRows: TableRow[]): ItemCard[] {
  const coverage = buildTableRowspanCoverage(displayRows);
  const cards: ItemCard[] = [];

  for (const row of displayRows) {
    const covered = coverage.get(row.id) ?? row.cells;
    let path: TableCell[] = [];
    let open: ItemCard | null = null;
    let pendingDisplay: TableCell[] = [];

    row.cells.forEach((own, columnIndex) => {
      const placeholder = own.isHidden || own._isContinuation;
      const anchor = covered[columnIndex];
      if (placeholder) {
        // 가로 병합에 덮인 자리(자기 자신이 그대로 돌아온다)는 건너뛴다
        if (!anchor || anchor === own) return;
        // 위 행에서 내려온 세로 병합
        if (isLabelCell(anchor)) {
          if (open) {
            open = null;
            path = [];
          }
          path.push(anchor);
        } else if (!DISPLAY_TYPES.has(anchor.type)) {
          // 내려온 입력 칸 — 이 항목은 병합이 시작된 행의 카드에 있다
          path = [];
          open = null;
        }
        return;
      }

      if (isLabelCell(own)) {
        if (open) {
          open = null;
          path = [];
        }
        path.push(own);
        return;
      }

      if (DISPLAY_TYPES.has(own.type)) {
        if (!isAttachedDisplay(own)) return;
        if (open) open.displayCells.push(own);
        else pendingDisplay.push(own);
        return;
      }

      if (!open) {
        open = {
          key: own.id,
          rowId: row.id,
          titleCells: path,
          fallbackTitle: row.label ?? '',
          inputs: [],
          displayCells: pendingDisplay,
        };
        pendingDisplay = [];
        cards.push(open);
      }
      open.inputs.push({ cell: own, row });
    });
  }

  return cards;
}
