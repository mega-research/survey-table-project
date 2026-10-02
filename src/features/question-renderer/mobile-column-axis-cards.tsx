'use client';

import React, { type ReactNode, useMemo } from 'react';

import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import { buildColumnAxisCards } from '@/features/question-renderer/utils/column-axis-cards';
import { overrideCellOptionsColumnsForCard } from '@/features/question-renderer/utils/mobile-card-options';
import {
  buildRadioGroupBuckets,
  resolveRadioGroupProps,
} from '@/features/question-renderer/utils/table-radio-groups';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { HeaderCell, TableColumn, TableRow } from '@/types/survey';

import { CellText, resolveCellTextHtml } from './cell-text';
import { InteractiveCell } from './cells';
import { MobileSectionCard } from './mobile-card-shared';

interface MobileColumnAxisCardsProps {
  questionId: string;
  displayRows: TableRow[];
  visibleColumns: TableColumn[];
  visibleHeaderGrid?: HeaderCell[][] | undefined;
  value?: Record<string, unknown> | undefined;
  onChange?: ((value: Record<string, unknown>) => void) | undefined;
  /** 차단형 검증 위반 셀 (빨간 ring 하이라이트) */
  errorCellIds?: Set<string> | undefined;
  /** 동적 행 그룹 선택 버튼 목록 — 호스트가 만들어 카드 목록 위에 둔다 */
  dynamicGroupPicker?: ReactNode;
}

/**
 * 테이블 유형의 「축 단위 카드」 — 응답 칸이 놓인 열마다 카드 하나, 제목은 열 헤더(고정), 안에는
 * 행 제목 + 그 칸의 입력을 행 순서대로 둔다. 묶음 규칙은 `utils/column-axis-cards` 투영 하나이고
 * 여기는 그리기만 한다. 단위 글자(명·원)는 입력 셀이 스스로 그린다.
 */
export const MobileColumnAxisCards = React.memo(function MobileColumnAxisCards({
  questionId,
  displayRows,
  visibleColumns,
  visibleHeaderGrid,
  value,
  onChange,
  errorCellIds,
  dynamicGroupPicker,
}: MobileColumnAxisCardsProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const cards = useMemo(
    () =>
      buildColumnAxisCards({
        columns: visibleColumns,
        headerGrid: visibleHeaderGrid,
        displayRows,
      }),
    [displayRows, visibleColumns, visibleHeaderGrid],
  );
  const radioBucketsByRowId = useMemo(
    () => new Map(displayRows.map((row) => [row.id, buildRadioGroupBuckets(row)])),
    [displayRows],
  );

  return (
    <div className="space-y-3">
      {dynamicGroupPicker}
      {cards.map((card) => (
        <MobileSectionCard
          key={card.key}
          testId={`column-axis-card-${card.key}`}
          headerTestId="column-axis-card-header"
          title={
            card.title ? (
              <>
                {card.ancestors.length > 0 && (
                  <span className="mb-0.5 block text-[13px] font-medium text-gray-500">
                    {card.ancestors
                      .map((label) => substituteTokens(label, attrs, quotes))
                      .join(' · ')}
                  </span>
                )}
                {substituteTokens(card.title, attrs, quotes)}
              </>
            ) : null
          }
        >
          <div className="space-y-3 px-1 py-1">
            {card.items.map(({ cell: sourceCell, row, label, labelCell, groupCells }, index) => {
              const cell = overrideCellOptionsColumnsForCard(sourceCell);
              const invalid = errorCellIds?.has(cell.id) === true;
              // 상위 구분(내부 R&D · 외부 R&D)이 바뀌는 자리에 소제목을 세운다. 구분 없는 행(합계)으로
              // 넘어가면 선만 그어 앞 구분에 딸린 것처럼 보이지 않게 한다.
              const groupKey = groupCells.map((group) => group.id).join('/');
              const previous = card.items[index - 1];
              const previousKey = previous?.groupCells.map((group) => group.id).join('/') ?? '';
              const groupChanged = groupKey !== previousKey;
              return (
                <React.Fragment key={cell.id}>
                  {groupChanged && groupKey && (
                    <p
                      data-testid="column-axis-card-group"
                      className={cn(
                        'text-[13px] font-bold text-blue-700',
                        index > 0 && 'border-t border-gray-200 pt-3',
                      )}
                    >
                      {groupCells.map((group, groupIndex) => (
                        <React.Fragment key={group.id}>
                          {groupIndex > 0 && ' · '}
                          <CellText
                            text={substituteTokens(group.content.trim(), attrs, quotes)}
                            html={resolveCellTextHtml(group, attrs, quotes)}
                          />
                        </React.Fragment>
                      ))}
                    </p>
                  )}
                  {groupChanged && !groupKey && <div className="border-t border-gray-200" />}
                  <div data-cell-id={cell.id} className="space-y-1">
                    {label && (
                      <p className="text-sm font-medium text-gray-900">
                        <CellText
                          text={substituteTokens(label, attrs, quotes)}
                          html={
                            labelCell ? resolveCellTextHtml(labelCell, attrs, quotes) : undefined
                          }
                        />
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
                </React.Fragment>
              );
            })}
          </div>
        </MobileSectionCard>
      ))}
    </div>
  );
});
