'use client';

import { type ReactNode, useMemo } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import { RootGroupNameBadge } from '@/features/question-renderer/root-group-name-badge';
import { groupAttachedItems } from '@/features/survey-response/lib/attached-questions';
import type { NumericIssue } from '@/features/survey-response/lib/numeric-validation';
import { GroupStepItem } from '@/features/survey-response/step-views/group-step-item';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { Question, QuestionGroup } from '@/types/survey';
import { type BranchEvalCtx, shouldDisplayQuestion } from '@/utils/branch-logic';
import { RenderStep, StepItem } from '@/utils/group-ordering';

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
  changeConfirmMessageQuestionIds,
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
  /** 변동 확인 미선택 사유로 막힌 질문 — 컨트롤 아래 안내 문구를 표시한다. */
  changeConfirmMessageQuestionIds: Set<string>;
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

  // 앞 문항 설명 밑에 붙이는 문항(접어 두기 + collapseAttachToPrevious)은 제자리에서 빼고 앞 문항 안에 그린다
  const { rendered, attachments } = useMemo(() => groupAttachedItems(visibleItems), [visibleItems]);

  if (visibleItems.length === 0) return null;

  const renderItem = (item: StepItem, attachedSlot?: ReactNode) => (
    <GroupStepItem
      item={item}
      showSubgroupHeading={!!item.subgroupName && item.subgroupName !== item.rootGroupName}
      responses={responses}
      questions={questions}
      onResponse={onResponse}
      isHighlighted={highlightQuestionIds.has(item.question.id)}
      showRequiredMessage={requiredMessageQuestionIds.has(item.question.id)}
      showChangeConfirmMessage={changeConfirmMessageQuestionIds.has(item.question.id)}
      issues={numericIssues.get(item.question.id)}
      evalCtx={evalCtx}
      {...(attachedSlot !== undefined ? { attachedSlot } : {})}
    />
  );

  return (
    <Card className="animate-in fade-in duration-200">
      <CardContent className="p-4 pt-6 md:p-6 md:px-8 md:pt-6">
        <div className="divide-y divide-gray-100">
          {rendered.map((item, idx) => {
            const prev = rendered[idx - 1];
            const attached = attachments.get(item.question.id);
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
                {renderItem(
                  item,
                  attached ? (
                    // 설명과 같은 들여쓰기(px-2) — 붙임 줄과 펼친 내용이 설명의 연장으로 읽힌다
                    <div className="space-y-2 px-2 pb-2">
                      {attached.map((a) => (
                        <div key={a.question.id}>{renderItem(a)}</div>
                      ))}
                    </div>
                  ) : undefined,
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
