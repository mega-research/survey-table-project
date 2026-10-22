import type {
  DynamicRowGroupConfig,
  HeaderCell,
  Question,
  TableColumn,
  TableRow,
} from '@/types/survey';
import type { BranchEvalCtx } from '@/utils/branch-eval';
import {
  shouldDisplayColumn,
  shouldDisplayDynamicGroup,
  shouldDisplayRow,
} from '@/utils/branch-logic';
import {
  recalculateColspansForVisibleColumns,
  recalculateRowspansForVisibleRows,
} from '@/utils/table-merge-helpers';

/**
 * 응답 화면 표의 가시 투영 — 행·열 표시조건과 동적 행 선택으로 지금 응답자에게 보이는 격자.
 *
 * 렌더러·차단 검증·저장 경계 strip 이 **같은 투영**을 쓴다. 판정이 갈리면 "화면엔 없는데 답으로
 * 친다"(숨은 칸의 선택이 필수를 채움) 또는 "화면엔 있는데 지운다"(보이는 칸의 답이 strip 에 지워짐)
 * 가 생긴다. 서버 저장 경계도 부르므로 순수 함수로 공용 구역에 둔다.
 */

interface ProjectConditionalTableLayoutInput {
  columns: TableColumn[];
  rows: TableRow[];
  headerGrid?: HeaderCell[][] | undefined;
  allResponses?: Record<string, unknown> | undefined;
  allQuestions?: Question[] | undefined;
  /** 조건 평가 컨텍스트. 빠뜨리면 attr/lookup 피연산자가 undefined 로 평가된다. */
  evalCtx?: BranchEvalCtx | undefined;
}

export interface ConditionalTableLayout {
  columns: TableColumn[];
  rows: TableRow[];
  headerGrid?: HeaderCell[][] | undefined;
}

export function projectConditionalTableLayout(
  input: ProjectConditionalTableLayoutInput,
): ConditionalTableLayout {
  const { allResponses, allQuestions, evalCtx } = input;
  if (!allResponses || !allQuestions) {
    return {
      columns: input.columns,
      rows: input.rows,
      ...(input.headerGrid ? { headerGrid: input.headerGrid } : {}),
    };
  }
  // 열 정의가 없는 표(레거시 데이터)는 열을 투영하지 않는다 — 보이는 열이 0개로 잡혀 셀이 통째로
  // 사라지면 화면은 비고, 같은 투영을 쓰는 strip 은 그 표의 답을 전부 지운다.
  if (input.columns.length === 0) {
    const visibleRowIds = new Set(
      input.rows
        .filter((row) => shouldDisplayRow(row, allResponses, allQuestions, evalCtx))
        .map((row) => row.id),
    );
    return {
      columns: input.columns,
      rows: recalculateRowspansForVisibleRows(input.rows, visibleRowIds),
      ...(input.headerGrid ? { headerGrid: input.headerGrid } : {}),
    };
  }

  const visibleColumnIds = new Set(
    input.columns
      .filter((column) => shouldDisplayColumn(column, allResponses, allQuestions, evalCtx))
      .map((column) => column.id),
  );
  const columnProjection = recalculateColspansForVisibleColumns(
    input.columns,
    input.rows,
    visibleColumnIds,
    input.headerGrid,
  );
  const visibleRowIds = new Set(
    columnProjection.rows
      .filter((row) => shouldDisplayRow(row, allResponses, allQuestions, evalCtx))
      .map((row) => row.id),
  );

  return {
    columns: columnProjection.columns,
    rows: recalculateRowspansForVisibleRows(columnProjection.rows, visibleRowIds),
    ...(columnProjection.headerGrid ? { headerGrid: columnProjection.headerGrid } : {}),
  };
}

interface ProjectResponseTableLayoutInput extends ProjectConditionalTableLayoutInput {
  dynamicRowConfigs?: DynamicRowGroupConfig[] | null | undefined;
  /**
   * 응답자가 고른 동적 행 id. 표 문항은 표 응답 안 `__selectedRowIds`, 보기 소스 표(radio·checkbox)는
   * 루트 사이드카 `__dynamicRowSelections__[문항 id]` 에 있다 — 출처는 호출부가 고른다.
   */
  selectedDynamicRowIds: readonly string[];
}

export interface ResponseTableLayout extends ConditionalTableLayout {
  /** 행·열 조건만 적용한 행 — 동적 행 선택은 반영하지 않는다. */
  conditionalRows: TableRow[];
  /** 켜져 있고 그룹 표시조건을 통과한 동적 그룹 — 응답자가 행을 고를 수 있는 그룹 */
  dynamicConfigs: DynamicRowGroupConfig[];
  /** 그 그룹들의 행 풀(조건 투영 뒤) — 선택 모달의 후보 */
  dynamicRows: TableRow[];
}

/**
 * 행·열 표시조건 위에 동적 행 선택까지 반영한 투영.
 *
 * 동적 그룹 규칙은 표 문항의 차단 검증(`collectVisibleTableCells`)과 같다.
 * - 켜진 그룹의 행은 그룹이 보이고 그 행을 골랐을 때만 보인다. 그룹 표시조건이 거짓이면 통째로 숨는다.
 * - `showWhenDynamicGroupId`(소계 행)는 그 그룹이 보이고 하나라도 골랐을 때만 보인다.
 * - 꺼진 그룹의 행은 평범한 행이다.
 *
 * 조건 재료(allResponses·allQuestions)가 없으면 그룹 표시조건은 참으로 본다 — 빌더 편집
 * 미리보기처럼 조건을 무시하는 화면이다. 동적 행 선택은 그때도 반영한다.
 */
export function projectResponseTableLayout(
  input: ProjectResponseTableLayoutInput,
): ResponseTableLayout {
  const conditional = projectConditionalTableLayout(input);
  const { allResponses, allQuestions, evalCtx } = input;
  const enabledConfigs = (input.dynamicRowConfigs ?? []).filter((config) => config.enabled);
  const enabledGroupIds = new Set(enabledConfigs.map((config) => config.groupId));
  const shownConfigs = enabledConfigs.filter(
    (config) =>
      !config.displayCondition ||
      !allResponses ||
      !allQuestions ||
      shouldDisplayDynamicGroup(config, allResponses, allQuestions, evalCtx),
  );
  const shownGroupIds = new Set(shownConfigs.map((config) => config.groupId));
  const hasEnabledDynamicRows = input.rows.some(
    (row) => row.dynamicGroupId !== undefined && enabledGroupIds.has(row.dynamicGroupId),
  );

  if (!hasEnabledDynamicRows) {
    return {
      ...conditional,
      conditionalRows: conditional.rows,
      dynamicConfigs: [],
      dynamicRows: [],
    };
  }

  const selected = new Set(input.selectedDynamicRowIds);
  const groupsWithSelection = new Set<string>();
  for (const row of conditional.rows) {
    if (row.dynamicGroupId && shownGroupIds.has(row.dynamicGroupId) && selected.has(row.id)) {
      groupsWithSelection.add(row.dynamicGroupId);
    }
  }
  const visibleRowIds = new Set(
    conditional.rows
      .filter((row) => {
        if (row.dynamicGroupId && enabledGroupIds.has(row.dynamicGroupId)) {
          return shownGroupIds.has(row.dynamicGroupId) && selected.has(row.id);
        }
        if (row.showWhenDynamicGroupId && enabledGroupIds.has(row.showWhenDynamicGroupId)) {
          return groupsWithSelection.has(row.showWhenDynamicGroupId);
        }
        return true;
      })
      .map((row) => row.id),
  );

  return {
    ...conditional,
    conditionalRows: conditional.rows,
    rows:
      visibleRowIds.size === conditional.rows.length
        ? conditional.rows
        : recalculateRowspansForVisibleRows(conditional.rows, visibleRowIds),
    dynamicConfigs: shownConfigs,
    dynamicRows: conditional.rows.filter(
      (row) => row.dynamicGroupId !== undefined && shownGroupIds.has(row.dynamicGroupId),
    ),
  };
}

/** 투영된 행에서 응답자에게 그려지는 셀 id — 병합으로 덮인 칸은 뺀다. */
export function collectProjectedCellIds(rows: readonly TableRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) for (const cell of row.cells) if (!cell.isHidden) ids.add(cell.id);
  return ids;
}
