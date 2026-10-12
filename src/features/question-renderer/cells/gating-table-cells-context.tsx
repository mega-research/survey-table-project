'use client';

import { type ReactNode, createContext, useContext } from 'react';

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
 *
 * 두 번째 용도: 보기 그룹 표의 단독 선택 보기 판정(choice-opt-cell) — 같은 그룹의 다른 행에 있는
 * 「없음」 셀을 찾아야 해서 역시 표 전체 셀이 필요하다. 이름은 첫 용도에서 왔지만 공급하는 것은
 * "표 전체 셀 정의" 하나다.
 */
const GatingTableCellsContext = createContext<readonly TableCell[] | null>(null);

/**
 * 지금 화면에 보이는 칸의 id 집합 — 행·열 표시 조건과 동적 행 선택을 거쳐 남은 칸.
 *
 * 중복 불가 묶음이 구성원을 고르는 데 쓴다: 숨은 칸의 값은 응답에 남아 있어, 표 전체 셀로 판정하면
 * 보이지 않는 칸이 보기를 차지한다. 차단 검증(numeric-validation 의 collectVisibleTableCells)과
 * 같은 범위여야 「회색인데 검증은 통과」·「고를 수 있었는데 다음에서 막힘」이 안 생긴다.
 * 묶음이 없는 표(대다수)는 공급하지 않는다 — null 이면 표 전체가 보이는 것으로 본다.
 */
const VisibleTableCellIdsContext = createContext<ReadonlySet<string> | null>(null);

export function GatingTableCellsProvider({
  value,
  visibleCellIds = null,
  children,
}: {
  value: readonly TableCell[] | null;
  visibleCellIds?: ReadonlySet<string> | null;
  children: ReactNode;
}) {
  return (
    <GatingTableCellsContext.Provider value={value}>
      <VisibleTableCellIdsContext.Provider value={visibleCellIds}>
        {children}
      </VisibleTableCellIdsContext.Provider>
    </GatingTableCellsContext.Provider>
  );
}

export function useGatingTableCells(): readonly TableCell[] | null {
  return useContext(GatingTableCellsContext);
}

export function useVisibleTableCellIds(): ReadonlySet<string> | null {
  return useContext(VisibleTableCellIdsContext);
}
