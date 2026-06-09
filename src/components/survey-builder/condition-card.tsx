'use client';

import { Dispatch, SetStateAction } from 'react';

import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  ExpressionConditionConfig,
  NumericComparison,
  Question,
  QuestionCondition,
} from '@/types/survey';
import { detectCellTypeKind } from '@/utils/cell-type-detector';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { getRowMergeInfo } from '@/utils/table-merge-helpers';

import { ExpressionConditionEditor } from './expression-condition-editor';
import { ValueComparisonExpander } from './value-comparison-expander';
import { migrateNumericComparisonToExpression } from '@/utils/expression-migration';

/**
 * 메인/추가 조건 양쪽에서 numericComparison → expression 변환 버튼이 노출될 조건과
 * 클릭 시 동작을 한 곳에서 결정. 변환 후 처리 (tableConditions/additionalConditions 정리) 는
 * 호출자가 onMigrate 콜백 안에서 결정한다.
 *
 * 가드: numericComparison 존재 + rowIds[0] + cellColumnIndex + 그 셀이 input 타입.
 * input 이 아닌 셀(text/image/radio 등) 을 outerCellRef 로 잡으면 마이그레이션 후
 * expression cell operand 가 무의미한 셀을 가리키므로 버튼 자체를 미노출.
 */
function buildMigrateHandler(
  nc: NumericComparison | undefined,
  rowIds: string[] | undefined,
  cellColumnIndex: number | undefined,
  sourceQuestion: Question | undefined,
  onMigrate: (config: ExpressionConditionConfig) => void,
): (() => void) | undefined {
  if (!nc || !sourceQuestion || cellColumnIndex === undefined) return undefined;
  const outerRow = rowIds?.[0];
  if (!outerRow) return undefined;
  const row = sourceQuestion.tableRowsData?.find((r) => r.id === outerRow);
  const cell = row?.cells[cellColumnIndex];
  if (!cell || cell.type !== 'input') return undefined;
  return () => {
    const expressionConfig = migrateNumericComparisonToExpression(nc, {
      questionId: sourceQuestion.id,
      cellId: cell.id,
    });
    onMigrate(expressionConfig);
  };
}

// tableConditions/additionalConditions는 expression 전환·토글 해제 시 비워야 한다.
// exactOptionalPropertyTypes 하에서 spread로는 키 제거가 불가하므로 clear 인자로 명시한다.
type ClearableConditionKey = 'tableConditions' | 'additionalConditions';

interface ConditionCardProps {
  condition: QuestionCondition;
  index: number;
  previousQuestions: Question[];
  updateCondition: (
    conditionId: string,
    updates: Partial<QuestionCondition>,
    clear?: ClearableConditionKey[],
  ) => void;
  removeCondition: (conditionId: string) => void;
  toggleRowId: (conditionId: string, rowId: string) => void;
  setConditionNames: Dispatch<SetStateAction<Record<string, string>>>;
  setExpandedConditions: Dispatch<SetStateAction<Set<string>>>;
  // 펼침 상태와 이름은 부모에서 동일 식으로 계산해 내려준다 (로컬 상태 의미론 보존).
  isExpanded: boolean;
  // noUncheckedIndexedAccess 하에서 conditionNames[id] 가 string | undefined 로 넓어진다.
  // 원본 소비처(Input value)가 undefined 를 허용했던 의미론을 그대로 보존하기 위해 동일 타입으로 받는다.
  conditionName: string | undefined;
}

/**
 * 한 조건 카드 본문 (헤더 + value-match / table-cell-check / expression / additionalConditions).
 * 부모(QuestionConditionEditor)의 map 콜백 인라인 JSX 를 그대로 추출한 것으로,
 * 핸들러·파생값 계산식·effect 의미론을 1:1 보존한다.
 */
export function ConditionCard({
  condition,
  index,
  previousQuestions,
  updateCondition,
  removeCondition,
  toggleRowId,
  setConditionNames,
  setExpandedConditions,
  isExpanded,
  conditionName,
}: ConditionCardProps) {
  const sourceQuestion = previousQuestions.find((q) => q.id === condition.sourceQuestionId);
  // 값-일치 조건의 옵션 소스. 테이블-소스 choice radio/checkbox 는 question.options 가 비어
  // 있고 choice_opt 셀에서 옵션을 가져오므로 resolveChoiceOptions 로 통합 해석한다.
  // (manual 옵션 질문은 그대로 question.options 반환 → 동작 동일)
  // value 가 cell.id 인 table-source 응답과 매칭되도록 체크박스 picker 의 저장값을 일치시킨다.
  // value-match 조건일 때만 계산 — 다른 타입(table-cell-check/expression)에선 미사용이라
  // resolveChoiceOptions 의 tableRowsData 전체 스캔을 건너뛴다.
  const valueMatchOptions =
    condition.conditionType === 'value-match' &&
    sourceQuestion &&
    (sourceQuestion.type === 'radio' ||
      sourceQuestion.type === 'checkbox' ||
      sourceQuestion.type === 'select')
      ? resolveChoiceOptions(sourceQuestion)
      : [];

  return (
    <Card key={condition.id} className="border-l-4 border-l-green-500">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex flex-1 items-center gap-2">
            <Switch
              checked={condition.enabled !== false}
              onCheckedChange={(checked) => {
                updateCondition(condition.id, { enabled: checked });
              }}
              className="scale-90"
            />
            <Input
              value={conditionName}
              onChange={(e) => {
                // 로컬 상태만 업데이트 (리렌더링 방지)
                setConditionNames((prev) => ({
                  ...prev,
                  [condition.id]: e.target.value,
                }));
              }}
              onBlur={(e) => {
                // 포커스를 잃을 때만 실제 업데이트
                const value = e.target.value.trim() || undefined;
                updateCondition(condition.id, value !== undefined ? { name: value } : {} as Partial<QuestionCondition>);
                // 로컬 상태도 동기화
                setConditionNames((prev) => {
                  const next = { ...prev };
                  if (value === undefined) {
                    delete next[condition.id];
                  } else {
                    next[condition.id] = value;
                  }
                  return next;
                });
              }}
              className="h-auto max-w-xs flex-1 border-0 p-0 text-base font-semibold shadow-none focus-visible:ring-0"
              placeholder={`조건 ${index + 1}`}
            />
            {condition.enabled === false && (
              <span className="text-xs text-gray-500">(비활성화됨)</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              removeCondition(condition.id);
            }}
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      {condition.enabled !== false && (
        <Collapsible
          open={isExpanded}
          onOpenChange={(open) => {
            setExpandedConditions((prev) => {
              const next = new Set(prev);
              if (open) {
                next.add(condition.id);
              } else {
                next.delete(condition.id);
              }
              return next;
            });
          }}
        >
          <CollapsibleTrigger asChild>
            <div className="cursor-pointer px-6 pb-2 transition-colors hover:bg-gray-50">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <span>상세 설정 {isExpanded ? '접기' : '펼치기'}</span>
              </div>
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              {/* 참조할 질문 선택 */}
              <div className="space-y-2">
                <Label htmlFor={`source-${condition.id}`}>참조할 질문</Label>
                <select
                  id={`source-${condition.id}`}
                  value={condition.sourceQuestionId}
                  onChange={(e) => {
                    const selectedQ = previousQuestions.find(
                      (q) => q.id === e.target.value,
                    );
                    // 질문 타입에 따라 conditionType 자동 설정
                    const autoConditionType =
                      selectedQ?.type === 'table' ? 'table-cell-check' : 'value-match';
                    updateCondition(condition.id, {
                      sourceQuestionId: e.target.value,
                      conditionType: autoConditionType,
                    });
                  }}
                  className="w-full rounded-md border border-gray-300 p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="">질문 선택...</option>
                  {previousQuestions.map((q, idx) => (
                    <option key={q.id} value={q.id}>
                      {idx + 1}. {q.title} ({q.type})
                    </option>
                  ))}
                </select>
                {!condition.sourceQuestionId && (
                  <p className="text-xs text-red-600">질문을 선택해주세요</p>
                )}
              </div>

              {/* 조건 타입 */}
              {condition.sourceQuestionId && (
                <div className="space-y-2">
                  <Label htmlFor={`type-${condition.id}`}>조건 타입</Label>
                  <select
                    id={`type-${condition.id}`}
                    value={condition.conditionType}
                    onChange={(e) => {
                      const newType = e.target.value as
                        | 'value-match'
                        | 'table-cell-check'
                        | 'expression'
                        | 'custom';
                      updateCondition(condition.id, {
                        conditionType: newType,
                        ...(newType === 'expression' && !condition.expressionConfig
                          ? { expressionConfig: { clauses: [], joinOps: [] } }
                          : {}),
                      });
                    }}
                    className="w-full rounded-md border border-gray-300 p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="value-match">값 일치 (radio, select, checkbox)</option>
                    <option value="table-cell-check">테이블 셀 체크 확인</option>
                    <option value="expression">장기 계산식</option>
                  </select>
                </div>
              )}

              {/* 테이블 셀 체크 조건 */}
              {condition.conditionType === 'table-cell-check' &&
                sourceQuestion?.type === 'table' && (
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
                )}

              {/* 추가 조건 설정 (테이블 셀 체크 조건일 때만) */}
              {condition.conditionType === 'table-cell-check' &&
                sourceQuestion?.type === 'table' && (
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
                )}

              {condition.conditionType === 'expression' && (
                <ExpressionConditionEditor
                  config={condition.expressionConfig ?? { clauses: [], joinOps: [] }}
                  onChange={(next) => updateCondition(condition.id, { expressionConfig: next })}
                  idPrefix={`expr-${condition.id}`}
                />
              )}

              {/* 값 일치 조건 */}
              {condition.conditionType === 'value-match' && (
                <div className="space-y-2">
                  <Label htmlFor={`values-${condition.id}`}>필요한 값들</Label>

                  {/* 참조 질문의 옵션이 있으면 체크박스로 표시 (테이블-소스 choice 포함) */}
                  {valueMatchOptions.length > 0 ? (
                    <div className="space-y-2">
                      <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-gray-200 p-3">
                        {valueMatchOptions.map((option) => {
                          const isSelected = (condition.requiredValues || []).includes(
                            option.value,
                          );
                          return (
                            <div key={option.id} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id={`cond-opt-${condition.id}-${option.id}`}
                                checked={isSelected}
                                onChange={(e) => {
                                  const currentValues = condition.requiredValues || [];
                                  const newValues = e.target.checked
                                    ? [...currentValues, option.value]
                                    : currentValues.filter((v) => v !== option.value);
                                  updateCondition(condition.id, {
                                    requiredValues: newValues.length > 0 ? newValues : [],
                                  });
                                }}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <label
                                htmlFor={`cond-opt-${condition.id}-${option.id}`}
                                className="flex-1 cursor-pointer text-sm"
                              >
                                {option.label}
                                <span className="ml-2 text-xs text-gray-400">
                                  (값: {option.value})
                                </span>
                              </label>
                            </div>
                          );
                        })}
                      </div>
                      {(condition.requiredValues || []).length === 0 && (
                        <p className="text-xs text-red-600">
                          최소 1개 이상의 옵션을 선택해주세요
                        </p>
                      )}
                    </div>
                  ) : (
                    // 옵션이 없거나 텍스트 타입인 경우 직접 입력
                    <>
                      <Input
                        id={`values-${condition.id}`}
                        value={(condition.requiredValues || []).join(', ')}
                        onChange={(e) => {
                          const values = e.target.value
                            .split(',')
                            .map((v) => v.trim())
                            .filter((v) => v);
                          updateCondition(condition.id, { requiredValues: values });
                        }}
                        placeholder="예: ②, 2, 평상시에 끊기기도 한다"
                      />
                      <p className="text-xs text-gray-500">
                        참조 질문의 응답 값과 일치하는 값들을 쉼표로 구분하여 입력하세요
                      </p>
                    </>
                  )}

                  <p className="text-xs text-blue-600">
                    💡 참조 질문의 응답이 선택한 값들 중 하나와 일치하면 조건 만족
                  </p>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}
