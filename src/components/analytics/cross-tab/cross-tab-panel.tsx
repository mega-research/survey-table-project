'use client';

import { useMemo, useState } from 'react';

import { BarChart3, ChevronDown, ChevronUp, Grid3X3, Hash, Table2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { SurveyResponse } from '@/db/schema';
import type { PercentageBase } from '@/lib/analytics/cross-tab';
import {
  calculateCrossTab,
  isCrossTabableQuestion,
} from '@/lib/analytics/cross-tab';
import type { Question } from '@/types/survey';

import { CrossTabChart } from './cross-tab-chart';
import { CrossTabSelector } from './cross-tab-selector';
import { PivotTable } from './pivot-table';

type ViewMode = 'table' | 'chart';

interface CrossTabPanelProps {
  questions: Question[];
  responses: SurveyResponse[];
}

export function CrossTabPanel({ questions, responses }: CrossTabPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [rowQuestionId, setRowQuestionId] = useState<string | null>(null);
  const [colQuestionId, setColQuestionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [percentageBase, setPercentageBase] = useState<PercentageBase>('row');
  const [showCounts, setShowCounts] = useState(true);

  const crossTabableQuestions = questions.filter(isCrossTabableQuestion);

  // 교차분석 결과 계산
  const crossTabResult = useMemo(() => {
    if (!rowQuestionId || !colQuestionId) return null;

    const rowQuestion = questions.find((q) => q.id === rowQuestionId);
    const colQuestion = questions.find((q) => q.id === colQuestionId);

    if (!rowQuestion || !colQuestion) return null;

    return calculateCrossTab(rowQuestion, colQuestion, responses);
  }, [rowQuestionId, colQuestionId, questions, responses]);

  // 자동 선택 (첫 렌더링 시)
  useState(() => {
    if (crossTabableQuestions.length >= 2) {
      setRowQuestionId(crossTabableQuestions[0].id);
      setColQuestionId(crossTabableQuestions[1].id);
    }
  });

  const hasEnoughQuestions = crossTabableQuestions.length >= 2;

  return (
    <Card className="mb-6">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="border-b border-gray-100 p-4">
          <div className="flex items-center justify-between">
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 hover:opacity-80">
                <Grid3X3 className="h-5 w-5 text-purple-500" />
                <h3 className="font-semibold text-gray-900">교차분석</h3>
                {crossTabResult && (
                  <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">
                    n={crossTabResult.grandTotal}
                  </Badge>
                )}
                {isOpen ? (
                  <ChevronUp className="ml-1 h-4 w-4 text-gray-400" />
                ) : (
                  <ChevronDown className="ml-1 h-4 w-4 text-gray-400" />
                )}
              </button>
            </CollapsibleTrigger>

            {/* 뷰 모드 전환 */}
            {crossTabResult && (
              <div className="flex items-center gap-2">
                <Button
                  variant={viewMode === 'table' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('table')}
                >
                  <Table2 className="mr-1 h-4 w-4" />
                  테이블
                </Button>
                <Button
                  variant={viewMode === 'chart' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('chart')}
                >
                  <BarChart3 className="mr-1 h-4 w-4" />
                  차트
                </Button>
              </div>
            )}
          </div>
        </div>

        <CollapsibleContent>
          <div className="space-y-4 p-4">
            {!hasEnoughQuestions ? (
              <div className="py-8 text-center text-gray-500">
                <Grid3X3 className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p className="text-sm">교차분석을 위해 선택형 질문이 2개 이상 필요합니다</p>
                <p className="mt-1 text-xs text-gray-400">
                  현재 선택형 질문: {crossTabableQuestions.length}개
                </p>
              </div>
            ) : (
              <>
                {/* 질문 선택 */}
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 pb-4">
                  <CrossTabSelector
                    questions={questions}
                    rowQuestionId={rowQuestionId}
                    colQuestionId={colQuestionId}
                    onRowQuestionChange={setRowQuestionId}
                    onColQuestionChange={setColQuestionId}
                  />

                  {/* 옵션들 */}
                  <div className="flex items-center gap-4">
                    {/* 퍼센트 기준 */}
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-gray-600">기준:</Label>
                      <Select
                        value={percentageBase}
                        onValueChange={(value: string) =>
                          setPercentageBase(value as PercentageBase)
                        }
                      >
                        <SelectTrigger className="w-[130px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="row">행 기준 %</SelectItem>
                          <SelectItem value="column">열 기준 %</SelectItem>
                          <SelectItem value="total">전체 기준 %</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 빈도수 표시 (테이블 뷰에서만) */}
                    {viewMode === 'table' && (
                      <div className="flex items-center gap-2">
                        <Switch
                          id="show-counts"
                          checked={showCounts}
                          onCheckedChange={setShowCounts}
                        />
                        <Label
                          htmlFor="show-counts"
                          className="cursor-pointer text-sm text-gray-600"
                        >
                          <Hash className="mr-1 inline h-3 w-3" />
                          빈도수
                        </Label>
                      </div>
                    )}
                  </div>
                </div>

                {/* 결과 표시 */}
                {crossTabResult ? (
                  <div className="mt-4">
                    {viewMode === 'table' ? (
                      <PivotTable
                        result={crossTabResult}
                        percentageBase={percentageBase}
                        showCounts={showCounts}
                      />
                    ) : (
                      <CrossTabChart result={crossTabResult} percentageBase={percentageBase} />
                    )}
                  </div>
                ) : (
                  <div className="py-8 text-center text-gray-500">
                    <p className="text-sm">행과 열 질문을 선택하세요</p>
                  </div>
                )}
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
