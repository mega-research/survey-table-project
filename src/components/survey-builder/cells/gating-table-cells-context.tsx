'use client';

import { createContext, useContext } from 'react';

import type { TableCell } from '@/types/survey';

/**
 * 셀 게이팅 컨트롤러 정의 탐색용 — **표 전체 셀** 목록.
 *
 * 컨트롤러는 같은 표 안이면 어느 행이든 된다(2026-09-10). 값은 문항 단위 응답 객체에서
 * 셀 id 로 찾으므로 행 경계가 없지만, 라디오·체크박스 조건의 `{optionId}` 래핑을 옵션
 * value 로 풀려면 컨트롤러 셀 **정의**가 필요하다. 표를 그리는 호스트는 여럿(데스크톱 격자·
 * 가상화 격자·모바일 스테퍼·드릴다운·행 단위 카드)이고 전부 InteractiveTableResponse 아래
 * 있으므로, 거기서 한 번 공급하고 InteractiveCell 이 읽는다. 없으면 같은 행 셀(rowCells prop)로
 * 폴백한다 — 응답 표 밖에서 행 카드를 그리는 빌더 편집 화면(dynamic-table-editor) 이 그 경로다.
 */
const GatingTableCellsContext = createContext<readonly TableCell[] | null>(null);

export const GatingTableCellsProvider = GatingTableCellsContext.Provider;

export function useGatingTableCells(): readonly TableCell[] | null {
  return useContext(GatingTableCellsContext);
}
