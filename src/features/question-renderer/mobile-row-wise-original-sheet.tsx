'use client';

import { useId } from 'react';
import type React from 'react';

import {
  type ChoiceGroupOriginalLine,
  resolveWideTextInputFields,
} from '@/features/question-renderer/utils/choice-group-original-line';
import type {
  MobileRowWiseOriginalModel,
  MobileRowWiseOriginalQuestion,
} from '@/features/question-renderer/utils/mobile-row-wise-original';
import type {
  RowScaleBar,
  RowScaleSlider,
  RowSliderSegment,
} from '@/features/question-renderer/utils/row-scale-bars';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { ChoiceGroup, TableCell } from '@/types/survey';
import { systemText } from '@/utils/system-strings';

import { useAnswerQuotes, useContactAttrs } from './contact-attrs-context';
import { MobileOriginalRowTable } from './mobile-original-row-table';
import { useInlineSurveyLocale } from './survey-locale-context';

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
   * 번갈아 그리고, 없는 행(segments null)은 종전 원본 표 조각 그대로다. 슬라이더를 그리는 호스트는
   * 슬라이더 조각이 든 배치(projectRowWiseSliderLayouts)와 `renderScaleSlider` 를 함께 넘긴다.
   */
  scaleLayoutByRowId?:
    ReadonlyMap<string, { segments: RowSliderSegment[] | null }> | undefined;
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
  /** 척도 슬라이더 하나 — 막대와 같이 선택 채널이 문항마다 달라 호스트가 그린다 */
  renderScaleSlider?:
    | ((
        slider: RowScaleSlider,
        question: MobileRowWiseOriginalQuestion,
        context: ScaleBarRenderContext,
      ) => React.ReactNode)
    | undefined;
  /**
   * 넓은 화면의 행 단위 배치 — 척도 슬라이더가 켜진 표는 넓은 폭에서도 이 시트로 그린다(이름의 `Mobile` 은
   * 모바일 전용이던 때의 것이다). 줄의 안쪽 여백을 넓히고, 원본 표 조각을 가운데가 아니라 왼쪽에 붙이며(같은
   * 줄의 슬라이더·행 제목과 축을 맞춘다), 글자 입력칸뿐인 조각은 「라벨 + 넓은 입력칸」으로 푼다(슬라이더처럼 자리를
   * 꽉 채운다). 판정은 호스트의 기존 모바일 판정 하나라, 여기에 폭 분기점을 따로 두지 않는다.
   */
  wide?: boolean | undefined;
}

export interface ScaleBarRenderContext {
  inputIdScope: string;
  /** 행에 막대·타일·조각이 여럿이다 — 머리에 그룹 이름을 보여 가른다(하나면 행 제목으로 족하다) */
  sharesRow: boolean;
  /**
   * 이 행의 보이는 제목 요소의 id — 행 블록(`role="group"`)이 이름으로 가리키는 바로 그 요소다(행 제목, 하위
   * 그룹 머리와 글자가 같은 행이면 그 머리). 척도 슬라이더가 라디오 묶음의 이름으로 같은 요소를 가리킨다.
   * 제목이 없는 행이면 없다 — 그때 호스트는 낭독용 글자를 넘긴다.
   */
  titleId?: string | undefined;
  /**
   * 이 행의 낭독용 오류 문구 요소의 id — 행에 오류 칸이 있어 문구를 그린 동안만 있다. 슬라이더 호스트는
   * **제 묶음이 걸렸을 때만** 넘긴다(같은 행의 다른 칸이 걸린 것을 슬라이더의 설명으로 읽히지 않게).
   */
  errorDescriptionId?: string | undefined;
}

export function MobileRowWiseOriginalSheet({
  model,
  renderCell,
  choiceControlType,
  errorCellIds,
  scaleLayoutByRowId,
  renderGroupTiles,
  renderScaleBar,
  renderScaleSlider,
  wide = false,
}: MobileRowWiseOriginalSheetProps) {
  const labelIdPrefix = useId();
  const locale = useInlineSurveyLocale();
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  // 섹션·하위 그룹·줄 제목은 표의 글자 칸에서 올라온 평문이라 명단 토큰·응답 인용이 그대로 들어 있다 —
  // 행 카드·드릴다운과 같이 여기서 푼다. 호스트가 받는 줄 제목(막대·타일의 접근성 이름)도 푼 글자다.
  const sections = model.sections.map((section) => ({
    ...section,
    label: substituteTokens(section.label, attrs, quotes),
    subgroups: section.subgroups.map((subgroup) => ({
      ...subgroup,
      label: substituteTokens(subgroup.label, attrs, quotes),
      questions: subgroup.questions.map((question) => ({
        ...question,
        title: substituteTokens(question.title, attrs, quotes),
      })),
    })),
  }));

  return (
    <div
      data-testid="mobile-row-wise-original-sheet"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white"
    >
      {sections.map((section, sectionIndex) => (
        <section key={section.id} className={cn(sectionIndex > 0 && 'border-t-8 border-gray-100')}>
          {section.label ? (
            <h3
              className={cn(
                'border-b border-gray-200 bg-blue-50 px-4 py-3 text-base font-semibold text-blue-700',
                wide && 'px-6',
              )}
            >
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
                      wide && 'px-6',
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
                    const hasError = [
                      ...question.projection.row.cells,
                      ...question.omittedAnswerCells,
                      ...question.belowTitleCells,
                    ].some((cell) => errorCellIds?.has(cell.id));
                    const inputIdScope = question.rowId;
                    const errorDescriptionId = hasError ? `${labelId}-error` : undefined;
                    // 행 블록의 이름이 되는 제목 요소 — 슬라이더의 라디오 묶음도 이 id 를 가리킨다
                    const titleId = useSubgroupTitle
                      ? subgroupLabelId
                      : hasTitle
                        ? labelId
                        : undefined;
                    const segments =
                      renderScaleBar && renderGroupTiles
                        ? scaleLayoutByRowId?.get(question.rowId)?.segments
                        : undefined;
                    // 조각 밖에 그리는 칸도 조각의 칸과 같은 표식을 갖는다 — 오류 안내의 「위치로 이동」
                    // (scroll-to-issue)이 이 표식으로 칸을 찾는다. 인스턴스 id 는 조각 표와 같은 규약
                    // (`buildRowWiseCellInstanceIds`)이다. 없으면 문항 카드 맨 위로 떨어진다.
                    const issueTargetProps = (cell: TableCell) => ({
                      'data-cell-id': cell.id,
                      'data-cell-instance-id': `${question.rowId}:${question.rowId}:${cell.id}`,
                    });
                    const renderPieceCell = (cell: TableCell) =>
                      renderCell(
                        cell,
                        question,
                        inputIdScope,
                        errorCellIds?.has(cell.id) ?? false,
                        errorCellIds?.has(cell.id) ? errorDescriptionId : undefined,
                      );

                    // 원본 표 조각 하나 — 넓은 화면에서는 왼쪽에 붙이고, 글자 입력칸뿐이면 라벨 + 넓은 입력칸으로 푼다
                    const renderOriginalPiece = (
                      key: string,
                      piece: ChoiceGroupOriginalLine,
                    ) => {
                      const textFields = wide ? resolveWideTextInputFields(piece) : null;
                      if (textFields) {
                        return (
                          <div key={key} className="space-y-2 px-1">
                            {textFields.map(({ cell, label }) => {
                              // 화면 폭으로 그린다 — 원본 표 칸에 맞춘 고정 너비(inputWidth)는 여기서 뜻이 없다
                              const wideCell = { ...cell };
                              delete wideCell.inputWidth;
                              // 입력칸의 id 는 칸 렌더러가 정해 라벨로 직접 잇지 못한다 — 묶음의 이름으로 건다
                              const fieldLabelId = `${labelId}-${cell.id}-wide`;
                              return (
                                <div
                                  key={cell.id}
                                  {...(label ? { role: 'group', 'aria-labelledby': fieldLabelId } : {})}
                                  data-wide-text-cell={cell.id}
                                  {...issueTargetProps(cell)}
                                  className={cn(
                                    'space-y-1',
                                    errorCellIds?.has(cell.id) && 'rounded-lg ring-2 ring-red-300',
                                  )}
                                >
                                  {label ? (
                                    <p
                                      id={fieldLabelId}
                                      className="text-[13px] font-semibold text-gray-600"
                                    >
                                      {substituteTokens(label, attrs, quotes)}
                                    </p>
                                  ) : null}
                                  {renderPieceCell(wideCell)}
                                </div>
                              );
                            })}
                          </div>
                        );
                      }
                      return (
                        <div key={key} className={cn(wide && 'px-1')}>
                          <MobileOriginalRowTable
                            columns={piece.columns}
                            rows={[piece.row]}
                            interactiveRowId={piece.row.id}
                            headerGrid={piece.headerGrid}
                            hideColumnLabels={!piece.showColumnHeader}
                            choiceControlType={choiceControlType}
                            errorCellIds={errorCellIds}
                            instanceScope={`${question.rowId}:${key}`}
                            renderCell={renderPieceCell}
                            align={wide ? 'start' : 'center'}
                          />
                        </div>
                      );
                    };

                    return (
                      <div
                        key={question.rowId}
                        role="group"
                        aria-labelledby={titleId}
                        data-row-question-id={question.rowId}
                        className={cn('space-y-3 px-3 py-4', wide && 'px-5 py-5')}
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
                              ? systemText('mobile.checkAnswerOf', locale, { title: question.title })
                              : systemText('mobile.checkAnswer', locale)}
                          </p>
                        ) : null}
                        {/* 제외한 앞쪽 열에 놓인 응답 칸(「기타」 행의 입력칸 등) — 조각에 자리가 없어 여기 그린다 */}
                        {question.omittedAnswerCells.map((cell) => (
                          <div
                            key={cell.id}
                            data-omitted-answer-cell={cell.id}
                            {...issueTargetProps(cell)}
                            className={cn(
                              'px-1',
                              errorCellIds?.has(cell.id) && 'rounded-lg ring-2 ring-red-300',
                            )}
                          >
                            {renderPieceCell(cell)}
                          </div>
                        ))}
                        {/* 제목 아래 입력칸 — 조각 대신 화면 폭으로(척도 표 맨 아래 서술형 줄) */}
                        {question.belowTitleCells.map((cell) => {
                          // 화면 폭으로 그린다 — 원본 표 칸에 맞춘 고정 너비(inputWidth)는 여기서 뜻이 없다
                          const fullWidthCell = { ...cell };
                          delete fullWidthCell.inputWidth;
                          return (
                            <div
                              key={cell.id}
                              data-below-title-cell={cell.id}
                              {...issueTargetProps(cell)}
                              className={cn(
                                'px-1',
                                errorCellIds?.has(cell.id) && 'rounded-lg ring-2 ring-red-300',
                              )}
                            >
                              {renderPieceCell(fullWidthCell)}
                            </div>
                          );
                        })}
                        {question.hidesPiece ? null : segments && renderScaleBar && renderGroupTiles ? (
                          // 행별 척도 — 그룹은 제 보기 모양(타일·원본 한 줄·막대·슬라이더), 나머지 응답 칸은 원본 조각
                          <div className="space-y-3">
                            {segments.map((segment) =>
                              segment.kind === 'bar' ? (
                                <div key={segment.bar.key} className="px-1">
                                  {renderScaleBar(segment.bar, question, {
                                    inputIdScope,
                                    sharesRow: segments.length > 1,
                                  })}
                                </div>
                              ) : segment.kind === 'slider' ? (
                                // 슬라이더 조각은 슬라이더를 그리는 호스트의 배치에만 있다 — 그 호스트가 그리는 함수도 넘긴다.
                                // 조각 밖에 그리므로 첫 칸의 표식을 단다 — 미응답 안내의 「위치로 이동」이 이 줄을 찾는다
                                // (넓은 폭의 긴 표에서 문항 맨 위로 떨어지면 어느 줄인지 다시 찾아야 한다).
                                <div
                                  key={segment.slider.key}
                                  {...(segment.slider.cells[0]
                                    ? issueTargetProps(segment.slider.cells[0])
                                    : {})}
                                  className="px-1"
                                >
                                  {renderScaleSlider?.(segment.slider, question, {
                                    inputIdScope,
                                    sharesRow: segments.length > 1,
                                    titleId,
                                    errorDescriptionId,
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
                                renderOriginalPiece(segment.key, segment.piece)
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
                            align={wide ? 'start' : 'center'}
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
