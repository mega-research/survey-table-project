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
 * - 세로 병합된 라벨 하나만 제목인 항목은 그 라벨이 덮는 아래 행의 같은 보기 그룹 보기 칸(하위 라벨 없이)까지
 *   카드 한 장이다(「2) 지원 부문」 이 3행을 덮고 행마다 보기 칸만 있는 표). 입력 칸이 이어지면 행마다 카드다.
 * - 라벨 없이 입력 칸만 있는 행은 행 이름을 제목으로 쓴다(격자형 표는 행 카드와 같은 모양이 된다).
 * - 라벨 뒤에 「바로 표시」·「접기」 글자만 오고 입력 칸 없이 다음 라벨·행 끝이 오면 그 라벨의 **표시 전용
 *   카드**다(전시회명 | 값 | 개최 기간 | 값). 세로 병합된 구분 라벨 뒤는 하위 항목이라 닫지 않는다.
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
  /** 이 칸이 놓인 열(displayRows 의 셀 인덱스) — 블록 모드가 열 헤더를 입력 라벨로 읽는다 */
  columnIndex: number;
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

/** 카드의 입력이 전부 `cell` 과 같은 보기 그룹의 보기 칸인가 */
function isSameChoiceGroup(card: ItemCard, cell: TableCell): boolean {
  if (cell.type !== 'choice_opt' || !cell.choiceGroupId) return false;
  return card.inputs.every(
    (entry) => entry.cell.type === 'choice_opt' && entry.cell.choiceGroupId === cell.choiceGroupId,
  );
}

/** 카드 제목 한 마디의 평문 — 옵션 1개짜리 라디오는 그 옵션 라벨 */
export function itemCardTitleText(cell: TableCell): string {
  return labelOnlyRadioText(cell) ?? (cell.content ?? '').trim();
}

/**
 * `columnRange` 를 주면 그 열 구간([start, end))의 셀만 훑는다 — 「블록 단위로 세우기」가 블록마다
 * 같은 규칙을 한 번씩 돌린다(`item-card-blocks`). 세로 병합 판정은 표 전체 기준 그대로다.
 */
export function buildItemCards(
  displayRows: TableRow[],
  columnRange?: { start: number; end: number },
): ItemCard[] {
  const coverage = buildTableRowspanCoverage(displayRows);
  const cards: ItemCard[] = [];
  // 세로 병합된 라벨 하나만 제목인 카드 — 그 라벨이 덮는 아래 행도 하위 라벨 없이 **같은 보기 그룹의
  // 보기 칸**만 이어지면 한 문항의 보기라 이 카드에 잇는다(「2) 지원 부문」 3행의 보기 칸이 같은 제목 카드
  // 석 장이 되지 않게). 입력 칸이 이어지는 행(국가 12행 × 국가·비중)은 종전대로 행마다 카드다
  const cardByMergedLabel = new Map<string, ItemCard>();

  for (const row of displayRows) {
    const covered = coverage.get(row.id) ?? row.cells;
    let path: TableCell[] = [];
    let open: ItemCard | null = null;
    let pendingDisplay: TableCell[] = [];
    // 라벨 뒤에 바로 표시 글자만 오고 입력 칸 없이 다음 라벨·행 끝이 오면 그 라벨의 표시 전용 카드다
    // (전시회명 | 값 | 개최 기간 | 값). 라벨 없이 앞선 표시 글자는 종전대로 다음 카드의 설명이다.
    // 세로 병합된 라벨(여러 행을 묶는 구분) 뒤의 라벨은 형제가 아니라 하위 항목이라 닫지 않는다 —
    // 「바이어 접촉 명수(병합) | 설명 | 기존 | 입력」에서 설명은 「기존」 카드에 붙는다.
    const closeDisplayOnlyCard = (atRowEnd: boolean) => {
      const first = pendingDisplay[0];
      if (open || path.length === 0 || !first) return;
      if (!atRowEnd && (path[path.length - 1]?.rowspan ?? 1) > 1) return;
      cards.push({
        key: first.id,
        rowId: row.id,
        titleCells: path,
        fallbackTitle: row.label ?? '',
        inputs: [],
        displayCells: pendingDisplay,
      });
      path = [];
      pendingDisplay = [];
    };

    row.cells.forEach((own, columnIndex) => {
      if (columnRange && (columnIndex < columnRange.start || columnIndex >= columnRange.end)) {
        return;
      }
      const placeholder = own.isHidden || own._isContinuation;
      const anchor = covered[columnIndex];
      if (placeholder) {
        // 가로 병합에 덮인 자리(자기 자신이 그대로 돌아온다)는 건너뛴다
        if (!anchor || anchor === own) return;
        // 위 행에서 내려온 세로 병합
        if (isLabelCell(anchor)) {
          closeDisplayOnlyCard(false);
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
        closeDisplayOnlyCard(false);
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
        const lone = path.length === 1 && (path[0]?.rowspan ?? 1) > 1 ? path[0] : undefined;
        const candidate = lone ? cardByMergedLabel.get(lone.id) : undefined;
        const continued =
          candidate && isSameChoiceGroup(candidate, own) ? candidate : undefined;
        if (continued) {
          continued.displayCells.push(...pendingDisplay);
          open = continued;
        } else {
          open = {
            key: own.id,
            rowId: row.id,
            titleCells: path,
            fallbackTitle: row.label ?? '',
            inputs: [],
            displayCells: pendingDisplay,
          };
          cards.push(open);
          if (lone) cardByMergedLabel.set(lone.id, open);
        }
        pendingDisplay = [];
      }
      open.inputs.push({ cell: own, row, columnIndex });
    });
    closeDisplayOnlyCard(true);
  }

  return cards;
}
