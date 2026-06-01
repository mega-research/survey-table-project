'use client';

import { X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FilterCondition, FilterOperator } from '@/lib/analytics/filter';
import {
  getAvailableOperators,
  getOperatorLabel,
  isFilterableQuestion,
} from '@/lib/analytics/filter';
import type { Question } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';

interface FilterConditionRowProps {
  condition: FilterCondition;
  questions: Question[];
  onUpdate: (updates: Partial<FilterCondition>) => void;
  onRemove: () => void;
  showLogicBadge?: 'AND' | 'OR';
}

export function FilterConditionRow({
  condition,
  questions,
  onUpdate,
  onRemove,
  showLogicBadge,
}: FilterConditionRowProps) {
  const filterableQuestions = questions.filter(isFilterableQuestion);
  const selectedQuestion = questions.find((q) => q.id === condition.questionId);
  const availableOperators = selectedQuestion ? getAvailableOperators(selectedQuestion.type) : [];

  // 값 선택이 필요한 연산자인지 확인
  const needsValue = !['is_empty', 'is_not_empty'].includes(condition.operator);

  // 선택지 옵션 가져오기
  const getOptions = () => {
    if (!selectedQuestion) return [];

    if (['radio', 'select', 'checkbox'].includes(selectedQuestion.type)) {
      return resolveChoiceOptions(selectedQuestion);
    }

    if (selectedQuestion.type === 'multiselect' && selectedQuestion.selectLevels) {
      return selectedQuestion.selectLevels[0]?.options || [];
    }

    return [];
  };

  const options = getOptions();
  const hasOptions = options.length > 0;

  // Combobox용 옵션 변환
  const questionComboboxOptions = filterableQuestions.map((q) => ({
    value: q.id,
    label: q.title,
  }));

  const valueComboboxOptions = options.map((opt) => ({
    value: opt.value,
    label: opt.label,
  }));

  // 옵션이 5개 이상이면 Combobox 사용
  const useComboboxForValues = options.length >= 5;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-3">
      {showLogicBadge && (
        <Badge variant="outline" className="text-xs font-medium">
          {showLogicBadge}
        </Badge>
      )}

      {/* 질문 선택 - Combobox */}
      <Combobox
        options={questionComboboxOptions}
        value={condition.questionId}
        onValueChange={(value) => onUpdate({ questionId: value, value: undefined })}
        placeholder="질문 선택"
        searchPlaceholder="질문 검색..."
        emptyText="질문을 찾을 수 없습니다"
        triggerClassName="w-[200px] bg-white"
        className="w-[250px]"
      />

      {/* 연산자 선택 - Select 유지 (옵션 적음) */}
      <Select
        value={condition.operator}
        onValueChange={(value: string) => onUpdate({ operator: value as FilterOperator })}
        disabled={!selectedQuestion}
      >
        <SelectTrigger className="w-[140px] bg-white">
          <SelectValue placeholder="조건" />
        </SelectTrigger>
        <SelectContent>
          {availableOperators.map((op) => (
            <SelectItem key={op} value={op}>
              {getOperatorLabel(op)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 값 선택/입력 */}
      {needsValue && selectedQuestion && (
        <>
          {hasOptions ? (
            useComboboxForValues ? (
              // 옵션이 5개 이상이면 Combobox
              <Combobox
                options={valueComboboxOptions}
                value={Array.isArray(condition.value) ? condition.value[0] : condition.value || ''}
                onValueChange={(value) => onUpdate({ value })}
                placeholder="값 선택"
                searchPlaceholder="값 검색..."
                emptyText="값을 찾을 수 없습니다"
                triggerClassName="w-[180px] bg-white"
                className="w-[220px]"
              />
            ) : (
              // 옵션이 5개 미만이면 Select
              <Select
                value={Array.isArray(condition.value) ? condition.value[0] : condition.value || ''}
                onValueChange={(value: string) => onUpdate({ value })}
              >
                <SelectTrigger className="w-[180px] bg-white">
                  <SelectValue placeholder="값 선택" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((opt) => (
                    <SelectItem key={opt.id} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          ) : (
            // 텍스트 입력
            <Input
              value={typeof condition.value === 'string' ? condition.value : ''}
              onChange={(e) => onUpdate({ value: e.target.value })}
              placeholder="값 입력"
              className="w-[180px] bg-white"
            />
          )}
        </>
      )}

      {/* 삭제 버튼 */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onRemove}
        className="text-gray-400 hover:text-red-500"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
