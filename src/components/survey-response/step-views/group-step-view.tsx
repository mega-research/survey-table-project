'use client';

import { useMemo } from 'react';

import { GroupStepItem } from '@/components/survey-response/step-views/group-step-item';
import { RootGroupNameBadge } from '@/components/survey-response/step-views/root-group-name-badge';
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
      {step.rootGroupName && (
        <CardHeader className="pb-6">
          <RootGroupNameBadge name={step.rootGroupName} design={step.rootGroupNameDesign} />
        </CardHeader>
      )}
      <CardContent className={`md:px-8 ${step.rootGroupName ? '' : 'pt-6'}`}>
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
