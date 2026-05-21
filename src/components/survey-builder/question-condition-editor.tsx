'use client';

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';

import { AlertCircle, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { generateId } from '@/lib/utils';
import {
  ConditionLogicType,
  Question,
  QuestionCondition,
  QuestionConditionGroup,
} from '@/types/survey';
import { getMergedRowIds, getRowMergeInfo } from '@/utils/table-merge-helpers';

import { NumericComparisonEditor } from './numeric-comparison-editor';
import { TableOptionSelector } from './table-option-selector';

// 셀이 숫자 입력(input + inputType: 'number') 타입인지 판별하는 헬퍼
// rowIds 의 첫 번째 행의 cellColumnIndex 번 셀을 기준으로 판단한다.
function isNumericInputCell(
  sourceQuestion: Question | undefined,
  rowIds: string[],
  cellColumnIndex: number | undefined,
): boolean {
  if (!sourceQuestion || cellColumnIndex === undefined) return false;
  if (rowIds.length === 0) return false;
  const row = sourceQuestion.tableRowsData?.find((r) => r.id === rowIds[0]);
  if (!row) return false;
  const cell = row.cells[cellColumnIndex];
  return cell?.type === 'input' && cell.inputType === 'number';
}

interface QuestionConditionEditorProps {
  question: Question;
  onUpdate: (conditionGroup: QuestionConditionGroup | undefined) => void;
  allQuestions: Question[];
  allowAllQuestions?: boolean; // 그룹 편집 등에서 모든 질문 참조 허용
  initialCondition?: QuestionConditionGroup; // 외부에서 조건 주입 (테이블 행 조건 등)
}

export interface QuestionConditionEditorRef {
  getCurrentConditionGroup: () => QuestionConditionGroup | undefined;
}

export const QuestionConditionEditor = forwardRef<
  QuestionConditionEditorRef,
  QuestionConditionEditorProps
>(({ question, onUpdate, allQuestions, allowAllQuestions = false, initialCondition }, ref) => {
  const effectiveCondition = initialCondition ?? question.displayCondition;
  const [conditionGroup, setConditionGroup] = useState<QuestionConditionGroup | undefined>(
    effectiveCondition || {
      conditions: [],
      logicType: 'AND',
    },
  );
  const [expandedConditions, setExpandedConditions] = useState<Set<string>>(new Set());
  // 조건 이름을 로컬 상태로 관리 (리렌더링 방지)
  const [conditionNames, setConditionNames] = useState<Record<string, string>>({});

  // displayCondition이 변경될 때 conditionGroup과 conditionNames 초기화
  useEffect(() => {
    const source = initialCondition ?? question.displayCondition;
    const newConditionGroup = source || {
      conditions: [],
      logicType: 'AND',
    };
    setConditionGroup(newConditionGroup);

    // conditionNames 초기화: 저장된 조건 이름들을 로컬 상태에 반영
    const initialNames: Record<string, string> = {};
    if (newConditionGroup.conditions) {
      newConditionGroup.conditions.forEach((condition) => {
        if (condition.name) {
          initialNames[condition.id] = condition.name;
        }
      });
    }
    setConditionNames(initialNames);
  }, [initialCondition, question.displayCondition]);

  const addCondition = () => {
    const conditionCount = conditionGroup?.conditions.length || 0;
    const newCondition: QuestionCondition = {
      id: generateId(),
      name: `조건 ${conditionCount + 1}`,
      sourceQuestionId: '',
      conditionType: 'table-cell-check',
      logicType: 'AND',
      enabled: true,
    };

    // 새 조건 추가 시 자동으로 펼치기
    setExpandedConditions((prev) => new Set([...prev, newCondition.id]));

    const updatedGroup: QuestionConditionGroup = {
      ...conditionGroup,
      conditions: [...(conditionGroup?.conditions || []), newCondition],
      logicType: conditionGroup?.logicType || 'AND',
    };

    setConditionGroup(updatedGroup);
    onUpdate(updatedGroup);
  };

  const removeCondition = (conditionId: string) => {
    if (!conditionGroup) return;

    const updatedGroup: QuestionConditionGroup = {
      ...conditionGroup,
      conditions: conditionGroup.conditions.filter((c) => c.id !== conditionId),
    };

    setConditionGroup(updatedGroup);
    onUpdate(updatedGroup);
  };

  const updateCondition = useCallback(
    (conditionId: string, updates: Partial<QuestionCondition>) => {
      if (!conditionGroup) return;

      const updatedGroup: QuestionConditionGroup = {
        ...conditionGroup,
        conditions: conditionGroup.conditions.map((c) =>
          c.id === conditionId ? { ...c, ...updates } : c,
        ),
      };

      setConditionGroup(updatedGroup);
      // conditionNames도 동기화
      if (updates.name !== undefined) {
        setConditionNames((prev) => {
          const next = { ...prev };
          if (updates.name === undefined || updates.name === null) {
            delete next[conditionId];
          } else {
            next[conditionId] = updates.name;
          }
          return next;
        });
      }
      onUpdate(updatedGroup);
    },
    [conditionGroup, onUpdate],
  );

  // 모든 조건 이름을 conditionNames에서 가져와서 conditionGroup에 반영하는 함수
  const syncConditionNames = () => {
    if (!conditionGroup) return conditionGroup;

    const syncedGroup: QuestionConditionGroup = {
      ...conditionGroup,
      conditions: conditionGroup.conditions.map((c) => {
        const nameFromState = conditionNames[c.id];
        // conditionNames에 값이 있고, 현재 condition.name과 다르면 업데이트
        if (nameFromState !== undefined && c.name !== nameFromState) {
          return { ...c, name: nameFromState.trim() || undefined };
        }
        return c;
      }),
    };

    return syncedGroup;
  };

  // ref를 통해 외부에서 최신 conditionGroup을 가져올 수 있도록 노출
  useImperativeHandle(ref, () => ({
    getCurrentConditionGroup: () => {
      return syncConditionNames();
    },
  }));

  const updateGroupLogic = (logicType: ConditionLogicType) => {
    if (!conditionGroup) return;

    const updatedGroup: QuestionConditionGroup = {
      ...conditionGroup,
      logicType,
    };

    setConditionGroup(updatedGroup);
    onUpdate(updatedGroup);
  };

  const toggleRowId = (conditionId: string, rowId: string) => {
    const condition = conditionGroup?.conditions.find((c) => c.id === conditionId);
    if (!condition) return;

    const sourceQuestion = previousQuestions.find((q) => q.id === condition.sourceQuestionId);
    const colIndex = condition.tableConditions?.cellColumnIndex;

    // 병합된 행 ID들 가져오기
    const mergedRowIds = getMergedRowIds(rowId, sourceQuestion?.tableRowsData, colIndex);

    // tableConditions가 없으면 초기화
    const currentRowIds = condition.tableConditions?.rowIds || [];

    // 병합된 행 중 하나라도 선택되어 있으면 모두 제거, 아니면 모두 추가
    const isAnyMergedRowSelected = mergedRowIds.some((id) => currentRowIds.includes(id));

    let updatedRowIds: string[];
    if (isAnyMergedRowSelected) {
      // 병합된 행들 모두 제거
      updatedRowIds = currentRowIds.filter((id) => !mergedRowIds.includes(id));
    } else {
      // 병합된 행들 모두 추가 (중복 제거)
      updatedRowIds = [...new Set([...currentRowIds, ...mergedRowIds])];
    }

    updateCondition(conditionId, {
      tableConditions: {
        rowIds: updatedRowIds,
        checkType: condition.tableConditions?.checkType || 'any',
        cellColumnIndex: condition.tableConditions?.cellColumnIndex,
        expectedValues: condition.tableConditions?.expectedValues,
      },
    });
  };

  // 이전 질문들만 필터링 (현재 질문보다 앞에 있는 질문만)
  // allowAllQuestions가 true이면 모든 질문 허용 (그룹 편집 등)
  const previousQuestions = allowAllQuestions
    ? allQuestions
    : allQuestions.filter((q) => {
        const qIndex = allQuestions.findIndex((question) => question.id === q.id);
        const currentIndex = allQuestions.findIndex((q) => q.id === question.id);
        return qIndex < currentIndex;
      });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">질문 표시 조건</h3>
        <p className="text-sm text-gray-600">이전 질문의 응답에 따라 이 질문을 표시하거나 숨김</p>
      </div>

      <>
        {/* 조건 결합 방식 */}

        {/* 조건 추가 버튼 */}
        <div className="flex justify-end">
          <Button onClick={addCondition} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            조건 추가
          </Button>
        </div>

        {conditionGroup && conditionGroup.conditions.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-gray-500">
              <AlertCircle className="mx-auto mb-2 h-8 w-8 text-gray-400" />
              <p>조건이 없습니다. 조건을 추가해보세요.</p>
            </CardContent>
          </Card>
        )}

        {/* 조건 목록 */}
        {conditionGroup?.conditions.map((condition, index) => {
          const sourceQuestion = previousQuestions.find((q) => q.id === condition.sourceQuestionId);
          const isExpanded = expandedConditions.has(condition.id);
          // 로컬 상태가 있으면 사용, 없으면 condition.name 사용, 둘 다 없으면 빈 문자열
          const conditionName =
            conditionNames[condition.id] !== undefined
              ? conditionNames[condition.id]
              : (condition.name ?? '');

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
                        updateCondition(condition.id, { name: value });
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
                            onChange={(e) =>
                              updateCondition(condition.id, {
                                conditionType: e.target.value as
                                  | 'value-match'
                                  | 'table-cell-check'
                                  | 'custom',
                              })
                            }
                            className="w-full rounded-md border border-gray-300 p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          >
                            <option value="value-match">값 일치 (radio, select, checkbox)</option>
                            <option value="table-cell-check">테이블 셀 체크 확인</option>
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
                                      cellColumnIndex: condition.tableConditions?.cellColumnIndex,
                                      expectedValues: condition.tableConditions?.expectedValues,
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
                                      cellColumnIndex: value,
                                      expectedValues: condition.tableConditions?.expectedValues,
                                    },
                                  });
                                }}
                                placeholder="전체 열 확인 (비워두면 모든 열)"
                              />
                              <p className="text-xs text-gray-500">0부터 시작 (0 = 첫 번째 열)</p>
                            </div>

                            {/* 확인할 옵션 선택 (숫자 셀이면 NumericComparisonEditor, 아니면 TableOptionSelector) */}
                            {condition.tableConditions?.rowIds &&
                              condition.tableConditions.rowIds.length > 0 &&
                              condition.tableConditions?.cellColumnIndex !== undefined &&
                              sourceQuestion &&
                              (isNumericInputCell(
                                sourceQuestion,
                                condition.tableConditions.rowIds,
                                condition.tableConditions.cellColumnIndex,
                              ) ? (
                                <NumericComparisonEditor
                                  idPrefix={`numeric-${condition.id}`}
                                  value={condition.tableConditions.numericComparison}
                                  onChange={(nc) => {
                                    updateCondition(condition.id, {
                                      tableConditions: {
                                        ...condition.tableConditions,
                                        rowIds: condition.tableConditions?.rowIds || [],
                                        checkType: condition.tableConditions?.checkType || 'any',
                                        cellColumnIndex: condition.tableConditions?.cellColumnIndex,
                                        expectedValues: undefined,
                                        numericComparison: nc,
                                      },
                                    });
                                  }}
                                />
                              ) : (
                                <TableOptionSelector
                                  question={sourceQuestion}
                                  rowIds={condition.tableConditions.rowIds}
                                  colIndex={condition.tableConditions.cellColumnIndex}
                                  expectedValues={condition.tableConditions.expectedValues}
                                  onChange={(values) => {
                                    updateCondition(condition.id, {
                                      tableConditions: {
                                        ...condition.tableConditions,
                                        rowIds: condition.tableConditions?.rowIds || [],
                                        checkType: condition.tableConditions?.checkType || 'any',
                                        cellColumnIndex: condition.tableConditions?.cellColumnIndex,
                                        expectedValues: values,
                                        numericComparison: undefined,
                                      },
                                    });
                                  }}
                                  multipleRows={condition.tableConditions.rowIds.length > 1}
                                />
                              ))}
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
                                    updateCondition(condition.id, {
                                      additionalConditions: undefined,
                                    });
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

                                {/* 추가 조건 확인할 옵션 선택 (숫자 셀이면 NumericComparisonEditor, 아니면 TableOptionSelector) */}
                                {condition.additionalConditions.cellColumnIndex !== undefined &&
                                  sourceQuestion &&
                                  (() => {
                                    const effectiveRowIds =
                                      (condition.tableConditions?.rowIds?.length ?? 0) > 0
                                        ? (condition.tableConditions?.rowIds ?? [])
                                        : sourceQuestion.tableRowsData?.map((r) => r.id) || [];
                                    const isNumeric = isNumericInputCell(
                                      sourceQuestion,
                                      effectiveRowIds,
                                      condition.additionalConditions.cellColumnIndex,
                                    );

                                    if (isNumeric) {
                                      return (
                                        <NumericComparisonEditor
                                          idPrefix={`numeric-additional-${condition.id}`}
                                          value={condition.additionalConditions.numericComparison}
                                          onChange={(nc) => {
                                            updateCondition(condition.id, {
                                              additionalConditions: {
                                                ...condition.additionalConditions!,
                                                expectedValues: undefined,
                                                numericComparison: nc,
                                              },
                                            });
                                          }}
                                        />
                                      );
                                    }

                                    // input 셀(비수치) 은 옵션 셀렉터 없이 "값 있음" 으로만 처리
                                    if (condition.additionalConditions.checkType === 'input') {
                                      return null;
                                    }

                                    return (
                                      <TableOptionSelector
                                        question={sourceQuestion}
                                        rowIds={effectiveRowIds}
                                        colIndex={condition.additionalConditions.cellColumnIndex}
                                        expectedValues={condition.additionalConditions.expectedValues}
                                        onChange={(values) => {
                                          updateCondition(condition.id, {
                                            additionalConditions: {
                                              ...condition.additionalConditions!,
                                              expectedValues: values,
                                              numericComparison: undefined,
                                            },
                                          });
                                        }}
                                        helpText="선택한 옵션들 중 하나가 선택되었는지 확인합니다. 비워두면 아무거나 선택되었는지만 확인합니다."
                                        multipleRows={
                                          (condition.tableConditions?.rowIds?.length ?? 0) > 1 ||
                                          (condition.tableConditions?.rowIds?.length ?? 0) === 0
                                        }
                                      />
                                    );
                                  })()}
                              </div>
                            )}
                          </div>
                        )}

                      {/* 값 일치 조건 */}
                      {condition.conditionType === 'value-match' && (
                        <div className="space-y-2">
                          <Label htmlFor={`values-${condition.id}`}>필요한 값들</Label>

                          {/* 참조 질문의 옵션이 있으면 체크박스로 표시 */}
                          {sourceQuestion &&
                          (sourceQuestion.type === 'radio' ||
                            sourceQuestion.type === 'checkbox' ||
                            sourceQuestion.type === 'select') &&
                          sourceQuestion.options &&
                          sourceQuestion.options.length > 0 ? (
                            <div className="space-y-2">
                              <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-gray-200 p-3">
                                {sourceQuestion.options.map((option) => {
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
        })}

        {/* 조건 결합 방식 */}
        {conditionGroup && conditionGroup.conditions.length > 1 && (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-4">
              <div className="space-y-2">
                <Label>여러 조건 결합 방식</Label>
                <select
                  value={conditionGroup.logicType}
                  onChange={(e) => updateGroupLogic(e.target.value as ConditionLogicType)}
                  className="w-full rounded-md border border-gray-300 p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="AND">AND - 모든 조건을 만족해야 함</option>
                  <option value="OR">OR - 하나라도 만족하면 됨</option>
                  <option value="NOT">NOT - 모든 조건을 만족하지 않아야 함</option>
                </select>
              </div>
            </CardContent>
          </Card>
        )}
      </>
    </div>
  );
});

QuestionConditionEditor.displayName = 'QuestionConditionEditor';
