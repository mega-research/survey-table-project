'use client';

import { Dispatch, SetStateAction } from 'react';

import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Question, QuestionCondition } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';

import { AdditionalConditionsEditor } from './condition-card/additional-conditions-editor';
import { TableCellCheckEditor } from './condition-card/table-cell-check-editor';
import { ClearableConditionKey } from './condition-card/types';
import { ValueMatchEditor } from './condition-card/value-match-editor';
import { ExpressionConditionEditor } from './expression-condition-editor';

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
 * 한 조건 카드 본문 (헤더 + 참조질문/조건타입 select + 조건타입별 하위 에디터).
 * 조건타입별 블록은 TableCellCheckEditor / AdditionalConditionsEditor / ValueMatchEditor 로 분해했고,
 * ConditionCard 는 헤더·Collapsible·select 를 가진 얇은 오케스트레이터다.
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
                // 빈 값이면 spread no-op 대신 clear로 name 키를 제거해 영속 이름을 비운다.
                // ({} 만 넘기면 merge가 기존 name을 보존해 이름을 지울 수 없다)
                if (value !== undefined) {
                  updateCondition(condition.id, { name: value });
                } else {
                  updateCondition(condition.id, {}, ['name']);
                }
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
                  <TableCellCheckEditor
                    condition={condition}
                    sourceQuestion={sourceQuestion}
                    updateCondition={updateCondition}
                    toggleRowId={toggleRowId}
                  />
                )}

              {/* 추가 조건 설정 (테이블 셀 체크 조건일 때만) */}
              {condition.conditionType === 'table-cell-check' &&
                sourceQuestion?.type === 'table' && (
                  <AdditionalConditionsEditor
                    condition={condition}
                    sourceQuestion={sourceQuestion}
                    updateCondition={updateCondition}
                  />
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
                <ValueMatchEditor
                  condition={condition}
                  updateCondition={updateCondition}
                  valueMatchOptions={valueMatchOptions}
                />
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}
