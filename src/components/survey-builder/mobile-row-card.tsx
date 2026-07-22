'use client';

import React, { useMemo } from 'react';

import { CheckCircle2 } from 'lucide-react';

import { MobileDisplayCells } from '@/components/survey/mobile-display-cells';
import { Card, CardContent } from '@/components/ui/card';
import type { useColumnSectionMap } from '@/hooks/use-row-groups';
import { useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { TableColumn, TableRow } from '@/types/survey';
import {
  detectUnitPair,
  overrideCellOptionsColumnsForCard,
} from '@/utils/mobile-card-options';
import {
  findMobileHeaderCell,
  hasExplicitHiddenMobileHeaderCell,
  hasMobileDisplayCells,
} from '@/utils/mobile-display-cells';
import { getAlignmentClasses } from '@/utils/table-grid-utils';

import { InteractiveCell } from './cells';

/** 라디오 옵션 1개짜리 셀은 입력이 아닌 라벨 */
function isLabelOnlyRadio(cell: TableRow['cells'][number]): boolean {
  return cell.type === 'radio' && (cell.radioOptions?.length ?? 0) === 1;
}

interface MobileRowCardProps {
  row: TableRow;
  visibleColumns: TableColumn[];
  columnSectionMap: ReturnType<typeof useColumnSectionMap>;
  completed: boolean;
  hideColumnLabels: boolean;
  questionId: string;
  isTestMode: boolean;
  value?: Record<string, unknown> | undefined;
  onChange?: ((value: Record<string, unknown>) => void) | undefined;
  /** 차단형 검증 위반 셀 (빨간 ring 하이라이트) */
  errorCellIds?: Set<string> | undefined;
  /** 표 전체 "카드 범례"(mobileDisplay: 'legend') 라벨 — 카드 상단 한 행에 양끝 정렬로 표시 */
  legendLabels?: string[] | undefined;
}

function findPreviousSection(
  cells: Array<{ colIdx: number }>,
  columnSectionMap: ReturnType<typeof useColumnSectionMap>,
  arrIdx: number,
): string {
  if (!columnSectionMap) return '';
  for (let index = arrIdx - 1; index >= 0; index--) {
    const section = columnSectionMap.get(cells[index]?.colIdx ?? -1);
    if (section) return section;
  }
  return '';
}

export const MobileRowCard = React.memo(function MobileRowCard({
  row,
  visibleColumns,
  columnSectionMap,
  completed,
  hideColumnLabels,
  questionId,
  isTestMode,
  value,
  onChange,
  errorCellIds,
  legendLabels,
}: MobileRowCardProps) {
  const attrs = useContactAttrs();

  const inputCells = useMemo(
    () =>
      row.cells
        .map((cell, idx) => ({ cell, colIdx: idx }))
        .filter(
          ({ cell }) =>
            !cell.isHidden &&
            !cell._isContinuation &&
            cell.type !== 'text' &&
            cell.type !== 'image' &&
            cell.type !== 'video' &&
            !isLabelOnlyRadio(cell),
        )
        .map((entry) => {
          const overridden = overrideCellOptionsColumnsForCard(entry.cell);
          return overridden === entry.cell ? entry : { ...entry, cell: overridden };
        }),
    [row.cells],
  );

  const rowDesc = useMemo(() => {
    // 'header' 로 지정된 text 셀이 있으면 카드 제목으로 우선 사용
    const headerCell = findMobileHeaderCell(row.cells);
    const headerText = headerCell ? (headerCell.content ?? '').trim() : '';
    if (headerText) return headerText;
    if (hasExplicitHiddenMobileHeaderCell(row.cells)) return '';
    const descCell = row.cells.find(
      (c) => c.type === 'radio' && !c.isHidden && c.radioOptions?.length === 1,
    );
    return descCell?.radioOptions?.[0]?.label || row.label;
  }, [row.cells, row.label]);

  const mobileCells = useMemo(() => {
    return inputCells.map((entry, arrIdx) => {
      const columnLabel = visibleColumns[entry.colIdx]?.label || `항목 ${entry.colIdx + 1}`;
      const section = columnSectionMap?.get(entry.colIdx);
      const previousSection = findPreviousSection(inputCells, columnSectionMap, arrIdx);
      const activeSection = section ?? previousSection;
      const sectionHeader = section && section !== previousSection ? section : null;

      const cellLabel = entry.cell.exportLabel?.trim();
      const shortLabel = cellLabel || (sectionHeader
        ? columnLabel
        : activeSection && columnLabel.startsWith(activeSection)
          ? columnLabel.slice(activeSection.length).replace(/^[_\s·]+/, '') || columnLabel
          : columnLabel);

      return {
        ...entry,
        arrIdx,
        cellLabel,
        columnLabel,
        sectionHeader,
        shortLabel,
      };
    });
  }, [columnSectionMap, inputCells, visibleColumns]);

  // 범례 첫/마지막 항목에 이 카드 옵션 셀의 첫/마지막 옵션 라벨(⓪/⑩ 등)을 자동 접두.
  const decoratedLegendLabels = useMemo(() => {
    if (!legendLabels || legendLabels.length === 0) return [];
    const optionCell = inputCells.find(
      ({ cell }) =>
        (cell.radioOptions ?? cell.checkboxOptions ?? cell.selectOptions ?? []).length > 1,
    )?.cell;
    const opts = optionCell
      ? (optionCell.radioOptions ?? optionCell.checkboxOptions ?? optionCell.selectOptions ?? [])
      : [];
    const first = opts[0]?.label?.trim();
    const last = opts.length > 1 ? opts[opts.length - 1]?.label?.trim() : undefined;
    return legendLabels.map((label, i) => {
      if (i === 0 && first) return `${first} ${label}`;
      if (i === legendLabels.length - 1 && last) return `${last} ${label}`;
      return label;
    });
  }, [legendLabels, inputCells]);

  // mobileDisplay 미지정/hidden 은 기존 동작처럼 카드에 표시하지 않는다.
  const hasDisplayCells = hasMobileDisplayCells(row.cells);
  if (inputCells.length === 0 && !hasDisplayCells) return null;

  return (
    <Card
      className={cn(
        'mobile-row-card overflow-hidden transition-all duration-200',
        completed
          ? 'border-green-400 bg-green-50/30 ring-1 ring-green-400'
          : 'border-gray-200',
      )}
    >
      <div className={cn('border-b px-4 py-3', completed ? 'bg-green-50' : 'bg-gray-50/80')}>
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            {rowDesc && (
              <p className="text-sm font-semibold leading-snug text-gray-900">
                {substituteTokens(rowDesc, attrs)}
              </p>
            )}
          </div>
          {completed && (
            <div className="ml-2 flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              완료
            </div>
          )}
        </div>
      </div>

      <CardContent className="space-y-3 px-6 py-4">
        {/* 카드 범례 — 스케일 앵커 라벨(전혀/매우 등)을 입력 컨트롤 위 한 행에,
            라벨 사이는 점선 리더로 채워 양끝 대응 관계를 시각화 */}
        {decoratedLegendLabels.length > 0 && inputCells.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {decoratedLegendLabels.map((label, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <span aria-hidden className="min-w-3 flex-1 border-b border-dotted border-gray-300" />
                )}
                <span>{substituteTokens(label, attrs)}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        {mobileCells.map(({ cell, arrIdx, cellLabel, columnLabel, sectionHeader, shortLabel }) => {
          const nextEntry = inputCells[arrIdx + 1];
          const prevEntry = arrIdx > 0 ? inputCells[arrIdx - 1] : null;
          const nextLabel = nextEntry ? visibleColumns[nextEntry.colIdx]?.label : undefined;
          const prevLabel = prevEntry ? visibleColumns[prevEntry.colIdx]?.label : undefined;
          const { isUnitPairStart, wasAlreadyPaired } = detectUnitPair(
            columnLabel,
            nextLabel,
            prevLabel,
          );

          if (wasAlreadyPaired) return null;

          return (
            <React.Fragment key={cell.id}>
              {sectionHeader && (
                <div className="flex items-center gap-2 pt-1 first:pt-0">
                  <div className="h-px flex-1 bg-gray-200" />
                  <span className="text-xs font-semibold text-gray-500">
                    {substituteTokens(sectionHeader, attrs)}
                  </span>
                  <div className="h-px flex-1 bg-gray-200" />
                </div>
              )}
              <div className="space-y-1">
                {(() => {
                  if (cell.mobileDisplay === 'hidden') return null;
                  // hideColumnLabels 여도 인터랙티브 셀은 exportLabel 을 표기해 입력 항목을 식별할 수 있게 한다.
                  const displayLabel = hideColumnLabels ? cellLabel : shortLabel;
                  if (!displayLabel) return null;
                  return (
                    <div className="flex items-start gap-1.5">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span className="line-clamp-2 text-sm font-medium text-gray-900">
                        {substituteTokens(displayLabel, attrs)}
                      </span>
                    </div>
                  );
                })()}
                {/* pl-3: 위 라벨(점 6px+간격 6px)과 입력을 같은 선상으로 들여쓰는 값.
                    라벨이 안 보이면 들여쓸 기준이 없어 좌우 여백만 비대칭이 되므로 라벨 표시 시에만 적용 */}
                {(() => {
                  const labelShown =
                    cell.mobileDisplay !== 'hidden' &&
                    Boolean(hideColumnLabels ? cellLabel : shortLabel);
                  const labelIndent = labelShown ? 'pl-3' : '';
                  return isUnitPairStart && nextEntry ? (
                    <div className={cn('flex items-end gap-2', labelIndent)}>
                    <div
                      className={cn(
                        'flex-1',
                        errorCellIds?.has(cell.id) && 'rounded-lg ring-2 ring-red-300',
                      )}
                    >
                      <InteractiveCell
                        cell={cell}
                        questionId={questionId}
                        isTestMode={isTestMode}
                        value={value}
                        onChange={onChange}
                      />
                    </div>
                    <div
                      className={cn(
                        'w-28 shrink-0',
                        errorCellIds?.has(nextEntry.cell.id) && 'rounded-lg ring-2 ring-red-300',
                      )}
                    >
                      <InteractiveCell
                        cell={nextEntry.cell}
                        questionId={questionId}
                        isTestMode={isTestMode}
                        value={value}
                        onChange={onChange}
                      />
                    </div>
                  </div>
                ) : (
                  <div
                    className={cn(
                      labelIndent,
                      getAlignmentClasses(cell.horizontalAlign, cell.verticalAlign),
                      errorCellIds?.has(cell.id) && 'rounded-lg ring-2 ring-red-300',
                    )}
                  >
                    <InteractiveCell
                      cell={cell}
                      questionId={questionId}
                      isTestMode={isTestMode}
                      value={value}
                      onChange={onChange}
                    />
                  </div>
                );
                })()}
              </div>
            </React.Fragment>
          );
        })}
        {/* 표시 셀 — inline 은 바로 렌더, collapsed 는 "자세히" 접기 안에 렌더 */}
        <MobileDisplayCells cells={row.cells} />
      </CardContent>
    </Card>
  );
});
