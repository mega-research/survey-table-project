'use client';

import React, { type ReactNode, useMemo } from 'react';

import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import { MobileDisplayCells } from '@/features/question-renderer/mobile-display-cells';
import { buildItemCardBlocks } from '@/features/question-renderer/utils/item-card-blocks';
import {
  type ItemCard,
  buildItemCards,
  itemCardTitleText,
} from '@/features/question-renderer/utils/item-cards';
import { overrideCellOptionsColumnsForCard } from '@/features/question-renderer/utils/mobile-card-options';
import {
  buildRadioGroupBuckets,
  resolveRadioGroupProps,
} from '@/features/question-renderer/utils/table-radio-groups';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { HeaderCell, TableColumn, TableRow } from '@/types/survey';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';

import { CellText, resolveCellTextHtml } from './cell-text';
import { InteractiveCell } from './cells';
import { MobileSectionCard } from './mobile-card-shared';

interface MobileItemCardsProps {
  questionId: string;
  displayRows: TableRow[];
  value?: Record<string, unknown> | undefined;
  onChange?: ((value: Record<string, unknown>) => void) | undefined;
  /** 차단형 검증 위반 셀 (빨간 ring 하이라이트) */
  errorCellIds?: Set<string> | undefined;
  /** 동적 행 그룹 선택 버튼 목록 — 호스트가 만들어 카드 목록 위에 둔다 */
  dynamicGroupPicker?: ReactNode;
  /**
   * 「블록 단위로 세우기」 — 블록 시작 열(1부터, 작성 열 순서). 비면 종전처럼 행 순서로 카드를 편다.
   * 지정하면 아래 세 열 정보가 함께 와야 한다(블록 제목·입력 라벨을 열 헤더에서 읽는다).
   */
  blockStartColumns?: readonly number[] | null | undefined;
  authoredColumns?: readonly TableColumn[] | undefined;
  visibleColumns?: readonly TableColumn[] | undefined;
  visibleHeaderGrid?: HeaderCell[][] | undefined;
  /**
   * 「행 차례로 열기」 버튼 — `rowIds` 의 행에서 나온 카드 중 마지막 것 아래에 `node` 를 세운다.
   * 블록 모드는 블록마다(같은 행이 블록마다 카드를 낸다), 블록이 없으면 목록에서 한 번.
   * 어느 목록에도 그 행의 카드가 없으면 맨 끝에 한 번 둔다 — 버튼이 사라지는 일은 없다.
   */
  afterRows?: { rowIds: ReadonlySet<string>; node: ReactNode } | undefined;
}

/**
 * 「항목 단위 카드」 — 라벨(글자 셀)마다 카드 하나. 묶음 규칙은 `utils/item-cards` 의 투영 하나이고
 * 여기는 그리기만 한다. 카드 제목은 라벨 경로(상위는 작은 회색 줄, 마지막이 제목)이고, 입력 칸
 * 위 라벨은 저작자가 셀에 적은 모바일 라벨만 쓴다 — 엑셀 라벨(「설립연도_년」)은 제목과 겹쳐
 * 내보내지 않는다. 단위 글자(년·월)는 입력 셀이 스스로 그린다.
 */
export const MobileItemCards = React.memo(function MobileItemCards({
  questionId,
  displayRows,
  value,
  onChange,
  errorCellIds,
  dynamicGroupPicker,
  blockStartColumns,
  authoredColumns,
  visibleColumns,
  visibleHeaderGrid,
  afterRows,
}: MobileItemCardsProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const blocks = useMemo(
    () =>
      authoredColumns && visibleColumns
        ? buildItemCardBlocks({
            authoredColumns,
            visibleColumns,
            visibleHeaderGrid,
            displayRows,
            blockStartColumns,
          })
        : null,
    [authoredColumns, blockStartColumns, displayRows, visibleColumns, visibleHeaderGrid],
  );
  const cards = useMemo(() => (blocks ? [] : buildItemCards(displayRows)), [blocks, displayRows]);
  const radioBucketsByRowId = useMemo(
    () => new Map(displayRows.map((row) => [row.id, buildRadioGroupBuckets(row)])),
    [displayRows],
  );

  const renderInputs = (card: ItemCard, columnLabels?: readonly string[]) =>
    card.inputs.map(({ cell: sourceCell, row, columnIndex }) => {
      const cell = overrideCellOptionsColumnsForCard(sourceCell);
      // 블록 모드만 열 헤더를 라벨 폴백으로 쓴다 — 블록 없는 표는 종전대로 모바일 라벨만
      const label =
        cell.mobileDisplay === 'hidden'
          ? ''
          : cell.mobileLabel?.trim() || (columnLabels?.[columnIndex] ?? '');
      const invalid = errorCellIds?.has(cell.id) === true;
      return (
        <div key={cell.id} data-cell-id={cell.id} className="space-y-1">
          {label && (
            <p className="text-sm font-medium text-gray-900">
              {substituteTokens(label, attrs, quotes)}
            </p>
          )}
          <div className={cn(invalid && 'rounded-lg ring-2 ring-red-300')}>
            <InteractiveCell
              cell={cell}
              questionId={questionId}
              value={value}
              onChange={onChange}
              rowCells={row.cells}
              ariaInvalid={invalid}
              hintInFlow
              ignoreInputWidth
              {...resolveRadioGroupProps(
                cell,
                row.id,
                radioBucketsByRowId.get(row.id) ?? new Map(),
              )}
            />
          </div>
        </div>
      );
    });

  const renderCard = (card: ItemCard, columnLabels?: readonly string[]) => {
    const ancestors = card.titleCells.slice(0, -1);
    const titleCell = card.titleCells[card.titleCells.length - 1];
    const titleText = titleCell
      ? substituteTokens(itemCardTitleText(titleCell), attrs, quotes)
      : substituteTokens(card.fallbackTitle, attrs, quotes);
    return (
      <MobileSectionCard
        key={card.key}
        testId={`item-card-${card.key}`}
        headerTestId="item-card-header"
        title={
          titleText ? (
            <>
              {ancestors.length > 0 && (
                <span className="mb-0.5 block text-[13px] font-medium text-gray-500">
                  {ancestors
                    .map((cell) => substituteTokens(itemCardTitleText(cell), attrs, quotes))
                    .join(' · ')}
                </span>
              )}
              <span
                className={titleCell ? getCellTextClassName(titleCell) : undefined}
                style={titleCell ? getCellTextStyle(titleCell) : undefined}
              >
                <CellText
                  text={titleText}
                  html={
                    titleCell?.type === 'text'
                      ? resolveCellTextHtml(titleCell, attrs, quotes)
                      : undefined
                  }
                />
              </span>
            </>
          ) : null
        }
      >
        <MobileDisplayCells cells={card.displayCells} />
        <div className="space-y-3 px-1 py-1">{renderInputs(card, columnLabels)}</div>
      </MobileSectionCard>
    );
  };

  /** 카드 목록 + 그 목록에서 `afterRows` 행의 마지막 카드 아래에 선 버튼 */
  const anchorIndexOf = (list: readonly ItemCard[]) =>
    afterRows ? list.findLastIndex((card) => afterRows.rowIds.has(card.rowId)) : -1;
  const renderCardList = (list: readonly ItemCard[], columnLabels?: readonly string[]) => {
    const anchorIndex = anchorIndexOf(list);
    return list.map((card, index) =>
      index === anchorIndex ? (
        <React.Fragment key={card.key}>
          {renderCard(card, columnLabels)}
          <div data-testid="item-card-row-controls">{afterRows?.node}</div>
        </React.Fragment>
      ) : (
        renderCard(card, columnLabels)
      ),
    );
  };
  const cardLists = blocks ? blocks.blocks.map((block) => block.cards) : [cards];
  const trailingControls =
    afterRows && cardLists.every((list) => anchorIndexOf(list) === -1) ? (
      <div data-testid="item-card-row-controls">{afterRows.node}</div>
    ) : null;

  const cardTitle = (card: ItemCard) => {
    const cell = card.titleCells[card.titleCells.length - 1];
    return substituteTokens(cell ? itemCardTitleText(cell) : card.fallbackTitle, attrs, quotes);
  };

  if (blocks) {
    return (
      <div className="space-y-5">
        {dynamicGroupPicker}
        {blocks.blocks.map((block) => (
          // 블록 하나가 한 덩어리 — 머리가 위에 붙고 그 블록의 항목 카드를 품는다
          <section
            key={block.key}
            data-testid={`item-card-block-${block.key}`}
            className="rounded-2xl border border-blue-200 bg-blue-50/40"
          >
            {(block.title || block.summaries.length > 0) && (
              // 블록 머리 — 그 블록을 지나는 동안 화면 위에 붙는다(카드 고정 헤더 z-10 위)
              <div
                data-testid="item-card-block-head"
                className="sticky top-0 z-20 space-y-2.5 rounded-t-2xl border-b border-blue-200 bg-blue-50 px-4 py-3"
              >
                {block.title && (
                  <div className="text-[17px] leading-snug font-bold text-gray-900">
                    {substituteTokens(block.title, attrs, quotes)}
                  </div>
                )}
                {block.summaries.map((summary) => (
                  <div key={summary.key} className="space-y-1.5">
                    <p className="text-sm leading-snug font-semibold whitespace-pre-line text-gray-700">
                      {cardTitle(summary)}
                    </p>
                    {/* 항목 카드의 입력 칸과 같은 세로 배치 — 라벨 위, 값 아래. 가로로 나누면 라벨이 접혀 안 읽힌다 */}
                    <div className="divide-y divide-blue-100 rounded-xl border border-blue-100 bg-white">
                      {summary.inputs.map(({ cell, row, columnIndex }) => {
                        const label =
                          cell.mobileLabel?.trim() || (blocks.columnLabels[columnIndex] ?? '');
                        return (
                          <div key={cell.id} data-cell-id={cell.id} className="px-3 pt-2 pb-0.5">
                            <p className="text-sm leading-snug font-medium text-gray-700">
                              {substituteTokens(label, attrs, quotes)}
                            </p>
                            <div className="-mx-2 [&_span:first-child]:text-lg [&_span:first-child]:font-bold [&_span:first-child]:text-gray-900">
                              <InteractiveCell
                                cell={{ ...cell, inputTextAlign: 'left' }}
                                questionId={questionId}
                                value={value}
                                onChange={onChange}
                                rowCells={row.cells}
                                hintInFlow
                                ignoreInputWidth
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2.5 p-2.5">
              {renderCardList(block.cards, blocks.columnLabels)}
            </div>
          </section>
        ))}
        {trailingControls}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {dynamicGroupPicker}
      {renderCardList(cards)}
      {trailingControls}
    </div>
  );
});
