'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Question, QuestionCondition } from '@/types/survey';
import { detectCellTypeKind } from '@/utils/cell-type-detector';
import { getRowMergeInfo } from '@/utils/table-merge-helpers';

import { ValueComparisonExpander } from '../value-comparison-expander';
import { buildMigrateHandler } from './build-migrate-handler';
import { UpdateConditionFn } from './types';

interface TableCellCheckEditorProps {
  condition: QuestionCondition;
  sourceQuestion: Question;
  updateCondition: UpdateConditionFn;
  toggleRowId: (conditionId: string, rowId: string) => void;
}

/**
 * table-cell-check 조건의 본문 (행 선택 + 체크 타입 + 열 인덱스 + 값 비교 펼치기).
 * ConditionCard 의 인라인 블록을 그대로 추출한 것으로 onUpdate/select/effectiveRowIds 의미론을 1:1 보존한다.
 */
export function TableCellCheckEditor({
  condition,
  sourceQuestion,
  updateCondition,
  toggleRowId,
}: TableCellCheckEditorProps) {
  return (
    <>
      <div className="space-y-2">
        <Label>체크 확인할 행 선택</Label>
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-gray-200 p-3">
          {sourceQuestion.tableRowsData?.map((row, rowIndex) => {
            const colIndex = condition.tableConditions?.cellColumnIndex;
            const mergeInfo = getRowMergeInfo(
              row.id,
              sourceQuestion?.tableRowsData,
              colIndex,
            );
            const isSelected =
              condition.tableConditions?.rowIds.includes(row.id) || false;
            const isMergeStart = mergeInfo.mergeStartRowId === row.id;

            return (
              <div
                key={row.id}
                className={`flex items-center gap-2 ${
                  mergeInfo.isMerged && !isMergeStart ? 'opacity-60' : ''
                }`}
              >
                <input
                  type="checkbox"
                  id={`cond-row-${condition.id}-${row.id}`}
                  checked={isSelected}
                  onChange={() => toggleRowId(condition.id, row.id)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  disabled={mergeInfo.isMerged && !isMergeStart}
                />
                <label
                  htmlFor={`cond-row-${condition.id}-${row.id}`}
                  className={`flex-1 cursor-pointer text-sm ${
                    mergeInfo.isMerged && !isMergeStart
                      ? 'cursor-not-allowed'
                      : ''
                  }`}
                >
                  {row.label}
                  {mergeInfo.isMerged && (
                    <span className="ml-2 text-xs text-blue-600">
                      {isMergeStart
                        ? `(행${rowIndex + 1}-${
                            rowIndex + mergeInfo.mergedRowIds.length
                          } 병합)`
                        : `(병합됨)`}
                    </span>
                  )}
                </label>
              </div>
            );
          })}
        </div>
        {(condition.tableConditions?.rowIds?.length ?? 0) === 0 && (
          <p className="text-xs text-red-600">
            최소 1개 이상의 행을 선택해주세요
          </p>
        )}
        {condition.tableConditions?.cellColumnIndex === undefined && (
          <p className="text-xs text-gray-500">
            💡 열을 먼저 선택하면 병합된 행 정보가 표시됩니다
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`check-type-${condition.id}`}>체크 조건</Label>
        <select
          id={`check-type-${condition.id}`}
          value={condition.tableConditions?.checkType || 'any'}
          onChange={(e) =>
            updateCondition(condition.id, {
              tableConditions: {
                rowIds: condition.tableConditions?.rowIds || [],
                checkType: e.target.value as 'any' | 'all' | 'none',
                ...(condition.tableConditions?.cellColumnIndex !== undefined
                  ? { cellColumnIndex: condition.tableConditions.cellColumnIndex }
                  : {}),
                ...(condition.tableConditions?.expectedValues !== undefined
                  ? { expectedValues: condition.tableConditions.expectedValues }
                  : {}),
              },
            })
          }
          className="w-full rounded-md border border-gray-300 p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        >
          <option value="any">하나라도 체크됨</option>
          <option value="all">모두 체크됨</option>
          <option value="none">모두 체크 안됨</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`col-index-${condition.id}`}>
          특정 열만 확인 (선택)
        </Label>
        <Input
          id={`col-index-${condition.id}`}
          type="number"
          min="0"
          value={condition.tableConditions?.cellColumnIndex ?? ''}
          onChange={(e) => {
            const value =
              e.target.value === ''
                ? undefined
                : parseInt(e.target.value, 10);
            updateCondition(condition.id, {
              tableConditions: {
                rowIds: condition.tableConditions?.rowIds || [],
                checkType: condition.tableConditions?.checkType || 'any',
                ...(value !== undefined ? { cellColumnIndex: value } : {}),
                ...(condition.tableConditions?.expectedValues !== undefined
                  ? { expectedValues: condition.tableConditions.expectedValues }
                  : {}),
              },
            });
          }}
          placeholder="전체 열 확인 (비워두면 모든 열)"
        />
        <p className="text-xs text-gray-500">0부터 시작 (0 = 첫 번째 열)</p>
      </div>

      {/* 값 비교 조건 — 펼치기 패턴 */}
      {condition.tableConditions?.rowIds &&
        condition.tableConditions.rowIds.length > 0 &&
        condition.tableConditions?.cellColumnIndex !== undefined && (
          <ValueComparisonExpander
            kind={detectCellTypeKind(
              sourceQuestion,
              condition.tableConditions.rowIds,
              condition.tableConditions.cellColumnIndex,
            )}
            idPrefix={`numeric-${condition.id}`}
            sourceQuestion={sourceQuestion}
            rowIds={condition.tableConditions.rowIds}
            colIndex={condition.tableConditions.cellColumnIndex}
            comparison={{
              expectedValues: condition.tableConditions.expectedValues,
              numericComparison: condition.tableConditions.numericComparison,
            }}
            multipleRows={condition.tableConditions.rowIds.length > 1}
            onChange={(next) =>
              updateCondition(condition.id, {
                tableConditions: {
                  ...condition.tableConditions!,
                  ...(next.expectedValues !== undefined
                    ? { expectedValues: next.expectedValues }
                    : {}),
                  ...(next.numericComparison !== undefined
                    ? { numericComparison: next.numericComparison }
                    : {}),
                },
              })
            }
            onMigrateToExpression={buildMigrateHandler(
              condition.tableConditions?.numericComparison,
              condition.tableConditions?.rowIds,
              condition.tableConditions?.cellColumnIndex,
              sourceQuestion,
              (expressionConfig) =>
                updateCondition(
                  condition.id,
                  {
                    conditionType: 'expression',
                    expressionConfig,
                  },
                  ['tableConditions'],
                ),
            )}
          />
        )}
    </>
  );
}
