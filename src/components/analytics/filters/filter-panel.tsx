'use client';

import { useState } from 'react';

import { ChevronDown, ChevronUp, Filter, Plus, RotateCcw, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SurveyResponse } from '@/db/schema';
import type { FilterCondition, FilterLogic, FilterState } from '@/lib/analytics/filter';
import {
  addConditionToFilter,
  createEmptyFilter,
  createFilterCondition,
  getActiveFilterCount,
  getFilterSummary,
  isFilterableQuestion,
  removeConditionFromFilter,
  updateConditionInFilter,
} from '@/lib/analytics/filter';
import type { Question } from '@/types/survey';

import { FilterConditionRow } from './filter-condition';

interface FilterPanelProps {
  questions: Question[];
  responses: SurveyResponse[];
  filter: FilterState;
  onFilterChange: (filter: FilterState) => void;
}

export function FilterPanel({ questions, responses, filter, onFilterChange }: FilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const filterableQuestions = questions.filter(isFilterableQuestion);
  const activeCount = getActiveFilterCount(filter);
  const summary = getFilterSummary(filter, responses, questions);

  // 새 조건 추가
  const handleAddCondition = () => {
    if (filterableQuestions.length === 0) return;

    const newCondition = createFilterCondition(filterableQuestions[0].id);
    const updatedFilter = addConditionToFilter(filter, newCondition);
    onFilterChange(updatedFilter);
  };

  // 조건 제거
  const handleRemoveCondition = (conditionId: string) => {
    const updatedFilter = removeConditionFromFilter(filter, conditionId);
    onFilterChange(updatedFilter);
  };

  // 조건 업데이트
  const handleUpdateCondition = (conditionId: string, updates: Partial<FilterCondition>) => {
    const updatedFilter = updateConditionInFilter(filter, conditionId, updates);
    onFilterChange(updatedFilter);
  };

  // 그룹 로직 변경
  const handleGroupLogicChange = (logic: FilterLogic) => {
    onFilterChange({
      ...filter,
      groupLogic: logic,
    });
  };

  // 필터 초기화
  const handleReset = () => {
    onFilterChange(createEmptyFilter());
  };

  // 모든 조건 가져오기 (그룹 평탄화)
  const allConditions = filter.groups.flatMap((group, groupIndex) =>
    group.conditions.map((condition, conditionIndex) => ({
      ...condition,
      groupIndex,
      conditionIndex,
      showLogic: groupIndex > 0 || conditionIndex > 0,
    })),
  );

  return (
    <Card className="mb-6">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="border-b border-gray-100 p-4">
          <div className="flex items-center justify-between">
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 hover:opacity-80">
                <Filter className="h-5 w-5 text-blue-500" />
                <h3 className="font-semibold text-gray-900">필터</h3>
                {activeCount > 0 && (
                  <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
                    {activeCount}개 조건
                  </Badge>
                )}
                {isOpen ? (
                  <ChevronUp className="ml-1 h-4 w-4 text-gray-400" />
                ) : (
                  <ChevronDown className="ml-1 h-4 w-4 text-gray-400" />
                )}
              </button>
            </CollapsibleTrigger>

            {/* 필터 결과 요약 */}
            {activeCount > 0 && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <Users className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-600">
                    <span className="font-semibold text-blue-600">
                      {summary.filteredResponses}명
                    </span>
                    <span className="mx-1 text-gray-400">/</span>
                    <span>{summary.totalResponses}명</span>
                    <span className="ml-1 text-gray-400">({summary.filterRate.toFixed(1)}%)</span>
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  className="text-gray-500 hover:text-red-500"
                >
                  <RotateCcw className="mr-1 h-4 w-4" />
                  초기화
                </Button>
              </div>
            )}
          </div>
        </div>

        <CollapsibleContent>
          <div className="space-y-3 p-4">
            {/* 조건 목록 */}
            {allConditions.length > 0 ? (
              <>
                {/* 로직 선택 (조건이 2개 이상일 때) */}
                {allConditions.length > 1 && (
                  <div className="mb-4 flex items-center gap-2">
                    <span className="text-sm text-gray-500">조건 결합:</span>
                    <Select
                      value={filter.groupLogic}
                      onValueChange={(value: string) =>
                        handleGroupLogicChange(value as FilterLogic)
                      }
                    >
                      <SelectTrigger className="w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AND">AND (모두 만족)</SelectItem>
                        <SelectItem value="OR">OR (하나라도)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* 조건 카드들 */}
                <div className="space-y-2">
                  {allConditions.map((condition, index) => (
                    <FilterConditionRow
                      key={condition.id}
                      condition={condition}
                      questions={questions}
                      onUpdate={(updates) => handleUpdateCondition(condition.id, updates)}
                      onRemove={() => handleRemoveCondition(condition.id)}
                      showLogicBadge={index > 0 ? filter.groupLogic : undefined}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="py-6 text-center text-gray-500">
                <Filter className="mx-auto mb-2 h-8 w-8 opacity-30" />
                <p className="text-sm">필터 조건이 없습니다</p>
                <p className="mt-1 text-xs text-gray-400">
                  조건을 추가하여 특정 응답자만 분석하세요
                </p>
              </div>
            )}

            {/* 조건 추가 버튼 */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddCondition}
              disabled={filterableQuestions.length === 0}
              className="mt-3"
            >
              <Plus className="mr-1 h-4 w-4" />
              조건 추가
            </Button>

            {filterableQuestions.length === 0 && (
              <p className="mt-2 text-xs text-amber-600">
                필터링 가능한 질문(선택형, 텍스트)이 없습니다
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
