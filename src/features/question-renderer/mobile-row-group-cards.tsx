'use client';

import React, { type ReactNode, useId, useMemo } from 'react';

import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import { DEFAULT_TABLE_ANSWERABLE_CELL_TYPES } from '@/features/question-renderer/utils/classify-table';
import {
  findMobileHeaderCell,
  hasMobileDisplayCells,
  resolveMobileCellLabel,
} from '@/features/question-renderer/utils/split-display-cells';
import {
  buildRadioGroupBuckets,
  resolveRadioGroupProps,
} from '@/features/question-renderer/utils/table-radio-groups';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { ChoiceGroup, HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';
import { groupChoiceCellsByGroup } from '@/utils/choice-group-helpers';
import { systemText } from '@/utils/system-strings';

import { CellText, resolveCellTextHtml } from './cell-text';
import { InteractiveCell } from './cells';
import { ChoiceOptCell } from './cells/choice-opt-cell';
import { TableChoiceGroupScaleBar } from './choice-group-scale-bar';
import { MobileOptionCard } from './mobile-card-shared';
import { MobileOriginalRowTable } from './mobile-original-row-table';
import { useInlineSurveyLocale } from './survey-locale-context';
import { TableChoiceGroupScaleSlider } from './table-choice-group-scale-slider';
import { projectChoiceGroupSectionViewWithSlider } from './utils/choice-group-section-view';
import { resolveChoiceGroupSectionLabel } from './utils/choice-group-section-label';

interface MobileRowGroupCardsProps {
  questionId: string;
  displayRows: TableRow[];
  visibleColumns: TableColumn[];
  /** 표시 조건으로 걸러진 헤더 그리드 — 원본 한 줄·척도 막대(ChoiceGroup.mobileOriginalLine·mobileScaleBar) 헤더의 재료 */
  visibleHeaderGrid?: HeaderCell[][] | undefined;
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
 * 모드를 이식한 것. 행마다 카드 하나, 구분 셀은 고정 머리(스크롤해도 따라온다)에 줄바꿈·서식본
 * 그대로 항상 보이고, 카드 안은 보기 그룹(축)별 섹션으로 나뉘어 세로 타일로 고른다. 같은 행의 입력 셀(단답·선택형)은
 * 섹션 아래에 라벨과 함께 온다 — 게이팅·상세기재는 InteractiveCell 이 셀 단위로 그대로 처리한다.
 *
 * 섹션의 모양은 그룹의 보기 모양을 따른다(choice-group-section-view) — 척도 슬라이더 · 척도 막대 ·
 * 원본 한 줄 · 세로 타일. 슬라이더와 막대는 그 행에서 못 그리면 원본 한 줄로 떨어진다. 척도 슬라이더가
 * 켜진 표도 표시 방식이 「행 단위 그룹 카드」면 이 카드 안에서 그린다(scale-slider-table-layout).
 *
 * 슬라이더가 서는 카드는 제목에 id 를 달아 슬라이더의 라디오 묶음이 「카드 제목, 섹션 제목」을 낭독 이름으로
 * 가리키게 하고, 미충족 필수 슬라이더 섹션이 있으면 카드에 낭독용 오류 문구를 하나 두어 그 묶음의 설명으로
 * 잇는다(행 단위 배치의 행 제목·오류 문구와 같은 구실). **슬라이더가 없는 카드의 마크업은 그대로다** — id 도
 * 문구도 더하지 않는다.
 *
 * 값은 ChoiceOptCell 이 `__choiceGroups` 에 쓴다 — 데스크톱 셀과 같은 컴포넌트의 타일 변형이라
 * 단독 선택·표 전체 범위·상세기재 규칙이 한 곳이다. 슬라이더·막대도 같은 그룹 선택 쓰기를 탄다. 보기 셀이 없는 행(설명 행)은 카드가 되지
 * 않는다. 표시 조건·동적 행은 호스트가 displayRows 로 이미 걸러 넘긴다.
 */
export const MobileRowGroupCards = React.memo(function MobileRowGroupCards({
  questionId,
  displayRows,
  visibleColumns,
  visibleHeaderGrid,
  choiceGroups,
  hideColumnLabels,
  value,
  onChange,
  errorCellIds,
  dynamicGroupPicker,
}: MobileRowGroupCardsProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const locale = useInlineSurveyLocale();
  const cardIdPrefix = useId();
  const groupById = useMemo(
    () => new Map(choiceGroups.map((group) => [group.id, group])),
    [choiceGroups],
  );

  const cards = displayRows.flatMap((row, rowIndex) => {
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
    // 제목으로 쓴 구분 셀은 표시 셀 목록에서 뺀다 — 모바일 표시가 켜져 있으면 두 번 나온다
    const displayCells = headerCell ? row.cells.filter((cell) => cell !== headerCell) : row.cells;

    const controlCells = row.cells.filter(
      (cell) => isVisible(cell) && CONTROL_CELL_TYPES.has(cell.type),
    );
    const radioBuckets = buildRadioGroupBuckets(row);
    const choiceCellIds = new Set(choiceCells.map((cell) => cell.id));

    // 그룹 보기 모양 — 척도 슬라이더 / 척도 막대 / 원본 한 줄(슬라이더·막대 폴백 포함) / 세로 타일.
    // 섹션을 그리기 전에 정한다 — 슬라이더가 서는 카드인지가 카드 제목의 id 와 낭독용 오류 문구를 정한다
    const sections = groupChoiceCellsByGroup(choiceCells).flatMap(({ groupId, cells }) => {
      const group = groupId ? groupById.get(groupId) : undefined;
      if (!group) return [];
      const view = projectChoiceGroupSectionViewWithSlider({
        group,
        selectionType: group.type,
        columns: visibleColumns,
        headerGrid: visibleHeaderGrid,
        hideColumnLabels,
        row,
        groupCells: cells,
      });
      // 「다음」을 누른 뒤 미충족 필수 그룹은 섹션을 붉게 두른다 — 위반 셀 집합은 데스크톱
      // 표의 보기 그룹 외곽선과 같은 판정(collectUnfilledChoiceGroupCellIds)에서 온다.
      const unfilled = cells.some((cell) => errorCellIds?.has(cell.id));
      return [{ group, cells, view, unfilled }];
    });
    const sliderSections = sections.filter((section) => section.view.kind === 'scale-slider');
    // 슬라이더의 낭독 이름이 가리킬 카드 제목 — 슬라이더가 서고 제목 글자가 있을 때만 id 를 단다
    const cardTitle = cardLabel.replace(/\s+/g, ' ').trim();
    const cardTitleId =
      sliderSections.length > 0 && cardTitle ? `${cardIdPrefix}-${rowIndex}-title` : undefined;
    // 미충족 필수 슬라이더 섹션이 있는 동안만 낭독용 오류 문구를 둔다(행 단위 배치의 행마다 문구와 같다)
    const cardErrorId = sliderSections.some((section) => section.unfilled)
      ? `${cardIdPrefix}-${rowIndex}-error`
      : undefined;

    return [
      <MobileOptionCard
        key={row.id}
        labelId={cardTitleId}
        // 행 단위 카드와 같은 고정 머리 — 구분 셀을 줄 단위로 제목·설명으로 가르지 않고
        // 서식본(contentHtml)까지 그대로 둔다. 둘째 줄을 회색 설명으로 내리면 셀 편집기에서
        // 준 강조가 사라지고, 긴 카드를 스크롤할 때 어느 행인지 놓친다.
        variant="section"
        testId={`row-card-${row.id}`}
        label={
          <span
            className={headerCell ? getCellTextClassName(headerCell) : undefined}
            style={headerCell ? getCellTextStyle(headerCell) : undefined}
          >
            <CellText
              text={cardLabel}
              html={headerCell ? resolveCellTextHtml(headerCell, attrs, quotes) : undefined}
            />
          </span>
        }
        cells={displayCells}
        footer={
          <div
            className={cn(
              'space-y-3',
              // 설명 셀이 있을 때만 구분선 — 없으면 머리의 경계선 바로 아래 선이 겹친다
              hasMobileDisplayCells(displayCells) && 'border-t border-gray-100 pt-3',
            )}
          >
            {cardErrorId ? (
              <p id={cardErrorId} className="sr-only">
                {cardTitle
                  ? systemText('mobile.checkAnswerOf', locale, { title: cardTitle })
                  : systemText('mobile.checkAnswer', locale)}
              </p>
            ) : null}
            {sections.map(({ group, cells, view, unfilled }) => {
              const colIndex = row.cells.findIndex((cell) => cell.id === cells[0]!.id);
              const columnLabel = (visibleColumns[colIndex]?.label ?? '').trim();
              const sectionLabel = resolveChoiceGroupSectionLabel(
                group.label ? substituteTokens(group.label, attrs, quotes) : '',
                headerText,
                columnLabel ? substituteTokens(columnLabel, attrs, quotes) : '',
              );
              return (
                <div
                  key={group.id}
                  data-testid={`choice-group-section-${group.id}`}
                  className={cn(
                    'space-y-1.5',
                    unfilled && 'rounded-lg border border-red-300 bg-red-50/40 p-2',
                  )}
                >
                  {view.kind === 'scale-slider' ? (
                    // 슬라이더도 머리 줄에 섹션 제목과 고른 값 표시를 나란히 둔다. 이 카드는 좁은 화면 전용이다.
                    // 낭독 이름은 「카드 제목, 섹션 제목」이고, 미충족이면 카드의 낭독용 오류 문구를 잇는다
                    <TableChoiceGroupScaleSlider
                      questionId={questionId}
                      group={group}
                      model={view.model}
                      cells={cells}
                      label={sectionLabel}
                      ariaLabelledBy={cardTitleId}
                      ariaDescribedBy={unfilled ? cardErrorId : undefined}
                      invalid={unfilled}
                      narrow
                      value={value}
                      onChange={onChange}
                      inputIdScope={row.id}
                    />
                  ) : view.kind === 'scale-bar' ? (
                    // 막대는 머리 줄에 섹션 제목과 선택값 표시를 나란히 둔다
                    <TableChoiceGroupScaleBar
                      questionId={questionId}
                      group={group}
                      model={view.model}
                      cells={cells}
                      label={sectionLabel}
                      invalid={unfilled}
                      value={value}
                      onChange={onChange}
                      inputIdScope={row.id}
                    />
                  ) : sectionLabel ? (
                    <p
                      className={cn(
                        'text-[13px] font-semibold',
                        unfilled ? 'text-red-600' : 'text-gray-600',
                      )}
                    >
                      {sectionLabel}
                    </p>
                  ) : null}
                  {view.kind === 'scale-slider' || view.kind === 'scale-bar' ? null : view.kind ===
                    'original-line' ? (
                    <div data-testid={`choice-group-original-line-${group.id}`}>
                      <MobileOriginalRowTable
                        columns={view.line.columns}
                        rows={[view.line.row]}
                        interactiveRowId={view.line.row.id}
                        headerGrid={view.line.headerGrid}
                        hideColumnLabels={!view.line.showColumnHeader}
                        choiceControlType={group.type === 'checkbox' ? 'checkbox' : 'radio'}
                        errorCellIds={errorCellIds}
                        instanceScope={`${row.id}-${group.id}`}
                        renderCell={(cell) => (
                          <InteractiveCell
                            cell={cell}
                            questionId={questionId}
                            value={value}
                            onChange={onChange}
                            inputIdScope={`${row.id}-${group.id}`}
                            rowCells={row.cells}
                          />
                        )}
                      />
                    </div>
                  ) : (
                    // 타일은 세로 한 줄씩 — 가로로 접으면 척도 순서가 지그재그로 읽힌다
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
                  )}
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
