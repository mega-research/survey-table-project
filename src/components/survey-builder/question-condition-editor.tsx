'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';

import { AlertCircle, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { generateId } from '@/lib/utils';
import {
  ConditionLogicType,
  Question,
  QuestionCondition,
  QuestionConditionGroup,
} from '@/types/survey';
import { getMergedRowIds } from '@/utils/table-merge-helpers';

import { ConditionCard } from './condition-card';

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

  // tableConditions/additionalConditions는 expression 전환·토글 해제 시 비워야 한다.
  // name은 조건 이름 입력을 비웠을 때 영속 키를 제거해야 한다.
  // exactOptionalPropertyTypes 하에서 spread로는 키 제거가 불가하므로 clear 인자로 명시한다.
  type ClearableConditionKey = 'tableConditions' | 'additionalConditions' | 'name';

  const updateCondition = useCallback(
    (
      conditionId: string,
      updates: Partial<QuestionCondition>,
      clear?: ClearableConditionKey[],
    ) => {
      if (!conditionGroup) return;

      const mergeCondition = (c: QuestionCondition): QuestionCondition => {
        const merged: QuestionCondition = { ...c, ...updates };
        if (clear) {
          for (const key of clear) {
            delete merged[key];
          }
        }
        return merged;
      };

      const updatedGroup: QuestionConditionGroup = {
        ...conditionGroup,
        conditions: conditionGroup.conditions.map((c) =>
          c.id === conditionId ? mergeCondition(c) : c,
        ),
      };

      setConditionGroup(updatedGroup);
      // conditionNames도 동기화
      // clear에 name이 포함되면 이름을 비운 것이므로 로컬 엔트리를 제거한다.
      const clearsName = clear?.includes('name');
      if (updates.name !== undefined || clearsName) {
        setConditionNames((prev) => {
          const next = { ...prev };
          if (clearsName || updates.name === undefined || updates.name === null) {
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
          const trimmedName = nameFromState.trim();
          if (trimmedName) {
            return { ...c, name: trimmedName };
          }
          const { name: _n, ...rest } = c;
          return rest as typeof c;
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
        ...(condition.tableConditions?.cellColumnIndex !== undefined
          ? { cellColumnIndex: condition.tableConditions.cellColumnIndex }
          : {}),
        ...(condition.tableConditions?.expectedValues !== undefined
          ? { expectedValues: condition.tableConditions.expectedValues }
          : {}),
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
          const isExpanded = expandedConditions.has(condition.id);
          // 로컬 상태가 있으면 사용, 없으면 condition.name 사용, 둘 다 없으면 빈 문자열
          const conditionName =
            conditionNames[condition.id] !== undefined
              ? conditionNames[condition.id]
              : (condition.name ?? '');

          return (
            <ConditionCard
              key={condition.id}
              condition={condition}
              index={index}
              previousQuestions={previousQuestions}
              updateCondition={updateCondition}
              removeCondition={removeCondition}
              toggleRowId={toggleRowId}
              setConditionNames={setConditionNames}
              setExpandedConditions={setExpandedConditions}
              isExpanded={isExpanded}
              conditionName={conditionName}
            />
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
