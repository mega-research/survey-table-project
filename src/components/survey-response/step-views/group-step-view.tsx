'use client';

import { useMemo } from 'react';

import { GroupStepItem } from '@/components/survey-response/step-views/group-step-item';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { RenderStep, StepItem } from '@/lib/group-ordering';
import { Question, QuestionGroup } from '@/types/survey';
import { shouldDisplayQuestion, type BranchEvalCtx } from '@/utils/branch-logic';

type ResponsesMap = Record<string, unknown>;

export function GroupStepView({
  step,
  responses,
  questions,
  groups,
  evalCtx,
  onResponse,
  highlightQuestionIds,
}: {
  step: Extract<RenderStep, { kind: 'group' }>;
  responses: ResponsesMap;
  questions: Question[];
  groups: QuestionGroup[];
  evalCtx: BranchEvalCtx;
  onResponse: (questionId: string, value: unknown) => void;
  highlightQuestionIds: Set<string>;
}) {
  // 표시 가능한 items만 필터 (원래 subgroupName 유지)
  const visibleItems: StepItem[] = useMemo(
    () =>
      step.items.filter((it) =>
        shouldDisplayQuestion(it.question, responses, questions, groups, evalCtx),
      ),
    [step.items, responses, questions, groups, evalCtx],
  );

  return (
    <Card className="animate-in fade-in duration-200">
      <CardHeader className="pb-6">
        {step.rootGroupName && (
          <span className="inline-block w-fit rounded-md bg-blue-50 px-3.5 py-2 text-base font-semibold tracking-wide text-blue-700">
            {step.rootGroupName}
          </span>
        )}
      </CardHeader>
      <CardContent className="md:px-8">
        <div className="divide-y divide-gray-100">
          {visibleItems.map((item) => (
            <GroupStepItem
              key={item.question.id}
              item={item}
              showSubgroupHeading={
                !!item.subgroupName && item.subgroupName !== step.rootGroupName
              }
              responses={responses}
              questions={questions}
              onResponse={onResponse}
              isHighlighted={highlightQuestionIds.has(item.question.id)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
