'use client';

import { type ReactNode, useCallback, useMemo, useState } from 'react';

import { ChevronRight, ListChecks } from 'lucide-react';

import { DynamicRowSelectorModal } from '@/components/survey-builder/dynamic-row-selector-modal';
import { TablePreview } from '@/components/survey-builder/table-preview';
import { MobileRowWiseOriginalSheet } from '@/components/survey-builder/mobile-row-wise-original-sheet';
import { useMobileView } from '@/hooks/use-media-query';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { Question, TableCell } from '@/types/survey';
import {
  type GroupedChoiceAnswer,
  getGroupKeyOfCell,
  getGroupTypeOfCell,
  isGroupedChoiceQuestion,
} from '@/utils/choice-group-helpers';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';
import { projectConditionalTableLayout } from '@/utils/conditional-table-layout';
import { findMobileHeaderCell } from '@/utils/mobile-display-cells';
import { resolveMobileTableDisplayMode } from '@/utils/mobile-table-display-mode';
import { buildMobileRowWiseOriginalModel } from '@/utils/mobile-row-wise-original';
import { shouldDisplayDynamicGroup } from '@/utils/branch-logic';
import { recalculateRowspansForVisibleRows } from '@/utils/table-merge-helpers';

import { ChoiceTableDrilldown } from './choice-table-drilldown';
import { MobileOptionCard } from './mobile-card-shared';
import { OptionTextInput } from './option-text-input';

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
}

/**
 * 테이블 내장 radio/checkbox(Case A) 응답 렌더.
 * - 데스크톱: tableRowsData 의 choice_opt 셀만 인터랙티브 input 으로 바꾼 TablePreview
 * - 모바일: 행마다 MobileOptionCard (라벨 + 표시 셀 + 체크/라디오 컨트롤)
 * 응답은 일반 radio/checkbox shape(radio=cell.id | null, checkbox=cell.id[])로 저장한다.
 */
export function ChoiceTableResponse({
  question,
  value,
  onChange,
  allResponses,
  allQuestions,
  ignoreDisplayConditions = false,
  selectedDynamicRowIds = [],
  onDynamicRowSelectionChange,
}: ChoiceTableResponseProps) {
  const isCheckbox = question.type === 'checkbox';
  // 그룹별 선택 모드 여부 — radio 또는 checkbox 그룹이 1개 이상 정의된 경우 true.
  // isCheckbox 가드를 제거하여 checkbox 질문도 grouped 경로를 밟을 수 있게 한다.
  const isGrouped = isGroupedChoiceQuestion(question);
  const isMobile = useMobileView();
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
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
  const isMaxSelectionReached =
    isCheckbox && maxSel !== undefined && maxSel > 0 && selectedIds.length >= maxSel;

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
          // 체크 추가
          next = [...arr, cellId];
        }
        if (next.length === 0) {
          const { [groupKey]: _removed, ...rest } = map;
          onChange(rest as GroupedChoiceAnswer);
        } else {
          onChange({ ...map, [groupKey]: next });
        }
        return;
      }

      // radio 그룹: 같은 그룹 내에서 교체, 재클릭 시 해제(키 삭제)
      if (map[groupKey] === cellId) {
        // 재클릭 해제 — 해당 키 삭제
        const { [groupKey]: _removed, ...rest } = map;
        onChange(rest as GroupedChoiceAnswer);
      } else {
        onChange({ ...map, [groupKey]: cellId });
      }
      return;
    }
    if (!isCheckbox) {
      onChange(checked ? cellId : null);
      return;
    }
    let next = selectedIds.slice();
    if (checked) {
      if (maxSel !== undefined && maxSel > 0 && next.length >= maxSel) return;
      next.push(cellId);
    } else {
      next = next.filter((id) => id !== cellId);
    }
    onChange(next);
  };

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
      disabled: isMaxSelectionReached && !checked,
      option: optionByValue.get(cell.id),
    };
  };

  const renderCell = (
    cell: TableCell,
    isSelectedRowDetail = false,
    inputIdScope?: string,
  ): ReactNode => {
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
            className="h-4 w-4"
          />
          {labelText && (
            <span
              className={cn('whitespace-pre-line text-sm text-gray-800', getCellTextClassName(cell))}
              style={getCellTextStyle(cell)}
            >
              {labelText}
            </span>
          )}
        </label>
        {option?.allowTextInput && checked && (
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
      {minSel !== undefined && minSel > 0 && selectedIds.length < minSel && (
        <span className="text-orange-600">최소 {minSel}개 이상 선택해주세요</span>
      )}
    </div>
  ) : null;

  const renderMobileOptionCards = () => (
    <div className="space-y-2">
      {(question.tableRowsData ?? []).flatMap((row) =>
        row.cells
          .filter((c) => c.type === 'choice_opt' && !c.isHidden)
          .map((choiceCell) => {
            const { checked, disabled, option } = getChoiceCellState(choiceCell);
            // 카드 제목: 행에 'header' 로 지정된 text 셀이 있으면 그 내용을 제목으로 사용하고,
            // 없으면 선택지 라벨(choiceLabel > content)로 폴백한다. exportLabel 은 제목으로 쓰지 않는다.
            const headerCell = findMobileHeaderCell(row.cells);
            const headerText = headerCell ? (headerCell.content ?? '').trim() : '';
            const cardLabel = headerText
              ? substituteTokens(headerText, attrs, quotes)
              : (option?.label ?? '(라벨 없음)');
            const labelStyleSource = headerText && headerCell ? headerCell : (option ?? choiceCell);
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
              <MobileOptionCard
                key={choiceCell.id}
                label={(
                  <span
                    className={getCellTextClassName(labelStyleSource)}
                    style={getCellTextStyle(labelStyleSource)}
                  >
                    {cardLabel}
                  </span>
                )}
                cells={row.cells}
                selected={checked}
                disabled={disabled}
                onToggle={() => toggle(choiceCell.id, !checked)}
                control={
                  <input
                    type={mobileCellType === 'checkbox' ? 'checkbox' : 'radio'}
                    name={mobileInputName}
                    aria-label={cardLabel}
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
                    className="h-5 w-5"
                  />
                }
                footer={
                  option?.allowTextInput && checked ? (
                    <OptionTextInput questionId={question.id} option={option} className="w-full" />
                  ) : null
                }
              />
            );
          }),
      )}
      {counter}
    </div>
  );

  const renderOriginalTable = () => (
    <div className="space-y-2">
      <TablePreview
        {...(question.tableTitle !== undefined ? { tableTitle: question.tableTitle } : {})}
        {...(question.tableColumns !== undefined ? { columns: question.tableColumns } : {})}
        {...(question.tableRowsData !== undefined ? { rows: question.tableRowsData } : {})}
        {...(question.tableHeaderGrid ? { tableHeaderGrid: question.tableHeaderGrid } : {})}
        {...(question.hideColumnLabels !== undefined
          ? { hideColumnLabels: question.hideColumnLabels }
          : {})}
        applyCellBackground={!isMobile}
        renderCell={(cell) => renderCell(cell)}
      />
      {counter}
    </div>
  );

  const mobileMode = resolveMobileTableDisplayMode(question);
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
          if (
            row.showWhenDynamicGroupId &&
            visibleGroupIds.has(row.showWhenDynamicGroupId)
          ) {
            return selectedGroupIds.has(row.showWhenDynamicGroupId);
          }
          return true;
        })
        .map((row) => row.id),
    );
    return {
      columns: conditionalLayout.columns,
      rows: recalculateRowspansForVisibleRows(conditionalLayout.rows, visibleRowIds),
      headerGrid: conditionalLayout.headerGrid,
      configs: visibleConfigs,
      dynamicRows: conditionalLayout.rows.filter(
        (row) => row.dynamicGroupId && visibleGroupIds.has(row.dynamicGroupId),
      ),
    };
  }, [allQuestions, allResponses, question, selectedDynamicRowIds, ignoreDisplayConditions]);
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
      answerableCellTypes: ['choice_opt'],
      resolveChoiceLabel,
      isLabelSourceHidden: (cellId) =>
        rows.some((row) =>
          row.cells.some(
            (cell) => cell.id === cellId && cell.mobileDisplay === 'hidden',
          ),
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

  const renderSelectedRowCell = (cell: TableCell, inputIdScope?: string) =>
    renderCell(
      cell.mobileDisplay === 'hidden' ? { ...cell, content: '' } : cell,
      true,
      inputIdScope,
    );

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
          choiceControlType={(cell) =>
            isGrouped
              ? getGroupTypeOfCell(question, cell.id)
              : question.type === 'checkbox'
                ? 'checkbox'
                : 'radio'
          }
          renderCell={(cell, _question, inputIdScope) =>
            renderSelectedRowCell(cell, inputIdScope)
          }
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
                (row) =>
                  row.id === rowId && row.dynamicGroupId === activeDynamicGroupId,
              ),
            )}
            label={
              rowWiseLayout.configs.find(
                (config) => config.groupId === activeDynamicGroupId,
              )?.label
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

  if (isMobile && mobileMode === 'auto') return renderMobileOptionCards();

  return renderOriginalTable();
}
