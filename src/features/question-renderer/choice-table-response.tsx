'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { ChevronRight, ListChecks } from 'lucide-react';

import { CellText, resolveCellTextHtml } from '@/features/question-renderer/cell-text';
import {
  useAnswerQuotes,
  useBranchEvalCtx,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import { DynamicRowSelectorModal } from '@/features/question-renderer/dynamic-row-selector-modal';
import { MobileDisplayCells } from '@/features/question-renderer/mobile-display-cells';
import { MobileRowWiseOriginalSheet } from '@/features/question-renderer/mobile-row-wise-original-sheet';
import { useOptionTexts, useResponseSources } from '@/features/question-renderer/response-sources';
import { TablePreview } from '@/features/question-renderer/table-preview';
import { projectConditionalTableLayout } from '@/features/question-renderer/utils/conditional-table-layout';
import { buildMobileRowWiseOriginalModel } from '@/features/question-renderer/utils/mobile-row-wise-original';
import { findMobileHeaderCell } from '@/features/question-renderer/utils/split-display-cells';
import { useMobileView } from '@/hooks/use-media-query';
import { collectTableCells, isCellEnabled } from '@/lib/survey/cell-gating';
import { CHOICE_TABLE_CONTROL_CELL_TYPES } from '@/lib/survey/choice-table-cell-value';
import {
  type GroupSelectionMap,
  applyExclusiveSelection,
  applyTableExclusiveToGroups,
  collectExclusiveChoiceCellIdsFromRows,
  collectTableExclusiveChoiceCellIds,
  countSelectionsTowardMax,
  satisfiesMinSelections,
} from './utils/exclusive-choice';
import { PRIOR_HIGHLIGHT_CONTROL_CLS, isPriorChoice } from '@/features/question-renderer/utils/prior-answer-highlight';
import { usePriorHighlight } from '@/features/question-renderer/prior-answers-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { Question, TableCell, TableRow } from '@/types/survey';
import { shouldDisplayDynamicGroup } from '@/utils/branch-logic';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';
import {
  type GroupedChoiceAnswer,
  collectChoiceGroups,
  getGroupKeyOfCell,
  getGroupTypeOfCell,
  groupChoiceCellsByGroup,
  isGroupedChoiceQuestion,
} from '@/utils/choice-group-helpers';
import { buildChoiceGroupOutline } from './utils/choice-group-outline';
import { resolveChoiceGroupSectionLabel } from './utils/choice-group-section-label';
import { collectChoiceOptCells, resolveChoiceOptions } from '@/utils/choice-source';
import { resolveMobileTableDisplayMode } from '@/utils/mobile-table-display-mode';
import { omitKey } from '@/utils/omit-key';
import { resolveRequiredMessage } from '@/utils/required-message';
import { recalculateRowspansForVisibleRows } from '@/utils/table-merge-helpers';

import { ChoiceTableCellControl } from './choice-table-cell-control';
import { ChoiceTableDrilldown } from './choice-table-drilldown';
import { ChoiceTableGatedCell } from './choice-table-gated-cell';
import { MobileOptionCard, MobileSectionCard } from './mobile-card-shared';
import { OptionTextInput } from './option-text-input';
import { OptionTextInputStack, type OptionTextStackEntry } from './option-text-input-stack';
import { ValidationIssueBanner } from './validation-issue-banner';

// useSyncExternalStore 안정 참조 — 원본이 undefined 를 줄 때 쓰는 고정 빈 맵
const EMPTY_OPTION_TEXTS: Record<string, string> = {};
// 미충족 필수 보기 그룹이 없을 때(또는 「다음」 전) 쓰는 고정 빈 집합 — memo 의존성 안정용
const EMPTY_CELL_ID_SET: Set<string> = new Set();

/** 모바일 상세에서 숨긴 셀 — 본문(평문·서식본)만 비운다. */
function blankCellContent(cell: TableCell): TableCell {
  const { contentHtml: _contentHtml, ...rest } = cell;
  return { ...rest, content: '' };
}

interface ChoiceTableResponseProps {
  question: Question;
  /**
   * radio: string | null (비그룹), GroupedChoiceAnswer (그룹별 선택)
   * checkbox: string[]
   */
  value: unknown;
  onChange: (value: string | string[] | GroupedChoiceAnswer | null) => void;
  allResponses?: Record<string, unknown> | undefined;
  allQuestions?: Question[] | undefined;
  /** 열·행·동적 그룹 displayCondition 평가를 건너뛰고 전부 표시 (빌더 편집 미리보기용) */
  ignoreDisplayConditions?: boolean | undefined;
  selectedDynamicRowIds?: string[] | undefined;
  onDynamicRowSelectionChange?: ((rowIds: string[]) => void) | undefined;
  /**
   * 미충족 **필수** 보기 그룹의 보기 셀 id 집합 — 이 표가 붉게 두를 자리. 「다음」을 누른 뒤에만
   * 넘긴다 — 응답 중에 미리 빨갛게 깔면 아직 답하는 사람에게 재촉하는 화면이 된다.
   *
   * 판정은 호출부(응답 흐름)가 필수 게이트와 **같은 술어**(`collectUnfilledChoiceGroupCellIds`)로
   * 계산해 넘긴다 — 렌더러는 응답 검증 규칙을 모른다(interactive-table-response 의 `errorCellIds`
   * 와 같은 주입 방식). 갈라지면 "빨갛지 않은데 다음이 막힘" 이 된다.
   */
  unfilledGroupCellIds?: Set<string> | undefined;
}

/**
 * 테이블 내장 radio/checkbox(Case A) 응답 렌더.
 * - 데스크톱: tableRowsData 의 choice_opt 셀만 인터랙티브 input 으로 바꾼 TablePreview
 * - 모바일: 행마다 MobileOptionCard (라벨 + 표시 셀 + 체크/라디오 컨트롤)
 * 응답은 일반 radio/checkbox shape(radio=cell.id | null, checkbox=cell.id[])로 저장한다.
 */
/** 행별 원본 문항 모드에서 "답할 수 있는 행"으로 치는 셀 타입 — 렌더러가 인터랙티브로
 * 그리는 것과 같은 집합이어야 한다(보기 셀 + 단답 input + 선택형 컨트롤 셀). */
const CHOICE_TABLE_ROW_WISE_ANSWERABLE_TYPES: readonly TableCell['type'][] = [
  'choice_opt',
  'input',
  ...([...CHOICE_TABLE_CONTROL_CELL_TYPES] as TableCell['type'][]),
];

export function ChoiceTableResponse({
  question,
  value,
  onChange,
  allResponses,
  allQuestions,
  ignoreDisplayConditions = false,
  selectedDynamicRowIds = [],
  onDynamicRowSelectionChange,
  unfilledGroupCellIds: unfilledGroupCellIdsProp,
}: ChoiceTableResponseProps) {
  const isCheckbox = question.type === 'checkbox';
  // 그룹별 선택 모드 여부 — radio 또는 checkbox 그룹이 1개 이상 정의된 경우 true.
  // isCheckbox 가드를 제거하여 checkbox 질문도 grouped 경로를 밟을 수 있게 한다.
  const isGrouped = isGroupedChoiceQuestion(question);
  const priorHighlight = usePriorHighlight();

  /**
   * 미충족 필수 보기 그룹의 덩어리 외곽선. 집합은 호출부가 필수 게이트와 같은 술어로
   * 계산해 넘긴다(props 설명 참조) — 갈라지면 "빨갛지 않은데 다음이 막힘" 이 된다.
   */
  const unfilledGroupCellIds = unfilledGroupCellIdsProp ?? EMPTY_CELL_ID_SET;
  const groupOutline = useMemo(
    () =>
      unfilledGroupCellIds.size > 0
        ? buildChoiceGroupOutline(question.tableRowsData, unfilledGroupCellIds)
        : new Map(),
    [question.tableRowsData, unfilledGroupCellIds],
  );
  const isMobile = useMobileView();
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  // 조건 평가 컨텍스트 — 빠뜨리면 attr/lookup 피연산자가 undefined 로 평가된다.
  const branchEvalCtx = useBranchEvalCtx(allResponses);
  const [activeDynamicGroupId, setActiveDynamicGroupId] = useState<string | null>(null);
  const options = useMemo(() => resolveChoiceOptions(question), [question]);
  const optionByValue = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const resolveChoiceLabel = useCallback(
    (cellId: string) => optionByValue.get(cellId)?.label,
    [optionByValue],
  );

  // checkbox: cell.id[] / 비그룹 radio: [선택 cellId] / 그룹별(radio+checkbox 혼재): 맵 values flat
  const selectedIds: string[] = useMemo(() => {
    if (!isGrouped && isCheckbox) return Array.isArray(value) ? (value as string[]) : [];
    if (isGrouped) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      // GroupedChoiceAnswer 값은 string(radio 그룹) | string[](checkbox 그룹).
      // flat()으로 두 종류를 통합하여 선택된 모든 cellId 를 추출한다.
      return Object.values(value as GroupedChoiceAnswer).flatMap((v): string[] => {
        if (typeof v === 'string' && v !== '') return [v];
        if (Array.isArray(v)) return v.filter((s): s is string => typeof s === 'string');
        return [];
      });
    }
    return typeof value === 'string' && value ? [value] : [];
  }, [isCheckbox, isGrouped, value]);

  const minSel = question.minSelections;
  const maxSel = question.maxSelections;
  // 단독 선택 보기 판정 — choice_opt 셀의 exclusiveChoice. 그룹 문항은 호출부가 같은 그룹의
  // 배열만 넘기므로 여기서 그룹을 따로 가리지 않는다.
  const exclusiveChoiceCellIds = useMemo(
    () => collectExclusiveChoiceCellIdsFromRows(question.tableRowsData),
    [question.tableRowsData],
  );
  const isExclusiveChoiceCell = (cellId: string) => exclusiveChoiceCellIds.has(cellId);
  // 상한에 세는 개수는 단독 보기를 뺀 것 — 「없음」이 골라진 상태에서 일반 보기를 누르면 「없음」이 풀린다
  const isMaxSelectionReached =
    isCheckbox &&
    maxSel !== undefined &&
    maxSel > 0 &&
    countSelectionsTowardMax(selectedIds, isExclusiveChoiceCell) >= maxSel;
  // 표 전체 범위 단독 보기 — 그룹 문항에서 다른 그룹까지 비운다
  const tableExclusiveIds = useMemo(
    () => collectTableExclusiveChoiceCellIds(collectChoiceOptCells(question.tableRowsData)),
    [question.tableRowsData],
  );

  const toggle = (cellId: string, checked: boolean) => {
    if (isGrouped) {
      const groupKey = getGroupKeyOfCell(question, cellId);
      const cellType = getGroupTypeOfCell(question, cellId);
      const map = (
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as GroupedChoiceAnswer)
          : {}
      ) as GroupedChoiceAnswer;

      if (cellType === 'checkbox') {
        // checkbox 그룹: 배열 push/filter. 빈 배열이 되면 키 삭제.
        const arr = Array.isArray(map[groupKey]) ? (map[groupKey] as string[]) : [];
        let next: string[];
        if (arr.includes(cellId)) {
          // 체크 해제
          next = arr.filter((id) => id !== cellId);
        } else {
          // 체크 추가 — 단독 선택 보기 규칙(같은 그룹 안에서만)
          next = applyExclusiveSelection(arr, cellId, isExclusiveChoiceCell).next;
        }
        if (next.length === 0) {
          onChange(omitKey(map, groupKey));
        } else {
          const merged = { ...map, [groupKey]: next } as GroupSelectionMap;
          onChange(
            (arr.includes(cellId)
              ? merged
              : applyTableExclusiveToGroups(
                  merged,
                  groupKey,
                  cellId,
                  tableExclusiveIds,
                )) as GroupedChoiceAnswer,
          );
        }
        return;
      }

      // radio 그룹: 같은 그룹 내에서 교체, 재클릭 시 해제(키 삭제)
      if (map[groupKey] === cellId) {
        // 재클릭 해제 — 해당 키 삭제
        onChange(omitKey(map, groupKey));
      } else {
        const merged = { ...map, [groupKey]: cellId } as GroupSelectionMap;
        onChange(
          applyTableExclusiveToGroups(
            merged,
            groupKey,
            cellId,
            tableExclusiveIds,
          ) as GroupedChoiceAnswer,
        );
      }
      return;
    }
    if (!isCheckbox) {
      onChange(checked ? cellId : null);
      return;
    }
    let next = selectedIds.slice();
    if (checked) {
      // 최대 선택 가드는 단독 선택 보기에는 걸지 않는다 — 고르면 그것 하나만 남아 상한 안이고,
      // "나중에 누른 쪽이 이긴다"는 규칙상 꽉 찬 상태에서도 「없음」은 들어가야 한다.
      if (
        !isExclusiveChoiceCell(cellId) &&
        maxSel !== undefined &&
        maxSel > 0 &&
        countSelectionsTowardMax(next, isExclusiveChoiceCell) >= maxSel
      )
        return;
      // 단독 선택 보기 규칙 — 비그룹 문항은 문항 전체가 한 그룹이다
      next = applyExclusiveSelection(next, cellId, isExclusiveChoiceCell).next;
    } else {
      next = next.filter((id) => id !== cellId);
    }
    onChange(next);
  };

  /**
   * 이 보기 셀이 이월 선택인가 — 값이 보기 셀 id 라 이월 응답도 같은 모양이다.
   * 그룹 문항은 `{그룹키: 셀id}` 라 그룹 키를 조각 주소로 넘긴다.
   */
  const isPriorChoiceCell = (cellId: string) =>
    isPriorChoice(
      priorHighlight,
      question.id,
      cellId,
      isGrouped ? getGroupKeyOfCell(question, cellId) : undefined,
    );

  const getChoiceCellState = (cell: TableCell) => {
    let checked: boolean;
    if (isGrouped) {
      const map =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as GroupedChoiceAnswer)
          : {};
      const groupKey = getGroupKeyOfCell(question, cell.id);
      const cellType = getGroupTypeOfCell(question, cell.id);
      if (cellType === 'checkbox') {
        // checkbox 그룹: 맵 값이 배열이고 그 배열에 cellId 가 포함되어야 checked
        const arr = map[groupKey];
        checked = Array.isArray(arr) && arr.includes(cell.id);
      } else {
        // radio 그룹: 맵 값이 이 cellId 와 일치하면 checked
        checked = map[groupKey] === cell.id;
      }
    } else {
      checked = selectedIds.includes(cell.id);
    }
    return {
      checked,
      // 단독 선택 보기는 꽉 찬 상태에서도 누를 수 있다 — 고르면 그것 하나만 남는다
      disabled: isMaxSelectionReached && !checked && !isExclusiveChoiceCell(cell.id),
      option: optionByValue.get(cell.id),
    };
  };

  /**
   * 표 아래 상세 기재 스택 엔트리 — 선택된 보기 중 텍스트 입력이 켜진 것만.
   *
   * 순서는 표의 행·열 순서를 따른다. selectedIds 는 그룹 응답 맵의 키 순서(=클릭 순서)라
   * 그대로 쓰면 고를 때마다 칩 순서가 뒤바뀐다.
   *
   * 보기 그룹이 둘 이상이면 칩에 그룹 라벨을 앞에 붙인다 — AQ1 처럼 같은 "기타" 보기가
   * 열마다 하나씩 있는 표에서는 칩 문구가 같아 어느 칸 것인지 구분되지 않는다.
   */
  const textInputEntries = useMemo((): OptionTextStackEntry[] => {
    const selected = new Set(selectedIds);
    const groups = question.choiceGroups ?? [];
    const groupLabelById = new Map(groups.map((group) => [group.id, (group.label ?? '').trim()]));
    const showGroupPrefix = groups.length > 1;

    const entries: OptionTextStackEntry[] = [];
    for (const row of question.tableRowsData ?? []) {
      for (const cell of row.cells) {
        if (cell.type !== 'choice_opt' || cell.isHidden) continue;
        if (!selected.has(cell.id)) continue;
        const option = optionByValue.get(cell.id);
        if (!option?.allowTextInput) continue;
        const base = substituteTokens(option.label ?? '', attrs, quotes).trim() || '(라벨 없음)';
        const groupLabel = showGroupPrefix
          ? (groupLabelById.get(cell.choiceGroupId ?? '') ?? '')
          : '';
        entries.push({ option, label: groupLabel ? `${groupLabel} · ${base}` : base });
      }
    }
    return entries;
  }, [attrs, optionByValue, question, quotes, selectedIds]);

  const rowWiseLayout = useMemo(() => {
    const columns = question.tableColumns ?? [];
    const rows = question.tableRowsData ?? [];
    const conditionalLayout = projectConditionalTableLayout({
      columns,
      rows,
      ...(question.tableHeaderGrid ? { headerGrid: question.tableHeaderGrid } : {}),
      // ignoreDisplayConditions: 빌더 편집 미리보기 — 응답 ctx 를 빼서 전 열·행 표시
      allResponses: ignoreDisplayConditions ? undefined : allResponses,
      allQuestions: ignoreDisplayConditions ? undefined : allQuestions,
      evalCtx: branchEvalCtx,
    });
    const visibleConfigs = (question.dynamicRowConfigs ?? []).filter(
      (config) =>
        config.enabled &&
        (!config.displayCondition ||
          ignoreDisplayConditions ||
          !allResponses ||
          !allQuestions ||
          shouldDisplayDynamicGroup(config, allResponses, allQuestions)),
    );
    const visibleGroupIds = new Set(visibleConfigs.map((config) => config.groupId));
    const selectedSet = new Set(selectedDynamicRowIds);
    const selectedGroupIds = new Set<string>();
    for (const row of conditionalLayout.rows) {
      if (
        row.dynamicGroupId &&
        visibleGroupIds.has(row.dynamicGroupId) &&
        selectedSet.has(row.id)
      ) {
        selectedGroupIds.add(row.dynamicGroupId);
      }
    }
    const visibleRowIds = new Set(
      conditionalLayout.rows
        .filter((row) => {
          if (row.dynamicGroupId && visibleGroupIds.has(row.dynamicGroupId)) {
            return selectedSet.has(row.id);
          }
          if (row.showWhenDynamicGroupId && visibleGroupIds.has(row.showWhenDynamicGroupId)) {
            return selectedGroupIds.has(row.showWhenDynamicGroupId);
          }
          return true;
        })
        .map((row) => row.id),
    );
    return {
      // 조건만 적용한 행 — 동적 행 선택은 반영하지 않는다. 데스크톱 표가 쓴다.
      conditionalRows: conditionalLayout.rows,
      columns: conditionalLayout.columns,
      rows: recalculateRowspansForVisibleRows(conditionalLayout.rows, visibleRowIds),
      headerGrid: conditionalLayout.headerGrid,
      configs: visibleConfigs,
      dynamicRows: conditionalLayout.rows.filter(
        (row) => row.dynamicGroupId && visibleGroupIds.has(row.dynamicGroupId),
      ),
    };
  }, [
    allQuestions,
    allResponses,
    question,
    selectedDynamicRowIds,
    ignoreDisplayConditions,
    branchEvalCtx,
  ]);

  // 상세 기재 자리 셀(optionTextSlot) — 그 행의 상세 기재는 표 아래 스택이 아니라 그 셀 안에
  // 나란히 그린다. 데스크톱 전용 분기이고, 모바일 카드는 카드 아래 스택 그대로다.
  // 판정은 원본이 아니라 **표시 조건을 투영한 행**으로 한다 — 자리 셀의 열이 조건으로 숨으면
  // 셀이 투영에서 빠져 그 행의 입력은 표 아래 스택으로 돌아간다. 원본으로 판정하면 입력칸이
  // 어디에도 안 그려진 채 필수 상세기재가 "다음"을 막는다.
  const slotRowByCellId = useMemo(() => {
    const m = new Map<string, TableRow>();
    for (const row of rowWiseLayout.conditionalRows) {
      for (const cell of row.cells) {
        if (cell.type === 'text' && cell.optionTextSlot && !cell.isHidden) m.set(cell.id, row);
      }
    }
    return m;
  }, [rowWiseLayout.conditionalRows]);
  const slottedOptionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of slotRowByCellId.values()) {
      for (const cell of row.cells) if (cell.type === 'choice_opt') ids.add(cell.id);
    }
    return ids;
  }, [slotRowByCellId]);
  const tableBelowEntries = useMemo(
    () => textInputEntries.filter((entry) => !slottedOptionIds.has(entry.option.id)),
    [textInputEntries, slottedOptionIds],
  );

  // 셀 게이팅 — 이 표의 input·선택형 셀에 걸린 활성 조건은 컨트롤러가 보기 옵션(선택 여부)
  // 이거나 같은 표의 다른 셀이다. 판정 재료는 표 전체 셀 정의 + 선택된 보기 id 집합.
  const gatingTableCells = useMemo(
    () => collectTableCells(question.tableRowsData),
    [question.tableRowsData],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  // 모바일 카드에서 미충족 셀을 걸러낼 때 filled·numeric 조건의 재료 — 같은 표 input 셀의 사이드카 값
  // 값은 주입된 옵션 텍스트 원본(response-sources)에 산다 — 렌더러는 저장소가 무엇인지 모른다.
  const { optionTexts: optionTextSource } = useResponseSources();
  const optionTexts = useOptionTexts(optionTextSource, question.id) ?? EMPTY_OPTION_TEXTS;
  const setOptionText = optionTextSource.write;
  // 게이팅 미충족 셀의 남은 값 정리 — 렌더 여부와 무관하게 표 단위로 한 번에. 모바일 카드는
  // 미충족 셀을 아예 그리지 않아 셀 컴포넌트의 effect 가 돌지 않으므로 여기서 맡는다
  // (선택 → 입력 → 해제 → 재선택에 이전 값이 되살아나면 안 된다). 저장 경계 strip 은 별도 보증.
  useEffect(() => {
    for (const cell of gatingTableCells) {
      if (!cell.enabledWhen || cell.isHidden) continue;
      if (cell.type !== 'input' && !CHOICE_TABLE_CONTROL_CELL_TYPES.has(cell.type)) continue;
      if ((optionTexts[cell.id] ?? '') === '') continue;
      if (!isCellEnabled(cell, optionTexts, gatingTableCells, selectedIdSet)) {
        setOptionText(question.id, cell.id, '');
      }
    }
  }, [gatingTableCells, optionTexts, selectedIdSet, question.id, setOptionText]);
  const gate = (cell: TableCell, node: ReactNode): ReactNode =>
    cell.enabledWhen ? (
      <ChoiceTableGatedCell
        cell={cell}
        questionId={question.id}
        tableCells={gatingTableCells}
        selectedChoiceIds={selectedIdSet}
      >
        {node}
      </ChoiceTableGatedCell>
    ) : (
      node
    );

  const renderCell = (
    cell: TableCell,
    isSelectedRowDetail = false,
    inputIdScope?: string,
  ): ReactNode => {
    // 상세 기재 자리 셀 — 같은 행 보기 중 선택된 상세 기재 입력칸을 세로로 쌓는다.
    // 가로로 나란히 두면 칩 문구(그룹 라벨 · 보기)가 반폭에서 두세 줄로 꺾여 읽기 어렵고
    // 입력칸도 반폭이라 좁다. 선택된 것이 없으면 undefined 로 떨어져 셀 텍스트가 그대로 보인다.
    if (!isSelectedRowDetail && cell.type === 'text' && cell.optionTextSlot) {
      const row = slotRowByCellId.get(cell.id);
      const entries = row
        ? textInputEntries.filter((entry) =>
            row.cells.some((c) => c.type === 'choice_opt' && c.id === entry.option.id),
          )
        : [];
      if (entries.length > 0) {
        return (
          <div className="flex w-full min-w-0 flex-col gap-2">
            {entries.map(({ option, label }) => (
              <div key={option.id} className="min-w-0">
                <OptionTextInput
                  questionId={question.id}
                  option={option}
                  ariaLabel={label}
                  rowLabel={label}
                  stackedLabel
                />
              </div>
            ))}
          </div>
        );
      }
    }
    // 표 안의 단답형 셀 — 값은 새 저장소 없이 __optTexts__ 사이드카에 **셀 id** 를 키로 넣는다.
    // 그 맵은 이미 그룹 보기 셀도 cell.id 로 저장하고 같은 표 안에서 id 는 유일하므로 충돌이 없다.
    // 덕분에 초안·재진입 복원·버전 rebase·관리자 편집 diff 가 그대로 동작한다.
    if (cell.type === 'input' && !cell.isHidden) {
      const cellLabel =
        (cell.exportLabel ?? '').trim() || (cell.placeholder ?? '').trim() || '상세 기재';
      return gate(
        cell,
        <OptionTextInput
          questionId={question.id}
          option={{
            id: cell.id,
            ...(cell.placeholder !== undefined ? { textInputPlaceholder: cell.placeholder } : {}),
            // 숫자 모드·형식 모두 그대로 넘긴다 — 사이드카 칸도 표 input 셀과 같은 규칙이다.
            ...(cell.inputType !== undefined && cell.inputType !== 'text'
              ? { textInputType: cell.inputType }
              : {}),
            ...(cell.textValidation ? { textValidation: cell.textValidation } : {}),
            ...(cell.defaultValueTemplate !== undefined
              ? { defaultValueTemplate: cell.defaultValueTemplate }
              : {}),
            ...(cell.numberFormat !== undefined
              ? { textInputNumberFormat: cell.numberFormat }
              : {}),
            ...(cell.inputRows !== undefined ? { textInputRows: cell.inputRows } : {}),
            ...(cell.inputAutoGrow ? { textInputAutoGrow: true } : {}),
          }}
          ariaLabel={cellLabel}
          className="w-full"
          fixedWidth={cell.inputWidth}
          horizontalAlign={cell.horizontalAlign}
        />,
      );
    }
    // 표 안의 선택형 셀(radio/checkbox/select) — choice_opt 가 아니므로 이 문항의 보기가
    // 아니고, 값 둘 자리도 없어 여태 정적 미리보기로만 그려졌다(클릭해도 저장 안 됨).
    // 단답형 셀과 같은 사이드카에 셀 id 로 저장해 인터랙티브로 만든다.
    if (CHOICE_TABLE_CONTROL_CELL_TYPES.has(cell.type) && !cell.isHidden) {
      return gate(
        cell,
        <ChoiceTableCellControl
          cell={cell}
          questionId={question.id}
          {...(inputIdScope !== undefined ? { inputIdScope } : {})}
        />,
      );
    }
    if (cell.type !== 'choice_opt' || cell.isHidden) return undefined;
    const { checked, disabled, option } = getChoiceCellState(cell);
    // 그룹별 선택 모드: name 을 그룹 키 단위로 분리해야 브라우저가 그룹 간 선택을 지우지 않는다.
    // checkbox 그룹은 name 이 동작에 영향 없지만 일관성을 위해 동일 패턴을 유지한다.
    const inputName = isGrouped
      ? `${question.id}-${getGroupKeyOfCell(question, cell.id)}`
      : question.id;

    // 셀이 속한 그룹의 type 결정. 비그룹 경로는 질문 type 그대로 사용.
    const cellType = isGrouped
      ? getGroupTypeOfCell(question, cell.id)
      : isCheckbox
        ? 'checkbox'
        : 'radio';

    // 컨트롤 옆 라벨: 셀 텍스트(content) 전용. choiceLabel 은 데이터(옵션 라벨 —
    // 모바일 카드·응답 매칭·export)로만 저장되고 데스크톱 셀에는 렌더하지 않는다.
    // 둘 다 있으면 content 만 표시. 비어 있으면(라벨이 다른 열에 있는 구성) 컨트롤만 렌더.
    const rawLabel = (cell.content ?? '').trim();
    const labelText = rawLabel ? substituteTokens(rawLabel, attrs, quotes) : '';

    return (
      <div className="flex flex-col items-center gap-2">
        <label
          className={cn(
            'flex cursor-pointer items-center justify-center gap-2',
            isSelectedRowDetail && 'min-h-11 min-w-11',
          )}
        >
          <input
            id={inputIdScope ? `${inputIdScope}-${cell.id}` : undefined}
            type={cellType === 'checkbox' ? 'checkbox' : 'radio'}
            name={inputName}
            aria-label={option?.label ?? '선택'}
            checked={checked}
            disabled={disabled}
            // radio 셀: 그룹 모드에서 재클릭(이미 선택) 은 onChange 가 발화하지 않으므로
            //   onClick 에서 토글 해제. 비그룹 radio 는 기존대로 해제 불가(onChange만).
            // checkbox 셀: onChange 경로(native toggle). onClick 불필요.
            onClick={
              isGrouped && cellType === 'radio' ? () => toggle(cell.id, !checked) : undefined
            }
            onChange={
              !isGrouped || cellType === 'checkbox'
                ? (e) => toggle(cell.id, e.target.checked)
                : undefined
            }
            // 그룹 radio 는 onChange 대신 onClick 으로 토글하므로 controlled checked 경고를
            // 막기 위해 readOnly 를 명시한다(onClick 동작에는 영향 없음).
            readOnly={isGrouped && cellType === 'radio'}
            className={cn(
              'h-4 w-4',
              checked && isPriorChoiceCell(cell.id) && PRIOR_HIGHLIGHT_CONTROL_CLS,
            )}
          />
          {labelText && (
            <span
              className={cn(
                'text-base whitespace-pre-line text-gray-800',
                getCellTextClassName(cell),
              )}
              style={getCellTextStyle(cell)}
            >
              <CellText text={labelText} html={resolveCellTextHtml(cell, attrs, quotes)} />
            </span>
          )}
        </label>
        {/* 셀 안 입력은 모바일 상세(카드·드릴다운) 경로 전용이다. 데스크톱 표는 열 폭이
            좁아 우겨넣어지므로 표 아래 OptionTextInputStack 한 줄로 뺀다. */}
        {isSelectedRowDetail && option?.allowTextInput && checked && (
          <OptionTextInput questionId={question.id} option={option} className="w-full" />
        )}
      </div>
    );
  };

  const showCounter = isCheckbox && (minSel !== undefined || maxSel !== undefined);

  const counter = showCounter ? (
    <div className="flex items-center justify-end gap-2 text-sm">
      <span className="text-gray-600">
        {maxSel !== undefined && maxSel > 0
          ? `${selectedIds.length}/${maxSel}개 선택됨`
          : `${selectedIds.length}개 선택됨`}
      </span>
      {!satisfiesMinSelections(selectedIds, minSel, isExclusiveChoiceCell) && (
        <span className="text-orange-600">최소 {minSel}개 이상 선택해주세요</span>
      )}
    </div>
  ) : null;

  /** 카드 모드의 선택 컨트롤 하나 — 단일 카드와 행 카드가 같은 토글 규칙을 쓴다. */
  const renderMobileChoiceInput = (choiceCell: TableCell, ariaLabel: string) => {
    const { checked, disabled } = getChoiceCellState(choiceCell);
    // 그룹별 선택 모드: name 을 그룹 키 단위로 분리
    const mobileInputName = isGrouped
      ? `${question.id}-${getGroupKeyOfCell(question, choiceCell.id)}`
      : question.id;
    // 모바일도 셀별 group type 결정
    const mobileCellType = isGrouped
      ? getGroupTypeOfCell(question, choiceCell.id)
      : isCheckbox
        ? 'checkbox'
        : 'radio';
    return (
      <input
        type={mobileCellType === 'checkbox' ? 'checkbox' : 'radio'}
        name={mobileInputName}
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        // radio 셀: 그룹 모드에서 재클릭 onClick 해제. checkbox 셀: onChange 경로.
        onClick={
          isGrouped && mobileCellType === 'radio'
            ? () => toggle(choiceCell.id, !checked)
            : undefined
        }
        onChange={
          !isGrouped || mobileCellType === 'checkbox'
            ? (e) => toggle(choiceCell.id, e.target.checked)
            : undefined
        }
        // 그룹 radio: onClick 토글 — controlled checked 경고 방지용 readOnly
        readOnly={isGrouped && mobileCellType === 'radio'}
        className={cn(
          'h-5 w-5',
          checked && isPriorChoiceCell(choiceCell.id) && PRIOR_HIGHLIGHT_CONTROL_CLS,
        )}
      />
    );
  };

  /**
   * 보기 셀의 축 라벨 — 행 하나에 보기 셀이 여럿일 때(열마다 하나씩 고르는 표) 각 컨트롤이
   * 어느 열 것인지 알려준다. 보기 그룹 라벨을 먼저 쓰고, 없으면 그 셀이 선 열의 헤더로 폴백.
   */
  const resolveChoiceAxisLabel = (row: TableRow, choiceCell: TableCell): string => {
    const group = (question.choiceGroups ?? []).find((g) => g.id === choiceCell.choiceGroupId);
    const groupLabel = (group?.label ?? '').trim();
    if (groupLabel) return substituteTokens(groupLabel, attrs, quotes);
    const colIndex = row.cells.findIndex((c) => c.id === choiceCell.id);
    const columnLabel = (question.tableColumns?.[colIndex]?.label ?? '').trim();
    return columnLabel ? substituteTokens(columnLabel, attrs, quotes) : '';
  };

  /**
   * 카드 모드. 기본(auto)은 보기 셀마다 카드 하나. perRow(행 단위 카드)는 행마다 카드 하나를
   * 만들고 안에 열별 컨트롤을 세로 타일로 둔다 — 열마다 하나씩 고르는 표에서 셀마다 카드를 내면
   * 같은 행 라벨의 카드가 열 수만큼 반복돼 어느 열 것인지 알 수 없다.
   */
  const renderMobileOptionCards = (
    perRow: boolean,
    rows: readonly TableRow[],
    /** 행 단위 그룹 카드 — 카드 안을 보기 그룹(축)별 섹션으로 나누고 구분 셀을 제목·설명으로 항상 보인다 */
    grouped = false,
  ) => (
    <div className={perRow && !grouped ? 'space-y-3' : 'space-y-2'}>
      {rows.flatMap((row) => {
        const choiceCells = row.cells.filter((c) => c.type === 'choice_opt' && !c.isHidden);
        // 보기 셀이 아닌 인터랙티브 셀(단답 input·선택형 컨트롤) — 행 단위 카드에서만 그린다.
        // 셀 단위 카드는 보기 셀마다 카드라 이 셀들이 설 자리가 없다(기존 동작 유지).
        // 게이팅 미충족 셀은 카드에서 통째로 뺀다 — 표와 달리 카드에는 빈 칸 자리가 없다.
        // 남은 값 정리는 저장 경계의 strip 이 맡는다(데스크톱은 ChoiceTableGatedCell 이 즉시 지운다).
        const controlCells = perRow
          ? row.cells.filter(
              (c) =>
                !c.isHidden &&
                (c.type === 'input' || CHOICE_TABLE_CONTROL_CELL_TYPES.has(c.type)) &&
                (!c.enabledWhen || isCellEnabled(c, optionTexts, gatingTableCells, selectedIdSet)),
            )
          : [];
        const renderControlCells = () =>
          controlCells.length > 0 ? (
            <div className="space-y-2">
              {controlCells.map((c) => (
                <div key={c.id}>{renderCell(c, true)}</div>
              ))}
            </div>
          ) : null;
        // 행 단위 카드: 이 행의 보기 중 상세기재가 켜진 것이 선택되면 그 입력 줄을 **카드 바로
        // 아래**에 둔다(카드 안도, 목록 맨 아래도 아니다 — 2026-09-11 결정). 데스크톱은 표 아래 한
        // 묶음이지만 카드에서는 어느 카드 것인지 바로 보여야 한다.
        const rowChoiceIds = new Set(choiceCells.map((c) => c.id));
        const rowTextEntries = perRow
          ? textInputEntries.filter((entry) => rowChoiceIds.has(entry.option.id))
          : [];
        const rowTextStack =
          rowTextEntries.length > 0 ? (
            <OptionTextInputStack
              key={`${row.id}-texts`}
              questionId={question.id}
              entries={rowTextEntries}
              // 카드는 좁아 "그룹 라벨 · 보기" 칩이 잘린다 — 칩을 위에, 입력칸을 아래에
              stackedLabel
            />
          ) : null;
        // 보기 셀 없이 input·선택형 셀만 있는 행(기타 상세 기재, 병역특례 여부 등) — 조건이
        // 참이 돼 보이는 행이므로 카드로 그린다. 제목은 header 지정 text 셀, 없으면 없음.
        if (perRow && choiceCells.length === 0 && controlCells.length > 0) {
          const headerCell = findMobileHeaderCell(row.cells);
          const headerText = headerCell ? (headerCell.content ?? '').trim() : '';
          return [
            <MobileOptionCard
              key={row.id}
              variant={grouped ? 'option' : 'section'}
              testId={`row-card-${row.id}`}
              label={
                headerText ? (
                  <span
                    className={getCellTextClassName(headerCell!)}
                    style={getCellTextStyle(headerCell!)}
                  >
                    <CellText
                      text={substituteTokens(headerText, attrs, quotes)}
                      html={resolveCellTextHtml(headerCell!, attrs, quotes)}
                    />
                  </span>
                ) : null
              }
              cells={row.cells}
              footer={renderControlCells()}
            />,
          ];
        }
        if (perRow && choiceCells.length >= 1) {
          // 행 카드는 header 지정이 없으면 첫 텍스트 셀(구분)을 제목으로 쓴다.
          // 명시적으로 숨긴 셀과 병합 연속 셀은 제목 후보에서 제외한다.
          const headerCell =
            findMobileHeaderCell(row.cells) ??
            row.cells.find(
              (c) =>
                c.type === 'text' &&
                !c.isHidden &&
                !c._isContinuation &&
                c.mobileDisplay !== 'hidden' &&
                (c.content ?? '').trim() !== '',
            );
          const headerText = headerCell ? (headerCell.content ?? '').trim() : '';
          const firstOption = optionByValue.get(choiceCells[0]!.id);
          const cardLabel = headerText
            ? substituteTokens(headerText, attrs, quotes)
            : (firstOption?.label ?? '(라벨 없음)');
          const labelStyleSource =
            headerText && headerCell ? headerCell : (firstOption ?? choiceCells[0]!);
          const anyChecked = choiceCells.some((c) => getChoiceCellState(c).checked);
          const allDisabled = choiceCells.every((c) => getChoiceCellState(c).disabled);
          // 그룹 카드의 제목 — 구분 셀 첫 줄은 제목, 나머지 줄은 설명(작은 회색)으로 항상 보인다.
          const breakAt = grouped ? cardLabel.indexOf('\n') : -1;
          const groupedTitle = breakAt === -1 ? cardLabel : cardLabel.slice(0, breakAt);
          const groupedDesc = breakAt === -1 ? '' : cardLabel.slice(breakAt + 1).trim();
          return [
            <MobileOptionCard
              key={row.id}
              variant={grouped ? 'option' : 'section'}
              testId={`row-card-${row.id}`}
              label={
                grouped ? (
                  <span
                    className={getCellTextClassName(labelStyleSource)}
                    style={getCellTextStyle(labelStyleSource)}
                  >
                    <span>{groupedTitle}</span>
                    {groupedDesc && (
                      <span className="mt-1 block text-[13px] leading-snug font-normal whitespace-pre-line text-gray-500">
                        {groupedDesc}
                      </span>
                    )}
                  </span>
                ) : (
                  <span
                    className={getCellTextClassName(labelStyleSource)}
                    style={getCellTextStyle(labelStyleSource)}
                  >
                    <CellText
                      text={cardLabel}
                      html={
                        headerText && headerCell
                          ? resolveCellTextHtml(headerCell, attrs, quotes)
                          : undefined
                      }
                    />
                  </span>
                )
              }
              // 제목으로 쓴 구분 셀은 표시 셀 목록에서 뺀다 — 모바일 표시가 '표시'로 켜져 있으면
              // 제목과 본문에 같은 내용이 두 번 나온다.
              cells={headerCell ? row.cells.filter((c) => c !== headerCell) : row.cells}
              selected={anyChecked}
              disabled={allDisabled}
              footer={
                <div className="space-y-2">
                  {/* 답변 영역 — 설명(표시 셀)과 구분선으로 나누고, 보기마다 테두리 칸으로 그려
                      선택하면 칠한다. 맨몸 체크박스 줄을 설명 아래에 그냥 늘어놓으면 설명의
                      일부처럼 읽혀 어색했다. 칸 하나가 통째로 탭 영역이다. */}
                  {grouped ? (
                    // 그룹별 섹션 — 축 이름 제목 + 그 그룹의 보기 타일(라벨은 보기 텍스트).
                    // 같은 행에 그룹이 없는 셀(미소속)은 마지막 섹션(제목 없음)으로 모은다.
                    <div className="space-y-3 border-t border-gray-100 pt-3">
                      {groupChoiceCellsByGroup(choiceCells).map(({ groupId, cells }) => {
                        const group = (question.choiceGroups ?? []).find((g) => g.id === groupId);
                        const sectionLabel = resolveChoiceGroupSectionLabel(
                          group?.label ? substituteTokens(group.label, attrs, quotes) : '',
                          headerText ? substituteTokens(headerText, attrs, quotes) : '',
                          resolveChoiceAxisLabel(row, cells[0]!),
                        );
                        // 「다음」을 누른 뒤 미충족 필수 그룹은 섹션을 붉게 두른다 — 데스크톱 표의
                        // 보기 그룹 외곽선과 같은 판정(unfilledGroupCellIds)이라 어긋나지 않는다.
                        const unfilled = cells.some((c) => unfilledGroupCellIds.has(c.id));
                        return (
                          <div
                            key={groupId ?? '__none__'}
                            data-testid={`choice-group-section-${groupId ?? 'none'}`}
                            className={cn(
                              'space-y-1.5',
                              unfilled && 'rounded-lg border border-red-300 bg-red-50/40 p-2',
                            )}
                          >
                            {sectionLabel && (
                              <p
                                className={cn(
                                  'text-[13px] font-semibold',
                                  unfilled ? 'text-red-600' : 'text-gray-600',
                                )}
                              >
                                {sectionLabel}
                              </p>
                            )}
                            {/* 타일은 세로 한 줄씩 — 가로로 접으면 휴대폰 폭에서 2열이 되어 척도
                                순서(전혀 필요 없음 → 매우 필요함)가 지그재그로 읽힌다. */}
                            <div className="flex flex-col gap-2">
                              {cells.map((choiceCell) => {
                                const { checked, disabled, option } =
                                  getChoiceCellState(choiceCell);
                                const tileLabel = option?.label ?? '';
                                return (
                                  <label
                                    key={choiceCell.id}
                                    data-cell-id={choiceCell.id}
                                    className={cn(
                                      'flex min-h-10 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-1.5 text-[15px] transition-colors',
                                      checked
                                        ? 'border-blue-300 bg-blue-50 text-blue-900'
                                        : 'border-gray-200 bg-white text-gray-800',
                                      disabled && 'cursor-default opacity-50',
                                    )}
                                  >
                                    {renderMobileChoiceInput(choiceCell, tileLabel || cardLabel)}
                                    {tileLabel && <span className="leading-snug">{tileLabel}</span>}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {choiceCells.map((choiceCell) => {
                        const { checked, disabled, option } = getChoiceCellState(choiceCell);
                        // 같은 그룹의 척도 보기들이 한 행에 있으면 그룹명 반복 대신 보기 문구로 구분한다.
                        const sameGroupCount = choiceCells.filter(
                          (c) => c.choiceGroupId === choiceCell.choiceGroupId,
                        ).length;
                        const axisLabel =
                          sameGroupCount > 1
                            ? option?.label ?? ''
                            : resolveChoiceAxisLabel(row, choiceCell);
                        // 「다음」을 누른 뒤 답하지 않은 필수 그룹의 타일은 붉게 — 데스크톱 표의 보기
                        // 그룹 외곽선·그룹 카드 섹션과 같은 판정(unfilledGroupCellIds).
                        const unfilled = !checked && unfilledGroupCellIds.has(choiceCell.id);
                        return (
                          <label
                            key={choiceCell.id}
                            data-cell-id={choiceCell.id}
                            data-unfilled={unfilled || undefined}
                            className={cn(
                              'flex min-w-0 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors',
                              checked
                                ? 'border-blue-300 bg-blue-50 text-blue-900'
                                : unfilled
                                  ? 'border-red-300 bg-red-50/40 text-gray-800'
                                  : 'border-gray-200 bg-white text-gray-800',
                              disabled && 'cursor-default opacity-50',
                            )}
                          >
                            <span className="mt-0.5 flex shrink-0 items-center">
                              {renderMobileChoiceInput(choiceCell, axisLabel || cardLabel)}
                            </span>
                            {axisLabel && (
                              <span className="block min-w-0 flex-1 text-[15px] leading-snug font-semibold whitespace-pre-line">
                                {axisLabel}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {/* 보기 옵션의 상세기재는 카드 안이 아니라 카드 바로 아래 스택에 —
                      셀 게이팅 입력칸과 한곳에 섞이지 않는다. */}
                  {renderControlCells()}
                </div>
              }
            />,
            rowTextStack,
          ];
        }
        const perChoiceCards = choiceCells.map((choiceCell) => {
          const { checked, disabled, option } = getChoiceCellState(choiceCell);
          // 카드 제목: 행에 'header' 로 지정된 text 셀이 있으면 그 내용을 제목으로 사용하고,
          // 없으면 선택지 라벨(choiceLabel > content)로 폴백한다. exportLabel 은 제목으로 쓰지 않는다.
          const headerCell = findMobileHeaderCell(row.cells);
          const headerText = headerCell ? (headerCell.content ?? '').trim() : '';
          const cardLabel = headerText
            ? substituteTokens(headerText, attrs, quotes)
            : (option?.label ?? '(라벨 없음)');
          const labelStyleSource = headerText && headerCell ? headerCell : (option ?? choiceCell);
          return (
            <MobileOptionCard
              key={choiceCell.id}
              label={
                <span
                  className={getCellTextClassName(labelStyleSource)}
                  style={getCellTextStyle(labelStyleSource)}
                >
                  <CellText
                    text={cardLabel}
                    html={
                      headerText && headerCell
                        ? resolveCellTextHtml(headerCell, attrs, quotes)
                        : undefined
                    }
                  />
                </span>
              }
              cells={row.cells}
              selected={checked}
              disabled={disabled}
              onToggle={() => toggle(choiceCell.id, !checked)}
              control={renderMobileChoiceInput(choiceCell, cardLabel)}
              footer={
                (!perRow && option?.allowTextInput && checked) || controlCells.length > 0 ? (
                  <div className="space-y-2">
                    {/* 행 단위 카드는 상세기재를 카드 바로 아래 스택으로 뺀다.
                          셀 단위 카드는 카드가 곧 보기라 그 자리에 둔다. */}
                    {!perRow && option?.allowTextInput && checked ? (
                      <OptionTextInput
                        questionId={question.id}
                        option={option}
                        className="w-full"
                      />
                    ) : null}
                    {renderControlCells()}
                  </div>
                ) : null
              }
            />
          );
        });
        return [...perChoiceCards, rowTextStack];
      })}
      {counter}
    </div>
  );

  /**
   * 축 단위 카드 — 보기 그룹(축)마다 카드 하나, 카드 안에 그 축에 셀이 있는 행을 타일로 나열한다.
   *
   * 행 단위 카드는 "행마다 여러 축을 하나씩 고르는 표"용이라, 축마다 독립된 다중 선택인데 행
   * 목록만 공유하는 표(현재 활용 / 활용 계획)에서는 행마다 모든 축에 답해야 하는 것처럼 읽힌다.
   * 여기서는 축이 곧 카드라 "이 카드에서 하나 이상" 으로 읽힌다 (CONTEXT.md "축 단위 카드").
   *
   * - 카드 제목은 그 그룹의 셀이 놓인 열의 헤더(비면 그룹 라벨). 데스크톱 표와 같은 글자다.
   *   그룹 라벨은 SPSS 변수 라벨 접두를 겸해 길게 짓는 일이 많아 제목으로 쓰지 않는다.
   * - 카드 머리는 그 카드를 지나는 동안 화면 위에 고정된다 — 카드 하나가 화면 몇 장 길이라
   *   중간에서는 지금 어느 축을 고르는지 놓친다. 타일에 축 이름을 접미로 붙이지는 않는다
   *   (긴 라벨 반복이 행 카드의 어색함을 되살린다).
   * - 타일 라벨은 행 제목 셀(header 지정 → 첫 텍스트 셀), 나머지 표시 셀은 모바일 셀 표시 설정
   *   그대로다. 설명이 두 카드에 반복되는 것은 빌더가 그 셀을 숨겨서 조절한다.
   * - 미충족 필수 그룹은 카드째 붉게 두르고 그 그룹의 필수 문구(→ 문항 → 기본)를 머리에 붙인다.
   * - 보기 셀이 아닌 인터랙티브 셀(input·선택형)은 축이 없어 이 모드에서는 그리지 않는다.
   */
  const renderAxisCards = () => {
    const columnLabelByCellId = new Map<string, string>();
    for (const row of question.tableRowsData ?? []) {
      row.cells.forEach((cell, idx) => {
        const label = (question.tableColumns?.[idx]?.label ?? '').trim();
        if (label) columnLabelByCellId.set(cell.id, label);
      });
    }
    const visibleRows = rowWiseLayout.conditionalRows;
    const resolveRowTitleCell = (row: TableRow): TableCell | undefined =>
      findMobileHeaderCell(row.cells) ??
      row.cells.find(
        (c) =>
          c.type === 'text' &&
          !c.isHidden &&
          !c._isContinuation &&
          c.mobileDisplay !== 'hidden' &&
          (c.content ?? '').trim() !== '',
      );

    return (
      <div className="space-y-3">
        {collectChoiceGroups(question).map((group) => {
          const groupId = group.cells[0]?.choiceGroupId ?? 'none';
          const columnLabel = group.cells
            .map((c) => columnLabelByCellId.get(c.id) ?? '')
            .find((label) => label !== '');
          const rawTitle = columnLabel || group.label.trim();
          const title = rawTitle ? substituteTokens(rawTitle, attrs, quotes) : '';
          const unfilled = group.cells.some((c) => unfilledGroupCellIds.has(c.id));
          const requiredMessage = group.requiredMessage?.trim() || resolveRequiredMessage(question);
          const memberIds = new Set(group.cells.map((c) => c.id));
          return (
            <div key={groupId}>
              <MobileSectionCard
                testId={`axis-card-${groupId}`}
                headerTestId="axis-card-header"
                title={title}
                errorMessage={unfilled ? requiredMessage : undefined}
              >
                {visibleRows.flatMap((row) => {
                  const cellsInGroup = row.cells.filter(
                    (c) => c.type === 'choice_opt' && !c.isHidden && memberIds.has(c.id),
                  );
                  if (cellsInGroup.length === 0) return [];
                  const titleCell = resolveRowTitleCell(row);
                  const rowTitle = titleCell
                    ? substituteTokens((titleCell.content ?? '').trim(), attrs, quotes)
                    : '';
                  const displayCells = row.cells.filter((c) => c !== titleCell);
                  return cellsInGroup.map((choiceCell) => {
                    const { checked, disabled, option } = getChoiceCellState(choiceCell);
                    const optionLabel = option?.label ?? '';
                    // 한 행에 같은 축의 셀이 둘 이상이면(그룹이 여러 열에 걸침) 보기 텍스트로 구분
                    const tileLabel =
                      rowTitle && cellsInGroup.length > 1 && optionLabel
                        ? `${rowTitle} · ${optionLabel}`
                        : rowTitle || optionLabel || '(라벨 없음)';
                    const labelStyleSource = titleCell ?? option ?? choiceCell;
                    return (
                      <div key={choiceCell.id}>
                        <label
                          data-cell-id={choiceCell.id}
                          className={cn(
                            'flex min-w-0 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors',
                            checked
                              ? 'border-blue-300 bg-blue-50 text-blue-900'
                              : 'border-gray-200 bg-white text-gray-800',
                            disabled && 'cursor-default opacity-50',
                          )}
                        >
                          <span className="mt-0.5 flex shrink-0 items-center">
                            {renderMobileChoiceInput(choiceCell, tileLabel)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                'block text-[15px] leading-snug font-semibold whitespace-pre-line',
                                getCellTextClassName(labelStyleSource),
                              )}
                              style={getCellTextStyle(labelStyleSource)}
                            >
                              <CellText
                                text={tileLabel}
                                html={
                                  titleCell && cellsInGroup.length === 1
                                    ? resolveCellTextHtml(titleCell, attrs, quotes)
                                    : undefined
                                }
                              />
                            </span>
                            <MobileDisplayCells cells={displayCells} className="mt-1" />
                          </span>
                        </label>
                        {option?.allowTextInput && checked && (
                          <div className="mt-2">
                            <OptionTextInput
                              questionId={question.id}
                              option={option}
                              className="w-full"
                            />
                          </div>
                        )}
                      </div>
                    );
                  });
                })}
              </MobileSectionCard>
              {/* 미충족 카드 바로 아래에 검증 안내 상자 — 문항 아래 상자와 같은 컴포넌트라 모양·이동
                규칙이 같고, 「다음」의 착지 표식(data-validation-notice)도 여기 붙는다. 이 모드에서는
                문항 아래 상자를 내지 않는다(group-step-item) — 마지막 카드 아래에 둘이 겹친다. */}
              {unfilled && (
                <ValidationIssueBanner
                  items={[{ message: requiredMessage, cellIds: group.cells.map((c) => c.id) }]}
                  questionId={question.id}
                />
              )}
            </div>
          );
        })}
        {counter}
      </div>
    );
  };

  const mobileMode = resolveMobileTableDisplayMode(question);
  /**
   * 표 격자 두 벌.
   * - `conditional` — 행·열 표시조건만 적용한 것. **데스크톱 표가 쓴다.** 여태 이 계산이
   *   모바일 분기에서만 돌아, 데스크톱은 tableRowsData 를 가공 없이 넘기며 행·열 조건을
   *   통째로 무시했다.
   * - 나머지 — 거기에 동적 행 선택까지 반영한 것. 모바일 경로가 쓴다.
   *
   * 두 벌을 한 memo 에서 낸다. 조건 투영을 별도 memo 로 떼면 React Compiler 가 이
   * 컴포넌트의 수동 메모이제이션을 보존하지 못한다(preserve-manual-memoization 경고).
   */
  const rowWiseOriginalModel = useMemo(() => {
    if (mobileMode !== 'row-wise-original') return { sections: [] };
    const columns = question.tableColumns ?? [];
    const rows = question.tableRowsData ?? [];
    const model = buildMobileRowWiseOriginalModel({
      authoredColumns: columns,
      authoredRows: rows,
      visibleColumns: rowWiseLayout.columns,
      ...(rowWiseLayout.headerGrid ? { visibleHeaderGrid: rowWiseLayout.headerGrid } : {}),
      displayRows: rowWiseLayout.rows,
      hideColumnLabels: question.hideColumnLabels ?? false,
      settings: {
        omitLeadingAuthoredColumns: question.mobileDrilldownOmitLeadingColumns ?? 1,
        repeatHeaderStartRow: question.mobileDrilldownRepeatHeaderStartRow,
        repeatHeaderEndRow: question.mobileDrilldownRepeatHeaderEndRow,
      },
      // 보기 셀만 세면 input 셀(기타 상세 기재)이나 선택형 셀만 든 행이 라벨 행으로
      // 분류돼 통째로 빠진다 — 그 셀들은 d4212acf 이후 이 표에서도 인터랙티브다.
      answerableCellTypes: CHOICE_TABLE_ROW_WISE_ANSWERABLE_TYPES,
      resolveChoiceLabel,
      isLabelSourceHidden: (cellId) =>
        rows.some((row) =>
          row.cells.some((cell) => cell.id === cellId && cell.mobileDisplay === 'hidden'),
        ),
    });
    return {
      sections: model.sections.map((section) => ({
        ...section,
        label: substituteTokens(section.label, attrs, quotes),
        subgroups: section.subgroups.map((subgroup) => ({
          ...subgroup,
          label: substituteTokens(subgroup.label, attrs, quotes),
          questions: subgroup.questions.map((rowQuestion) => ({
            ...rowQuestion,
            title: substituteTokens(rowQuestion.title, attrs, quotes),
          })),
        })),
      })),
    };
  }, [attrs, quotes, mobileMode, question, resolveChoiceLabel, rowWiseLayout]);

  const confirmDynamicRows = (rowIds: string[]) => {
    if (!activeDynamicGroupId || !onDynamicRowSelectionChange) return;
    const groupRowIds = new Set(
      (question.tableRowsData ?? [])
        .filter((row) => row.dynamicGroupId === activeDynamicGroupId)
        .map((row) => row.id),
    );
    const otherSelections = selectedDynamicRowIds.filter((rowId) => !groupRowIds.has(rowId));
    onDynamicRowSelectionChange([...new Set([...otherSelections, ...rowIds])]);
  };

  /**
   * 데스크톱 표. rowWiseLayout 선언 **뒤에** 둔다 — 훅보다 앞에 두면 React Compiler 가
   * 이 컴포넌트의 수동 메모이제이션을 보존하지 못해 최적화를 통째로 건너뛴다.
   */
  const renderOriginalTable = () => (
    <div className="space-y-2">
      <TablePreview
        cellOutlineEdges={groupOutline}
        {...(question.tableTitle !== undefined ? { tableTitle: question.tableTitle } : {})}
        columns={rowWiseLayout.columns}
        rows={rowWiseLayout.conditionalRows}
        {...(rowWiseLayout.headerGrid ? { tableHeaderGrid: rowWiseLayout.headerGrid } : {})}
        {...(question.hideColumnLabels !== undefined
          ? { hideColumnLabels: question.hideColumnLabels }
          : {})}
        {...(question.stickyColumnCount !== undefined
          ? { stickyColumnCount: question.stickyColumnCount }
          : {})}
        applyCellBackground={!isMobile}
        renderCell={(cell) => renderCell(cell)}
      />
      <OptionTextInputStack questionId={question.id} entries={tableBelowEntries} />
      {counter}
    </div>
  );

  const renderSelectedRowCell = (cell: TableCell, inputIdScope?: string) =>
    renderCell(cell.mobileDisplay === 'hidden' ? blankCellContent(cell) : cell, true, inputIdScope);

  if (isMobile && mobileMode === 'row-wise-original') {
    return (
      <div className="space-y-2">
        {rowWiseLayout.configs.length > 0 && onDynamicRowSelectionChange ? (
          <div className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {rowWiseLayout.configs.map((config) => {
              const selectedCount = selectedDynamicRowIds.filter((rowId) =>
                rowWiseLayout.dynamicRows.some(
                  (row) => row.id === rowId && row.dynamicGroupId === config.groupId,
                ),
              ).length;
              return (
                <button
                  key={config.groupId}
                  type="button"
                  className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left hover:bg-gray-50"
                  onClick={() => setActiveDynamicGroupId(config.groupId)}
                >
                  <ListChecks className="h-4 w-4 shrink-0 text-gray-500" />
                  <span className="flex-1 text-sm font-medium text-gray-700">
                    {config.label || '항목 선택'}
                  </span>
                  <span className="text-xs text-gray-500">{selectedCount}개 선택</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                </button>
              );
            })}
          </div>
        ) : null}
        <MobileRowWiseOriginalSheet
          model={rowWiseOriginalModel}
          // 데스크톱 표의 미충족 그룹 덩어리 외곽선과 같은 판정 — 행별 표에서는 그 그룹의
          // 셀을 하나씩 붉게 두르고 행 제목도 붉힌다. 문항 전체만 붉어지면 어느 열이 비었는지
          // 알 수 없다.
          {...(unfilledGroupCellIds.size > 0 ? { errorCellIds: unfilledGroupCellIds } : {})}
          choiceControlType={(cell) =>
            isGrouped
              ? getGroupTypeOfCell(question, cell.id)
              : question.type === 'checkbox'
                ? 'checkbox'
                : 'radio'
          }
          renderCell={(cell, _question, inputIdScope) => renderSelectedRowCell(cell, inputIdScope)}
        />
        {counter}
        {activeDynamicGroupId ? (
          <DynamicRowSelectorModal
            open
            onOpenChange={(open) => {
              if (!open) setActiveDynamicGroupId(null);
            }}
            dynamicRows={rowWiseLayout.dynamicRows.filter(
              (row) => row.dynamicGroupId === activeDynamicGroupId,
            )}
            selectedRowIds={selectedDynamicRowIds.filter((rowId) =>
              rowWiseLayout.dynamicRows.some(
                (row) => row.id === rowId && row.dynamicGroupId === activeDynamicGroupId,
              ),
            )}
            label={
              rowWiseLayout.configs.find((config) => config.groupId === activeDynamicGroupId)?.label
            }
            onConfirm={confirmDynamicRows}
          />
        ) : null}
      </div>
    );
  }

  if (isMobile && mobileMode === 'drilldown-original-row') {
    return (
      <ChoiceTableDrilldown
        question={question}
        selectedIds={selectedIds}
        renderChoiceCell={renderSelectedRowCell}
        resolveChoiceLabel={resolveChoiceLabel}
        counter={counter}
      />
    );
  }

  if (isMobile && mobileMode === 'axis-cards') {
    return renderAxisCards();
  }

  if (
    isMobile &&
    (mobileMode === 'auto' || mobileMode === 'row-cards' || mobileMode === 'row-group-cards')
  ) {
    // 행 단위 카드는 행·열 표시 조건을 적용한 행을 쓴다 — 조건이 참이 된 행(병역특례 여부·
    // 기타 상세 기재)이 카드로 나와야 한다. 자동 카드는 도입 전 동작(전 행) 그대로 둔다.
    const perRow = mobileMode !== 'auto';
    return renderMobileOptionCards(
      perRow,
      perRow ? rowWiseLayout.conditionalRows : (question.tableRowsData ?? []),
      mobileMode === 'row-group-cards',
    );
  }

  return renderOriginalTable();
}
