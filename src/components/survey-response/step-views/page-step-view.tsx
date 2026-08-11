'use client';

import { useMemo } from 'react';

import { GroupStepItem } from '@/components/survey-response/step-views/group-step-item';
import { RootGroupNameBadge } from '@/components/survey-response/step-views/root-group-name-badge';
import { Card, CardContent } from '@/components/ui/card';
import { RenderStep, StepItem } from '@/lib/group-ordering';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import type { NumericIssue } from '@/lib/survey/numeric-validation';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { Question, QuestionGroup } from '@/types/survey';
import { shouldDisplayQuestion, type BranchEvalCtx } from '@/utils/branch-logic';

type ResponsesMap = Record<string, unknown>;

export function PageStepView({
  step,
  responses,
  questions,
  groups,
  evalCtx,
  onResponse,
  highlightQuestionIds,
  requiredMessageQuestionIds,
  numericIssues,
}: {
  step: RenderStep;
  responses: ResponsesMap;
  questions: Question[];
  groups: QuestionGroup[];
  evalCtx: BranchEvalCtx;
  onResponse: (questionId: string, value: unknown) => void;
  highlightQuestionIds: Set<string>;
  /** 필수 미응답 사유로 하이라이트된 질문 — 안내 문구를 함께 표시한다. */
  requiredMessageQuestionIds: Set<string>;
  numericIssues: Map<string, NumericIssue[]>;
}) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const visibleItems: StepItem[] = useMemo(
    () =>
      step.items.filter((it) =>
        shouldDisplayQuestion(it.question, responses, questions, groups, evalCtx),
      ),
    [step.items, responses, questions, groups, evalCtx],
  );

  if (visibleItems.length === 0) return null;

  return (
    <Card className="animate-in fade-in duration-200">
      <CardContent className="p-4 pt-6 md:p-6 md:px-8 md:pt-6">
        <div className="divide-y divide-gray-100">
          {visibleItems.map((item, idx) => {
            const prev = visibleItems[idx - 1];
            // root 그룹이 바뀌는 지점(또는 페이지 첫 항목)에 그룹 헤더를 표시한다.
            const showRootBadge =
              !!item.rootGroupName && (idx === 0 || prev?.rootGroupId !== item.rootGroupId);
            return (
              <div key={item.question.id} className="py-6 first:pt-0 last:pb-0">
                {showRootBadge && item.rootGroupName && (
                  <div className={idx === 0 ? 'pb-5' : 'pt-2 pb-5'}>
                    <RootGroupNameBadge
                      name={substituteTokens(item.rootGroupName, attrs, quotes)}
                      design={item.rootGroupNameDesign}
                    />
                  </div>
                )}
                <GroupStepItem
                  item={item}
                  showSubgroupHeading={
                    !!item.subgroupName && item.subgroupName !== item.rootGroupName
                  }
                  responses={responses}
                  questions={questions}
                  onResponse={onResponse}
                  isHighlighted={highlightQuestionIds.has(item.question.id)}
                  showRequiredMessage={requiredMessageQuestionIds.has(item.question.id)}
                  issues={numericIssues.get(item.question.id)}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
