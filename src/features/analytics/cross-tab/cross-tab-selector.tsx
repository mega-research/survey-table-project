'use client';

import { ArrowRight } from 'lucide-react';

import { Combobox } from '@/components/ui/combobox';
import { isCrossTabableQuestion } from '@/lib/analytics/cross-tab';
import type { Question } from '@/types/survey';

interface CrossTabSelectorProps {
  questions: Question[];
  rowQuestionId: string | null;
  colQuestionId: string | null;
  onRowQuestionChange: (questionId: string) => void;
  onColQuestionChange: (questionId: string) => void;
}

export function CrossTabSelector({
  questions,
  rowQuestionId,
  colQuestionId,
  onRowQuestionChange,
  onColQuestionChange,
}: CrossTabSelectorProps) {
  const crossTabableQuestions = questions.filter(isCrossTabableQuestion);

  // Combobox용 옵션 생성
  const rowOptions = crossTabableQuestions.map((q) => ({
    value: q.id,
    label: q.title,
    disabled: q.id === colQuestionId,
  }));

  const colOptions = crossTabableQuestions.map((q) => ({
    value: q.id,
    label: q.title,
    disabled: q.id === rowQuestionId,
  }));

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* 행 질문 선택 */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium whitespace-nowrap text-gray-600">행:</span>
        <Combobox
          options={rowOptions}
          value={rowQuestionId || ''}
          onValueChange={onRowQuestionChange}
          placeholder="행 질문 선택"
          searchPlaceholder="질문 검색..."
          emptyText="질문을 찾을 수 없습니다"
          triggerClassName="w-[240px]"
          className="w-[280px]"
        />
      </div>

      <ArrowRight className="h-4 w-4 text-gray-400" />

      {/* 열 질문 선택 */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium whitespace-nowrap text-gray-600">열:</span>
        <Combobox
          options={colOptions}
          value={colQuestionId || ''}
          onValueChange={onColQuestionChange}
          placeholder="열 질문 선택"
          searchPlaceholder="질문 검색..."
          emptyText="질문을 찾을 수 없습니다"
          triggerClassName="w-[240px]"
          className="w-[280px]"
        />
      </div>
    </div>
  );
}
