'use client';

import { useId } from 'react';
import type React from 'react';

import type {
  MobileRowWiseOriginalModel,
  MobileRowWiseOriginalQuestion,
} from '@/features/question-renderer/utils/mobile-row-wise-original';
import { cn } from '@/lib/utils';
import type { TableCell } from '@/types/survey';

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
   * 행 본문을 원본 표 조각 대신 다른 것(행별 척도의 척도 막대)으로 그린다. null 을 돌려주면 그 행은
   * 원본 표 조각 그대로다(막대로 못 그리는 행의 폴백).
   */
  renderBody?:
    | ((question: MobileRowWiseOriginalQuestion, context: RowBodyContext) => React.ReactNode | null)
    | undefined;
}

export interface RowBodyContext {
  inputIdScope: string;
}

export function MobileRowWiseOriginalSheet({
  model,
  renderCell,
  choiceControlType,
  errorCellIds,
  renderBody,
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
                    const hasError = question.projection.row.cells.some((cell) =>
                      errorCellIds?.has(cell.id),
                    );
                    const inputIdScope = question.rowId;
                    const errorDescriptionId = hasError ? `${labelId}-error` : undefined;
                    const customBody = renderBody?.(question, { inputIdScope });

                    return (
                      <div
                        key={question.rowId}
                        role="group"
                        aria-labelledby={useSubgroupTitle ? subgroupLabelId : labelId}
                        data-row-question-id={question.rowId}
                        className="space-y-3 px-3 py-4"
                      >
                        {!useSubgroupTitle ? (
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
                            {question.title}의 응답을 확인해 주세요.
                          </p>
                        ) : null}
                        {customBody ?? (
                          <MobileOriginalRowTable
                            columns={question.projection.columns}
                            rows={[...question.projection.repeatedRows, question.projection.row]}
                            interactiveRowId={question.projection.row.id}
                            headerGrid={question.projection.headerGrid}
                            hideColumnLabels={!question.projection.showColumnHeader}
                            choiceControlType={choiceControlType}
                            errorCellIds={errorCellIds}
                            instanceScope={question.rowId}
                            renderCell={(cell) =>
                              renderCell(
                                cell,
                                question,
                                inputIdScope,
                                errorCellIds?.has(cell.id) ?? false,
                                errorCellIds?.has(cell.id) ? errorDescriptionId : undefined,
                              )
                            }
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
