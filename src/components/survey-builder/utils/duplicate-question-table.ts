/**
 * 질문 복제의 표 부분 — 열·행·셀 id 를 새로 발번하고 그 id 를 가리키던 참조를 함께 옮긴다.
 *
 * 참조를 옮기지 않으면 복제본의 게이팅 셀이 원본 질문의 컨트롤러를 보게 되어 영구 비활성이
 * 되고(컨트롤러 미응답 = 미충족 = 비활성), 검증 수식은 남의 칸 값으로 판정한다. 행 복제
 * (use-table-editor 의 duplicateRow)가 이미 지키는 규약을 표 전체로 넓힌 것이다.
 *
 * id 발번과 참조 이동을 두 단계로 나눈다 — 참조가 "복사 범위 안"을 판정하려면 대응표가
 * 통째로 있어야 한다.
 */
import { remapRowRepeatIds } from '@/lib/question/row-repeat';
import { generateId } from '@/lib/utils';
import type { Question, TableColumn, TableRow } from '@/types/survey';
import { remapCellRefs } from '@/utils/table-cell-refs';

import { regenerateCellOptionIds } from './drag-copy-utils';

/** 복제된 표 조각 — 값이 있는 키만 담는다 (표가 없는 질문이면 빈 객체). */
export interface DuplicatedQuestionTable {
  tableColumns?: TableColumn[];
  tableRowsData?: TableRow[];
  dynamicRowConfigs?: NonNullable<Question['dynamicRowConfigs']>;
  rowRepeatConfig?: NonNullable<Question['rowRepeatConfig']>;
}

export function duplicateQuestionTable(
  question: Question,
  makeId: () => string = generateId,
): DuplicatedQuestionTable {
  const columns = question.tableColumns;
  const rows = question.tableRowsData;
  if (!columns && !rows) return {};

  const newColumns = columns?.map((col) => ({ ...col, id: makeId() }));

  // 1단계: 새 id 를 정하고 대응표를 채운다.
  const rowIdMap = new Map<string, string>();
  const cellIdMap = new Map<string, string>();
  const idAssigned = rows?.map((row) => {
    const newRowId = makeId();
    rowIdMap.set(row.id, newRowId);
    return {
      ...row,
      id: newRowId,
      cells: row.cells.map((cell, colIndex) => {
        const newColId = newColumns?.[colIndex]?.id;
        const newCellId = newColId ? `cell-${newRowId}-${newColId}` : makeId();
        cellIdMap.set(cell.id, newCellId);
        const cloned = { ...cell, id: newCellId };
        // 옵션 id 를 원본과 공유하면 상세 기재 사이드카가 충돌한다 (행 복제와 같은 근거).
        regenerateCellOptionIds(cloned, makeId);
        return cloned;
      }),
    };
  });

  // 2단계: 대응표 위에서 셀 참조를 옮긴다.
  const remappedRows = idAssigned?.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => remapCellRefs(cell, cellIdMap)),
  }));

  const newDynamicRowConfigs = question.dynamicRowConfigs?.map((config) => {
    const { insertAfterRowId: _old, ...rest } = config;
    const mapped = config.insertAfterRowId
      ? (rowIdMap.get(config.insertAfterRowId) ?? config.insertAfterRowId)
      : undefined;
    return mapped !== undefined ? { ...rest, insertAfterRowId: mapped } : rest;
  });

  const repeat = remapRowRepeatIds(remappedRows ?? [], question.rowRepeatConfig, rowIdMap);

  return {
    ...(newColumns !== undefined ? { tableColumns: newColumns } : {}),
    ...(remappedRows !== undefined
      ? { tableRowsData: repeat.config ? repeat.rows : remappedRows }
      : {}),
    ...(newDynamicRowConfigs !== undefined ? { dynamicRowConfigs: newDynamicRowConfigs } : {}),
    ...(repeat.config ? { rowRepeatConfig: repeat.config } : {}),
  };
}
