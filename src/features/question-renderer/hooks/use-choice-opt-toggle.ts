import { useCallback, useMemo } from 'react';

import { useGatingTableCells } from '@/features/question-renderer/cells/gating-table-cells-context';
import { useQuestionResponseWriter } from '@/features/question-renderer/hooks/use-question-response-writer';
import {
  useQuestionResponseSelector,
  useResponseSources,
} from '@/features/question-renderer/response-sources';
import {
  applyExclusiveSelection,
  applyTableExclusiveToGroups,
  collectExclusiveChoiceCellIds,
  collectTableExclusiveChoiceCellIds,
} from '@/features/question-renderer/utils/exclusive-choice';
import { CHOICE_GROUPS_KEY, readTableChoiceGroups } from '@/lib/survey/choice-selection';
import type { ChoiceGroup, TableCell } from '@/types/survey';

/**
 * 보기 그룹 표의 한 그룹 선택 — 표 응답 안 예약 키 `__choiceGroups[그룹키]` 의 값(단일 그룹은
 * 셀 id 하나, 복수 그룹은 셀 id 배열).
 *
 * 주입 원본이 있으면 이 그룹의 선택만 구독한다 — 질문 객체 전체를 구독하면 셀 하나 바뀔 때마다
 * 표 전체가 재렌더된다(use-cell-response 의 셀 단위 구독 원칙). 원본이 없으면 value prop 이 유일한 원본이다.
 */
export function useChoiceGroupSelection(
  questionId: string,
  groupKey: string,
  value: Record<string, unknown> | undefined,
): string | string[] | undefined {
  const { questionResponses: source } = useResponseSources();
  const selectGroup = useCallback(
    (questionResponse: unknown) => readTableChoiceGroups(questionResponse)[groupKey],
    [groupKey],
  );
  const sourceSelection = useQuestionResponseSelector(source, questionId, selectGroup);
  return source ? sourceSelection : readTableChoiceGroups(value)[groupKey];
}

interface UseChoiceGroupToggleArgs {
  questionId: string;
  group: ChoiceGroup;
  value?: Record<string, unknown> | undefined;
  onChange?: ((value: Record<string, unknown>) => void) | undefined;
}

/**
 * 보기 그룹 하나의 선택과 그 그룹의 보기 칸을 고르고 푸는 쓰기 — 데스크톱 셀·모바일 세로 타일·척도
 * 막대가 같은 규칙(단독 선택·표 전체 범위·라디오 다시 누르면 해제)을 쓰도록 한 곳에 둔다. 칸마다
 * 훅을 부를 수 없는 자리(척도 막대)는 이것을, 칸 하나를 그리는 자리는 useChoiceOptToggle 을 쓴다.
 *
 * 쓰기는 질문 응답 쓰기 채널을 타되, 예약 키 아래 맵은 상위 병합이 통째로 바꾸므로 최신 맵 위에
 * 그룹 하나만 고쳐 넣는다.
 */
export function useChoiceGroupToggle({
  questionId,
  group,
  value,
  onChange,
}: UseChoiceGroupToggleArgs): {
  selection: string | string[] | undefined;
  toggle: (cell: TableCell) => void;
} {
  const { questionResponses: source } = useResponseSources();
  const mergePatch = useQuestionResponseWriter({ questionId, value, onChange });
  const groupKey = group.groupKey;
  const selection = useChoiceGroupSelection(questionId, groupKey, value);
  const isCheckbox = group.type === 'checkbox';

  // 단독 선택 보기 판정 재료 — 같은 그룹의 보기 셀 중 exclusiveChoice 가 켜진 것. 다른 행의 셀이라
  // 표 전체 셀 공급자에서 받는다(게이팅과 같은 공급자 — 응답 표 호스트는 전부 그 아래 있다).
  // 공급자가 없는 자리(빌더 편집 화면)에서는 누른 셀 자신만 판정한다 — 거기서는 보기 셀이
  // 컨트롤로 그려지지 않으므로 실제로 도달하지 않는다.
  const tableCells = useGatingTableCells();
  const groupExclusiveIds = useMemo(
    () => collectExclusiveChoiceCellIds(tableCells ?? [], group.id),
    [group.id, tableCells],
  );
  // 표 전체 범위 단독 보기 — 그룹을 가리지 않고 이 표의 모든 보기 셀에서 모은다
  const tableExclusiveIds = useMemo(
    () => collectTableExclusiveChoiceCellIds(tableCells ?? []),
    [tableCells],
  );

  const commit = useCallback(
    (
      next: string | string[] | undefined,
      picked?: { id: string; tableExclusiveIds: ReadonlySet<string> },
    ) => {
      const latest = readTableChoiceGroups(source ? source.read(questionId) : value);
      let map: Record<string, string | string[]> = { ...latest };
      if (next === undefined) delete map[groupKey];
      else map[groupKey] = next;
      // 고른 것이 있을 때만 표 전체 규칙을 돌린다 — 해제는 다른 그룹에 영향이 없다
      if (picked !== undefined) {
        map = applyTableExclusiveToGroups(map, groupKey, picked.id, picked.tableExclusiveIds);
      }
      mergePatch({ [CHOICE_GROUPS_KEY]: map });
    },
    [groupKey, mergePatch, questionId, source, value],
  );

  const toggle = useCallback(
    (cell: TableCell) => {
      const exclusive = cell.exclusiveChoice === true;
      const tableIds =
        exclusive && cell.exclusiveScope === 'table' && !tableExclusiveIds.has(cell.id)
          ? new Set([...tableExclusiveIds, cell.id])
          : tableExclusiveIds;
      const picked = { id: cell.id, tableExclusiveIds: tableIds };
      if (isCheckbox) {
        const current = Array.isArray(selection) ? (selection as string[]) : [];
        if (current.includes(cell.id)) {
          commit(current.filter((id) => id !== cell.id));
          return;
        }
        const isExclusiveCellId = (id: string) =>
          groupExclusiveIds.has(id) || (exclusive && id === cell.id);
        commit(applyExclusiveSelection(current, cell.id, isExclusiveCellId).next, picked);
        return;
      }
      // 라디오는 고른 것을 다시 누르면 푼다 — 표 안 radio 셀과 같은 동작
      if (selection === cell.id) commit(undefined);
      else commit(cell.id, picked);
    },
    [commit, groupExclusiveIds, isCheckbox, selection, tableExclusiveIds],
  );

  return { selection, toggle };
}

interface UseChoiceOptToggleArgs extends UseChoiceGroupToggleArgs {
  cell: TableCell;
}

/** 보기 그룹의 보기 칸 하나를 고르고 푸는 쓰기 — 규칙은 useChoiceGroupToggle 한 곳이다 */
export function useChoiceOptToggle({
  cell,
  questionId,
  group,
  value,
  onChange,
}: UseChoiceOptToggleArgs): { checked: boolean; toggle: () => void } {
  const { selection, toggle } = useChoiceGroupToggle({ questionId, group, value, onChange });
  const checked =
    group.type === 'checkbox'
      ? Array.isArray(selection) && selection.includes(cell.id)
      : selection === cell.id;
  const toggleCell = useCallback(() => toggle(cell), [cell, toggle]);
  return { checked, toggle: toggleCell };
}
