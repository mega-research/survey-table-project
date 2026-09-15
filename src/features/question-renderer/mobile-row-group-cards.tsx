'use client';

import React, { type ReactNode, useMemo } from 'react';

import { useAnswerQuotes, useContactAttrs } from '@/features/question-renderer/contact-attrs-context';
import { DEFAULT_TABLE_ANSWERABLE_CELL_TYPES } from '@/features/question-renderer/utils/classify-table';
import {
  findMobileHeaderCell,
  resolveMobileCellLabel,
} from '@/features/question-renderer/utils/split-display-cells';
import {
  buildRadioGroupBuckets,
  resolveRadioGroupProps,
} from '@/features/question-renderer/utils/table-radio-groups';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { ChoiceGroup, TableCell, TableColumn, TableRow } from '@/types/survey';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';
import { groupChoiceCellsByGroup } from '@/utils/choice-group-helpers';
import { resolveChoiceGroupSectionLabel } from '@/utils/choice-group-section-label';

import { InteractiveCell } from './cells';
import { ChoiceOptCell } from './cells/choice-opt-cell';
import { MobileOptionCard } from './mobile-card-shared';

interface MobileRowGroupCardsProps {
  questionId: string;
  displayRows: TableRow[];
  visibleColumns: TableColumn[];
  choiceGroups: ChoiceGroup[];
  hideColumnLabels: boolean;
  value?: Record<string, unknown> | undefined;
  onChange?: ((value: Record<string, unknown>) => void) | undefined;
  /** 차단형 검증 위반 셀 — 미충족 필수 그룹의 보기 셀도 여기로 온다(섹션을 붉게 두른다) */
  errorCellIds?: Set<string> | undefined;
  /** 동적 행 그룹 선택 버튼 목록 — 호스트가 만들어 카드 목록 위에 둔다 */
  dynamicGroupPicker?: ReactNode;
}

const CONTROL_CELL_TYPES = new Set<TableCell['type']>(DEFAULT_TABLE_ANSWERABLE_CELL_TYPES);

function isVisible(cell: TableCell): boolean {
  return !cell.isHidden && !cell._isContinuation;
}

/**
 * 테이블 유형 보기 그룹 표의 「행 단위 그룹 카드」 — 보기 소스 표(choice-table-response)의 같은
 * 모드를 이식한 것. 행마다 카드 하나, 구분 셀은 제목(첫 줄)·설명(나머지 줄)으로 항상 보이고,
 * 카드 안은 보기 그룹(축)별 섹션으로 나뉘어 세로 타일로 고른다. 같은 행의 입력 셀(단답·선택형)은
 * 섹션 아래에 라벨과 함께 온다 — 게이팅·상세기재는 InteractiveCell 이 셀 단위로 그대로 처리한다.
 *
 * 값은 ChoiceOptCell 이 `__choiceGroups` 에 쓴다 — 데스크톱 셀과 같은 컴포넌트의 타일 변형이라
 * 단독 선택·표 전체 범위·상세기재 규칙이 한 곳이다. 보기 셀이 없는 행(설명 행)은 카드가 되지
 * 않는다. 표시 조건·동적 행은 호스트가 displayRows 로 이미 걸러 넘긴다.
 */
export const MobileRowGroupCards = React.memo(function MobileRowGroupCards({
  questionId,
  displayRows,
  visibleColumns,
  choiceGroups,
  hideColumnLabels,
  value,
  onChange,
  errorCellIds,
  dynamicGroupPicker,
}: MobileRowGroupCardsProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const groupById = useMemo(
    () => new Map(choiceGroups.map((group) => [group.id, group])),
    [choiceGroups],
  );

  const cards = displayRows.flatMap((row) => {
    const choiceCells = row.cells.filter((cell) => {
      if (cell.type !== 'choice_opt' || !isVisible(cell)) return false;
      const group = cell.choiceGroupId ? groupById.get(cell.choiceGroupId) : undefined;
      return group?.type === 'radio' || group?.type === 'checkbox';
    });
    if (choiceCells.length === 0) return [];

    // 제목은 header 지정 셀, 없으면 행의 첫 텍스트 셀(구분) — "구분 열은 항상 제목·설명으로
    // 보인다"가 이 모드의 약속이다. 숨김(hidden) 지정만 존중한다.
    const headerCell =
      findMobileHeaderCell(row.cells) ??
      row.cells.find(
        (cell) =>
          cell.type === 'text' &&
          isVisible(cell) &&
          cell.mobileDisplay !== 'hidden' &&
          (cell.content ?? '').trim() !== '',
      );
    const headerText = headerCell
      ? substituteTokens((headerCell.content ?? '').trim(), attrs, quotes)
      : '';
    const cardLabel = headerText || substituteTokens(row.label ?? '', attrs, quotes);
    const breakAt = cardLabel.indexOf('\n');
    const title = breakAt === -1 ? cardLabel : cardLabel.slice(0, breakAt);
    const description = breakAt === -1 ? '' : cardLabel.slice(breakAt + 1).trim();

    const controlCells = row.cells.filter(
      (cell) => isVisible(cell) && CONTROL_CELL_TYPES.has(cell.type),
    );
    const radioBuckets = buildRadioGroupBuckets(row);
    const choiceCellIds = new Set(choiceCells.map((cell) => cell.id));

    return [
      <MobileOptionCard
        key={row.id}
        label={
          <span
            className={headerCell ? getCellTextClassName(headerCell) : undefined}
            style={headerCell ? getCellTextStyle(headerCell) : undefined}
          >
            <span>{title}</span>
            {description && (
              <span className="mt-1 block text-[13px] leading-snug font-normal whitespace-pre-line text-gray-500">
                {description}
              </span>
            )}
          </span>
        }
        // 제목으로 쓴 구분 셀은 표시 셀 목록에서 뺀다 — 모바일 표시가 켜져 있으면 두 번 나온다
        cells={headerCell ? row.cells.filter((cell) => cell !== headerCell) : row.cells}
        footer={
          <div className="space-y-3 border-t border-gray-100 pt-3">
            {groupChoiceCellsByGroup(choiceCells).map(({ groupId, cells }) => {
              const group = groupId ? groupById.get(groupId) : undefined;
              if (!group) return null;
              const colIndex = row.cells.findIndex((cell) => cell.id === cells[0]!.id);
              const columnLabel = (visibleColumns[colIndex]?.label ?? '').trim();
              const sectionLabel = resolveChoiceGroupSectionLabel(
                group.label ? substituteTokens(group.label, attrs, quotes) : '',
                headerText,
                columnLabel ? substituteTokens(columnLabel, attrs, quotes) : '',
              );
              // 「다음」을 누른 뒤 미충족 필수 그룹은 섹션을 붉게 두른다 — 위반 셀 집합은 데스크톱
              // 표의 보기 그룹 외곽선과 같은 판정(collectUnfilledChoiceGroupCellIds)에서 온다.
              const unfilled = cells.some((cell) => errorCellIds?.has(cell.id));
              return (
                <div
                  key={group.id}
                  data-testid={`choice-group-section-${group.id}`}
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
                  {/* 타일은 세로 한 줄씩 — 가로로 접으면 척도 순서가 지그재그로 읽힌다 */}
                  <div className="flex flex-col gap-2">
                    {cells.map((cell) => (
                      <ChoiceOptCell
                        key={cell.id}
                        cell={cell}
                        questionId={questionId}
                        group={group}
                        value={value}
                        onChange={onChange}
                        variant="tile"
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {controlCells.length > 0 && (
              <div className="space-y-2">
                {controlCells.map((cell) => {
                  const colIndex = row.cells.findIndex((c) => c.id === cell.id);
                  const columnLabel = visibleColumns[colIndex]?.label ?? '';
                  const cellLabel = resolveMobileCellLabel(
                    cell,
                    hideColumnLabels ? undefined : columnLabel,
                  );
                  return (
                    <div key={cell.id} className="space-y-1">
                      {cellLabel && (
                        <p className="text-[13px] font-semibold text-gray-600">
                          {substituteTokens(cellLabel, attrs, quotes)}
                        </p>
                      )}
                      <InteractiveCell
                        cell={cell}
                        questionId={questionId}
                        value={value}
                        onChange={onChange}
                        rowCells={row.cells}
                        ariaInvalid={errorCellIds?.has(cell.id) && !choiceCellIds.has(cell.id)}
                        {...resolveRadioGroupProps(cell, row.id, radioBuckets)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        }
      />,
    ];
  });

  return (
    <div className="space-y-3">
      {dynamicGroupPicker}
      <div className="space-y-2">{cards}</div>
    </div>
  );
});
