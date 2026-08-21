'use client';

import { type ReactNode, useMemo, useRef } from 'react';

import {
  type DrilldownStatus,
  MobileDrilldownShell,
} from '@/features/question-renderer/mobile-drilldown-shell';
import { MobileOriginalRowTable } from '@/features/question-renderer/mobile-original-row-table';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import type { Question, TableCell } from '@/types/survey';
import {
  DEFAULT_GROUP_KEY,
  collectChoiceGroups,
  getGroupTypeOfCell,
  isGroupedChoiceQuestion,
} from '@/utils/choice-group-helpers';
import { type ClassifiedLeaf, type ClassifiedSection, classifyTable } from '@/features/question-renderer/utils/classify-table';
import {
  excludeMobileDrilldownRepeatedRows,
  getMobileDrilldownRepeatedBodyRowIds,
  includesMobileDrilldownColumnHeader,
  resolveMobileDrilldownRepeatHeaderRange,
} from '@/utils/mobile-drilldown-repeat-header';
import {
  getMobileOriginalRowLabelCandidate,
  projectMobileOriginalRow,
} from '@/features/question-renderer/utils/mobile-original-row';
import { clampMobileDrilldownOmitLeadingColumns } from '@/utils/mobile-table-display-mode';

const EMPTY_COLUMNS: NonNullable<Question['tableColumns']> = [];
const EMPTY_ROWS: NonNullable<Question['tableRowsData']> = [];

interface ChoiceTableDrilldownProps {
  question: Question;
  selectedIds: string[];
  renderChoiceCell: (cell: TableCell) => ReactNode;
  resolveChoiceLabel: (cellId: string) => string | undefined;
  counter: ReactNode;
}

export function ChoiceTableDrilldown({
  question,
  selectedIds,
  renderChoiceCell,
  resolveChoiceLabel,
  counter,
}: ChoiceTableDrilldownProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const columns = question.tableColumns ?? EMPTY_COLUMNS;
  const rows = question.tableRowsData ?? EMPTY_ROWS;
  const repeatHeaderRange = useMemo(
    () =>
      resolveMobileDrilldownRepeatHeaderRange({
        mobileDrilldownRepeatHeaderStartRow: question.mobileDrilldownRepeatHeaderStartRow,
        mobileDrilldownRepeatHeaderEndRow: question.mobileDrilldownRepeatHeaderEndRow,
        hideColumnLabels: question.hideColumnLabels,
      }),
    [
      question.hideColumnLabels,
      question.mobileDrilldownRepeatHeaderEndRow,
      question.mobileDrilldownRepeatHeaderStartRow,
    ],
  );
  const repeatedBodyRowIds = useMemo(
    () => getMobileDrilldownRepeatedBodyRowIds(rows, repeatHeaderRange),
    [repeatHeaderRange, rows],
  );
  const navigationRows = useMemo(
    () => excludeMobileDrilldownRepeatedRows(rows, repeatedBodyRowIds),
    [repeatedBodyRowIds, rows],
  );
  const includeColumnHeader = includesMobileDrilldownColumnHeader(repeatHeaderRange);
  const omit = clampMobileDrilldownOmitLeadingColumns(
    question.mobileDrilldownOmitLeadingColumns,
    columns.length,
  );
  const detailRowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const navigationRowById = useMemo(
    () => new Map(navigationRows.map((row) => [row.id, row])),
    [navigationRows],
  );
  const cellById = useMemo(
    () => new Map(rows.flatMap((row) => row.cells.map((cell) => [cell.id, cell] as const))),
    [rows],
  );
  const sections = useMemo(
    () =>
      classifyTable({
        tableColumns: columns,
        tableRowsData: navigationRows,
        tableHeaderGrid: question.tableHeaderGrid,
        answerableCellTypes: ['choice_opt'],
      }),
    [columns, navigationRows, question.tableHeaderGrid],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const titledSections = useMemo(
    () =>
      sections.map((section) => {
        const leaves = section.leaves.map((leaf) => {
          const row = detailRowById.get(leaf.rowId);
          if (!row) return leaf;
          const labelCandidate = getMobileOriginalRowLabelCandidate({
            authoredColumns: columns,
            row,
            omitLeadingAuthoredColumns: omit,
            resolveChoiceLabel,
            rowLabelSourceCellId: leaf.labelSourceCellId,
            isLabelSourceHidden: (cellId) => cellById.get(cellId)?.mobileDisplay === 'hidden',
          });
          const subGroupIsHidden = leaf.subGroupSourceCellId
            ? cellById.get(leaf.subGroupSourceCellId)?.mobileDisplay === 'hidden'
            : false;
          return {
            ...leaf,
            label: substituteTokens(labelCandidate.label, attrs, quotes),
            subGroup:
              leaf.subGroup.trim() && !subGroupIsHidden
                ? substituteTokens(leaf.subGroup.trim(), attrs, quotes)
                : '',
          };
        });
        const sectionLabelIsHidden = section.labelSourceCellId
          ? cellById.get(section.labelSourceCellId)?.mobileDisplay === 'hidden'
          : false;
        const sectionLabel = sectionLabelIsHidden
          ? ''
          : substituteTokens(section.label, attrs, quotes);
        return {
          ...section,
          label: leaves.length === 1 ? (leaves[0]?.label ?? '') : sectionLabel,
          leaves,
        };
      }),
    [attrs, quotes, cellById, columns, detailRowById, omit, resolveChoiceLabel, sections],
  );
  const horizontalScrollRef = useRef(0);

  // 진행 카운트의 분모는 셀 개수가 아니라 "요구되는 선택 수"다 (answer-validation 과 동일 기준).
  // - radio/checkbox 그룹 정의가 있으면 그룹당 1 (모든 그룹에 1개 이상 선택하면 충족)
  // - 비그룹 radio 는 표 전체가 단일 선택이므로 전체 1 (모든 셀이 DEFAULT_GROUP_KEY 폴백)
  // - 비그룹 checkbox 는 null → 셀 단위 카운트 유지 (선택 개수 자체가 정보)
  const groupKeyByCellId = useMemo(() => {
    if (isGroupedChoiceQuestion(question)) {
      const map = new Map<string, string>();
      for (const group of collectChoiceGroups(question)) {
        for (const cell of group.cells) map.set(cell.id, group.groupKey);
      }
      return map;
    }
    return question.type === 'checkbox' ? null : new Map<string, string>();
  }, [question]);
  const answeredGroupKeys = useMemo(() => {
    if (!groupKeyByCellId) return null;
    return new Set(selectedIds.map((id) => groupKeyByCellId.get(id) ?? DEFAULT_GROUP_KEY));
  }, [groupKeyByCellId, selectedIds]);

  const visibleChoiceCells = (leaf: ClassifiedLeaf): TableCell[] =>
    (navigationRowById.get(leaf.rowId)?.cells ?? []).filter(
      (cell) => cell.type === 'choice_opt' && !cell.isHidden && !cell._isContinuation,
    );
  const statusFromCells = (cells: TableCell[]): DrilldownStatus => {
    if (!groupKeyByCellId || !answeredGroupKeys) {
      return {
        completed: cells.filter((cell) => selectedIdSet.has(cell.id)).length,
        total: cells.length,
        unit: '개 선택',
      };
    }
    const keys = new Set(cells.map((cell) => groupKeyByCellId.get(cell.id) ?? DEFAULT_GROUP_KEY));
    let completed = 0;
    for (const key of keys) if (answeredGroupKeys.has(key)) completed += 1;
    return { completed, total: keys.size, unit: '개 선택' };
  };

  const getLeafStatus = (leaf: ClassifiedLeaf): DrilldownStatus =>
    statusFromCells(visibleChoiceCells(leaf));

  // 그룹은 리프/섹션 경계를 넘을 수 있으므로(rowspan 승격 등) 상위 집계는 리프 상태 합산이
  // 아니라 셀 집합에서 다시 계산한다 — 합산이면 걸친 그룹이 중복 카운트된다.
  const getSectionStatus = (section: ClassifiedSection): DrilldownStatus =>
    statusFromCells(section.leaves.flatMap(visibleChoiceCells));

  const allVisibleChoiceCells = titledSections.flatMap((section) =>
    section.leaves.flatMap(visibleChoiceCells),
  );
  const cellBasedOverall = statusFromCells(allVisibleChoiceCells);
  // 비그룹 checkbox 에 minSelections 가 있으면 전체 진행바 분모는 요구 선택 수(min)다 —
  // 검증(answer-validation)이 min 충족 시 통과하는데 분모가 전체 선택지 수면 진행률이
  // 영구히 100%에 못 미친다. 리프/섹션 뱃지는 선택 현황 정보라 셀 기준을 유지한다.
  const minSelections =
    !groupKeyByCellId && typeof question.minSelections === 'number' && question.minSelections > 0
      ? Math.min(question.minSelections, cellBasedOverall.total)
      : null;
  const overallStatus: DrilldownStatus = minSelections
    ? {
        completed: Math.min(cellBasedOverall.completed, minSelections),
        total: minSelections,
        unit: '개 선택',
      }
    : cellBasedOverall;

  const renderLeafDetail = (leaf: ClassifiedLeaf) => {
    const row = detailRowById.get(leaf.rowId);
    if (!row) return null;
    const projection = projectMobileOriginalRow({
      authoredColumns: columns,
      visibleColumns: columns,
      visibleHeaderGrid: question.tableHeaderGrid ?? undefined,
      displayRows: rows,
      selectedRowId: leaf.rowId,
      omitLeadingAuthoredColumns: omit,
      repeatedRowIds: repeatedBodyRowIds,
      includeColumnHeader,
    });
    if (!projection?.hasInteractiveCells) {
      return (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          {row.cells
            .filter((cell) => cell.type === 'choice_opt' && !cell.isHidden && !cell._isContinuation)
            .map((cell) => (
              <div key={cell.id}>{renderChoiceCell(cell)}</div>
            ))}
        </div>
      );
    }
    return (
      <MobileOriginalRowTable
        columns={projection.columns}
        rows={[...projection.repeatedRows, projection.row]}
        interactiveRowId={projection.row.id}
        headerGrid={projection.headerGrid}
        hideColumnLabels={!projection.showColumnHeader}
        scrollLeftRef={horizontalScrollRef}
        choiceControlType={(cell) =>
          isGroupedChoiceQuestion(question)
            ? getGroupTypeOfCell(question, cell.id)
            : question.type === 'checkbox'
              ? 'checkbox'
              : 'radio'
        }
        renderCell={renderChoiceCell}
      />
    );
  };

  return (
    <MobileDrilldownShell
      sections={titledSections}
      leafNavigation="always"
      overallStatus={overallStatus}
      getSectionStatus={getSectionStatus}
      getLeafStatus={getLeafStatus}
      renderLeafDetail={renderLeafDetail}
      footer={counter}
      onReturnToRoot={() => {
        horizontalScrollRef.current = 0;
      }}
    />
  );
}
