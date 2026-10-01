'use client';

import { useId } from 'react';
import type React from 'react';

import type {
  MobileRowWiseOriginalModel,
  MobileRowWiseOriginalQuestion,
} from '@/features/question-renderer/utils/mobile-row-wise-original';
import type {
  RowScaleBar,
  RowScaleLayout,
} from '@/features/question-renderer/utils/row-scale-bars';
import { cn } from '@/lib/utils';
import type { ChoiceGroup, TableCell } from '@/types/survey';

import { MobileOriginalRowTable } from './mobile-original-row-table';

interface MobileRowWiseOriginalSheetProps {
  model: MobileRowWiseOriginalModel;
  renderCell: (
    cell: TableCell,
    question: MobileRowWiseOriginalQuestion,
    inputIdScope: string,
    invalid: boolean,
    errorDescriptionId?: string | undefined,
  ) => React.ReactNode;
  choiceControlType?:
    'radio' | 'checkbox' | ((cell: TableCell) => 'radio' | 'checkbox') | undefined;
  errorCellIds?: Set<string> | undefined;
  /**
   * 「행별 척도」 배치(projectRowWiseScaleLayouts) — 막대가 있는 행은 행 순서대로 막대와 원본 조각을
   * 번갈아 그리고, 없는 행(segments null)은 종전 원본 표 조각 그대로다.
   */
  scaleLayoutByRowId?: ReadonlyMap<string, RowScaleLayout> | undefined;
  /** 세로 타일 한 그룹 — 그룹 카드의 섹션과 같은 얼굴. 선택 채널이 문항마다 달라 호스트가 그린다 */
  renderGroupTiles?:
    | ((
        group: ChoiceGroup,
        cells: readonly TableCell[],
        question: MobileRowWiseOriginalQuestion,
        context: ScaleBarRenderContext,
      ) => React.ReactNode)
    | undefined;
  /** 막대 하나 — 선택 읽기·쓰기 채널이 문항마다 달라 호스트가 그린다 */
  renderScaleBar?:
    | ((
        bar: RowScaleBar,
        question: MobileRowWiseOriginalQuestion,
        context: ScaleBarRenderContext,
      ) => React.ReactNode)
    | undefined;
}

export interface ScaleBarRenderContext {
  inputIdScope: string;
  /** 행에 막대·타일·조각이 여럿이다 — 머리에 그룹 이름을 보여 가른다(하나면 행 제목으로 족하다) */
  sharesRow: boolean;
}

export function MobileRowWiseOriginalSheet({
  model,
  renderCell,
  choiceControlType,
  errorCellIds,
  scaleLayoutByRowId,
  renderGroupTiles,
  renderScaleBar,
}: MobileRowWiseOriginalSheetProps) {
  const labelIdPrefix = useId();

  return (
    <div
      data-testid="mobile-row-wise-original-sheet"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white"
    >
      {model.sections.map((section, sectionIndex) => (
        <section key={section.id} className={cn(sectionIndex > 0 && 'border-t-8 border-gray-100')}>
          {section.label ? (
            <h3 className="border-b border-gray-200 bg-blue-50 px-4 py-3 text-base font-semibold text-blue-700">
              {section.label}
            </h3>
          ) : null}
          {section.subgroups.map((subgroup, subgroupIndex) => {
            const subgroupLabelId = `${labelIdPrefix}-${sectionIndex}-${subgroupIndex}-header`;
            const sharesSubgroupTitle = (question: MobileRowWiseOriginalQuestion) =>
              Boolean(subgroup.label.trim()) && question.title.trim() === subgroup.label.trim();
            const subgroupHasError = subgroup.questions.some(
              (question) =>
                sharesSubgroupTitle(question) &&
                question.projection.row.cells.some((cell) => errorCellIds?.has(cell.id)),
            );

            return (
              <div
                key={subgroup.id}
                className={cn(subgroupIndex > 0 && 'border-t border-gray-200')}
              >
                {subgroup.label ? (
                  <h4
                    id={subgroupLabelId}
                    className={cn(
                      'bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-700',
                      subgroupHasError && 'text-red-700',
                    )}
                  >
                    {subgroup.label}
                  </h4>
                ) : null}
                <div className="divide-y divide-gray-200">
                  {subgroup.questions.map((question, questionIndex) => {
                    const labelId = `${labelIdPrefix}-${sectionIndex}-${subgroupIndex}-${questionIndex}`;
                    // 같은 행 라벨이 하위 그룹과 행 제목 양쪽에 쓰일 수 있다.
                    // 중복이면 표시와 접근성 이름 모두 위쪽 카드 헤더를 사용한다.
                    const useSubgroupTitle = sharesSubgroupTitle(question);
                    // 라벨이 없는 행은 제목 줄을 그리지 않는다
                    const hasTitle = Boolean(question.title.trim());
                    const hasError = question.projection.row.cells.some((cell) =>
                      errorCellIds?.has(cell.id),
                    );
                    const inputIdScope = question.rowId;
                    const errorDescriptionId = hasError ? `${labelId}-error` : undefined;
                    const segments =
                      renderScaleBar && renderGroupTiles
                        ? scaleLayoutByRowId?.get(question.rowId)?.segments
                        : undefined;
                    const renderPieceCell = (cell: TableCell) =>
                      renderCell(
                        cell,
                        question,
                        inputIdScope,
                        errorCellIds?.has(cell.id) ?? false,
                        errorCellIds?.has(cell.id) ? errorDescriptionId : undefined,
                      );

                    return (
                      <div
                        key={question.rowId}
                        role="group"
                        aria-labelledby={
                          useSubgroupTitle ? subgroupLabelId : hasTitle ? labelId : undefined
                        }
                        data-row-question-id={question.rowId}
                        className="space-y-3 px-3 py-4"
                      >
                        {!useSubgroupTitle && hasTitle ? (
                          <h5
                            id={labelId}
                            className={cn(
                              'px-1 text-base font-semibold text-gray-900',
                              hasError && 'text-red-700',
                            )}
                          >
                            {question.title}
                          </h5>
                        ) : null}
                        {errorDescriptionId ? (
                          <p id={errorDescriptionId} className="sr-only">
                            {hasTitle
                              ? `${question.title}의 응답을 확인해 주세요.`
                              : '응답을 확인해 주세요.'}
                          </p>
                        ) : null}
                        {segments && renderScaleBar && renderGroupTiles ? (
                          // 행별 척도 — 그룹은 제 보기 모양(타일·원본 한 줄·막대), 나머지 응답 칸은 원본 조각
                          <div className="space-y-3">
                            {segments.map((segment) =>
                              segment.kind === 'bar' ? (
                                <div key={segment.bar.key} className="px-1">
                                  {renderScaleBar(segment.bar, question, {
                                    inputIdScope,
                                    sharesRow: segments.length > 1,
                                  })}
                                </div>
                              ) : segment.kind === 'tiles' ? (
                                <div key={segment.key} className="px-1">
                                  {renderGroupTiles(segment.group, segment.cells, question, {
                                    inputIdScope,
                                    sharesRow: segments.length > 1,
                                  })}
                                </div>
                              ) : (
                                <MobileOriginalRowTable
                                  key={segment.key}
                                  columns={segment.piece.columns}
                                  rows={[segment.piece.row]}
                                  interactiveRowId={segment.piece.row.id}
                                  headerGrid={segment.piece.headerGrid}
                                  hideColumnLabels={!segment.piece.showColumnHeader}
                                  choiceControlType={choiceControlType}
                                  errorCellIds={errorCellIds}
                                  instanceScope={`${question.rowId}:${segment.key}`}
                                  renderCell={renderPieceCell}
                                />
                              ),
                            )}
                          </div>
                        ) : (
                          <MobileOriginalRowTable
                            columns={question.projection.columns}
                            rows={[...question.projection.repeatedRows, question.projection.row]}
                            interactiveRowId={question.projection.row.id}
                            headerGrid={question.projection.headerGrid}
                            hideColumnLabels={!question.projection.showColumnHeader}
                            choiceControlType={choiceControlType}
                            errorCellIds={errorCellIds}
                            instanceScope={question.rowId}
                            renderCell={renderPieceCell}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

interface RowTileSectionProps {
  /** 머리 줄 — 행에 여럿일 때만 그룹 이름, 하나면 비운다(행 제목이 위에 있다) */
  label: string;
  /** 타일 묶음의 접근성 이름 — 머리가 비면 행 제목 */
  ariaLabel: string;
  /** 「다음」 뒤 미충족 필수 그룹 — 그룹 카드의 섹션과 같은 붉은 테두리 */
  invalid: boolean;
  children: React.ReactNode;
}

/** 행별 척도의 세로 타일 한 그룹 — 「행 단위 그룹 카드」 섹션과 같은 얼굴(머리 줄 + 세로 타일) */
export function RowTileSection({ label, ariaLabel, invalid, children }: RowTileSectionProps) {
  return (
    <div
      className={cn('space-y-1.5', invalid && 'rounded-lg border border-red-300 bg-red-50/40 p-2')}
    >
      {label ? (
        <p className={cn('text-[13px] font-semibold', invalid ? 'text-red-600' : 'text-gray-600')}>
          {label}
        </p>
      ) : null}
      {/* 타일은 세로 한 줄씩 — 가로로 접으면 척도 순서가 지그재그로 읽힌다 */}
      <div role="group" aria-label={ariaLabel} className="flex flex-col gap-2">
        {children}
      </div>
    </div>
  );
}
