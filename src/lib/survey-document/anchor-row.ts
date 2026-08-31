import type { SurveyAnchorSnapshot } from '@/db/schema/schema-types';

/**
 * 앵커 행 → 좌표 모양. **대상 종류를 파생하는 유일한 지점이다.**
 *
 * `survey_document_anchors` 는 종류 구분값을 저장하지 않고 두 FK 중 어느 쪽이
 * 채워졌는지로 종류를 판정한다(0098). 그 판정을 읽는 곳마다 손으로 적으면
 * 한 곳만 뒤집혀도 컴파일이 통과하고, 그 결과는 응답 화면에 엉뚱한 사각형으로만
 * 나타난다 — 조용한 실패다. 그래서 한 함수에 가둔다.
 */
export interface AnchorRow {
  documentId: string;
  questionId: string | null;
  groupId: string | null;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function toAnchorSnapshot(row: AnchorRow): SurveyAnchorSnapshot {
  return {
    documentId: row.documentId,
    // CHECK 제약이 둘 중 하나만 채워짐을 보장하므로 questionId 유무가 곧 종류다.
    ...(row.questionId !== null
      ? ({ ownerKind: 'question', ownerId: row.questionId } as const)
      : ({ ownerKind: 'group', ownerId: row.groupId ?? '' } as const)),
    page: row.page,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
  };
}

/** 다음 `order` 값. 목록이 비어 있으면 0. */
export function nextOrderAfter(rows: readonly { order: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.order + 1), 0);
}
