'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Question, QuestionCondition } from '@/types/survey';
import { detectCellTypeKind } from '@/utils/cell-type-detector';

import { ValueComparisonExpander } from '../value-comparison-expander';
import { buildMigrateHandler } from './build-migrate-handler';
import { UpdateConditionFn } from './types';

interface AdditionalConditionsEditorProps {
  condition: QuestionCondition;
  sourceQuestion: Question;
  updateCondition: UpdateConditionFn;
}

/**
 * table-cell-check 조건의 추가 조건 (중첩) 블록.
 * 토글 on/off 시 additionalConditions 생성/clear, 열 인덱스/체크 타입 select,
 * IIFE 로 effectiveRowIds 를 계산해 값 비교 펼치기를 렌더한다 — ConditionCard 인라인 의미론을 1:1 보존.
 */
export function AdditionalConditionsEditor({
  condition,
  sourceQuestion,
  updateCondition,
}: AdditionalConditionsEditorProps) {
  return (
    <div className="space-y-3 border-t border-gray-200 pt-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">추가 조건 (선택)</Label>
        <Switch
          checked={!!condition.additionalConditions}
          onCheckedChange={(checked) => {
            if (checked) {
              updateCondition(condition.id, {
                additionalConditions: {
                  cellColumnIndex: 0,
                  checkType: 'radio',
                },
              });
            } else {
              updateCondition(condition.id, {}, [
                'additionalConditions',
              ]);
            }
          }}
        />
      </div>

      {condition.additionalConditions && (
        <div className="space-y-3 border-l-2 border-blue-200 pl-4">
          {/* 추가 조건 열 인덱스 */}
          <div className="space-y-2">
            <Label htmlFor={`additional-col-${condition.id}`}>
              확인할 열 인덱스
            </Label>
            <Input
              id={`additional-col-${condition.id}`}
              type="number"
              min="0"
              max={(sourceQuestion.tableColumns?.length || 1) - 1}
              value={condition.additionalConditions.cellColumnIndex ?? ''}
              onChange={(e) => {
                const value =
                  e.target.value === ''
                    ? undefined
                    : parseInt(e.target.value, 10);
                updateCondition(condition.id, {
                  additionalConditions: {
                    ...condition.additionalConditions!,
                    cellColumnIndex: value ?? 0,
                  },
                });
              }}
              placeholder="0"
            />
            <p className="text-xs text-gray-500">
              0부터 시작 (0 = 첫 번째 열)
            </p>
          </div>

          {/* 추가 조건 체크 타입 */}
          <div className="space-y-2">
            <Label htmlFor={`additional-check-type-${condition.id}`}>
              체크 타입
            </Label>
            <select
              id={`additional-check-type-${condition.id}`}
              value={condition.additionalConditions.checkType}
              onChange={(e) =>
                updateCondition(condition.id, {
                  additionalConditions: {
                    ...condition.additionalConditions!,
                    checkType: e.target.value as
                      | 'checkbox'
                      | 'radio'
                      | 'select'
                      | 'input',
                  },
                })
              }
              className="w-full rounded-md border border-gray-300 p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="checkbox">체크박스</option>
              <option value="radio">라디오 버튼</option>
              <option value="select">드롭다운</option>
              <option value="input">입력 필드</option>
            </select>
          </div>

          {/* 추가 조건 — 값 비교 펼치기 패턴 */}
          {condition.additionalConditions &&
            condition.additionalConditions.cellColumnIndex !== undefined &&
            (() => {
              const ac = condition.additionalConditions!;
              const mainRowCount =
                condition.tableConditions?.rowIds?.length ?? 0;
              const effectiveRowIds =
                mainRowCount > 0
                  ? (condition.tableConditions?.rowIds ?? [])
                  : (sourceQuestion?.tableRowsData?.map((r) => r.id) ?? []);
              return (
                <ValueComparisonExpander
                  kind={detectCellTypeKind(
                    sourceQuestion,
                    effectiveRowIds,
                    ac.cellColumnIndex,
                  )}
                  idPrefix={`numeric-additional-${condition.id}`}
                  sourceQuestion={sourceQuestion}
                  rowIds={effectiveRowIds}
                  colIndex={ac.cellColumnIndex!}
                  comparison={{
                    expectedValues: ac.expectedValues,
                    numericComparison: ac.numericComparison,
                  }}
                  multipleRows={mainRowCount !== 1}
                  helpText="선택한 옵션들 중 하나가 선택되었는지 확인합니다. 비워두면 아무거나 선택되었는지만 확인합니다."
                  onChange={(next) =>
                    updateCondition(condition.id, {
                      additionalConditions: {
                        ...ac,
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
                    ac.numericComparison,
                    effectiveRowIds,
                    ac.cellColumnIndex,
                    sourceQuestion,
                    (expressionConfig) =>
                      updateCondition(
                        condition.id,
                        {
                          conditionType: 'expression',
                          expressionConfig,
                        },
                        ['tableConditions', 'additionalConditions'],
                      ),
                  )}
                />
              );
            })()}
        </div>
      )}
    </div>
  );
}
