'use client';

import React, { type ReactNode, useMemo } from 'react';

import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import { MobileDisplayCells } from '@/features/question-renderer/mobile-display-cells';
import {
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
import type { TableRow } from '@/types/survey';
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
}: MobileItemCardsProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const cards = useMemo(() => buildItemCards(displayRows), [displayRows]);
  const radioBucketsByRowId = useMemo(
    () => new Map(displayRows.map((row) => [row.id, buildRadioGroupBuckets(row)])),
    [displayRows],
  );

  return (
    <div className="space-y-3">
      {dynamicGroupPicker}
      {cards.map((card) => {
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
            <div className="space-y-3 px-1 py-1">
              {card.inputs.map(({ cell: sourceCell, row }) => {
                const cell = overrideCellOptionsColumnsForCard(sourceCell);
                const label =
                  cell.mobileDisplay === 'hidden' ? '' : (cell.mobileLabel?.trim() ?? '');
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
              })}
            </div>
          </MobileSectionCard>
        );
      })}
    </div>
  );
});
