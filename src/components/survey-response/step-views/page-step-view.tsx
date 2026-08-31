'use client';

import { useMemo } from 'react';

import { GroupStepItem } from '@/components/survey-response/step-views/group-step-item';
import { RootGroupNameBadge } from '@/components/survey-response/step-views/root-group-name-badge';
import { Card, CardContent } from '@/components/ui/card';
import { RenderStep, StepItem } from '@/lib/group-ordering';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import type { NumericIssue } from '@/lib/survey/numeric-validation';
import { resolveBulkChoices, type BulkChoice } from '@/lib/survey-document/bulk-choice';
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
  onQuestionFocus,
  showBulkChoice = false,
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
  /**
   * 분할 레이아웃에서 지금 보고 있는 문항을 알린다 — 왼쪽 조사표가 그 영역으로 이동한다.
   * 분할이 아닐 때는 넘어오지 않으므로 이 화면은 조사표를 모른다.
   */
  onQuestionFocus?: ((questionId: string) => void) | undefined;
  /** 블록 일괄 선택 노출 여부. 분할 레이아웃에서만 켠다. */
  showBulkChoice?: boolean;
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

  // root 그룹별 일괄 선택지. 선택지가 완전히 같은 단일선택 문항 둘 이상일 때만 나온다.
  const bulkChoicesByRootGroup = useMemo(() => {
    const byGroup = new Map<string | null, Question[]>();
    for (const item of visibleItems) {
      const list = byGroup.get(item.rootGroupId);
      if (list) list.push(item.question);
      else byGroup.set(item.rootGroupId, [item.question]);
    }
    return new Map(
      [...byGroup].map(([groupId, groupQuestions]) => [
        groupId,
        resolveBulkChoices(groupQuestions),
      ]),
    );
  }, [visibleItems]);

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
            // 블록 일괄 선택은 root 그룹이 시작되는 자리에 한 번만 낸다.
            const startsRootGroup = idx === 0 || prev?.rootGroupId !== item.rootGroupId;
            const blockChoices =
              showBulkChoice && startsRootGroup
                ? (bulkChoicesByRootGroup.get(item.rootGroupId) ?? [])
                : [];
            return (
              <div
                key={item.question.id}
                className="py-6 first:pt-0 last:pb-0"
                // 커서가 닿은 문항을 초점으로 삼는다. 캡처 단계라 내부 입력의
                // 클릭·포커스를 가로채지 않고 지나가며 본다.
                onFocusCapture={onQuestionFocus ? () => onQuestionFocus(item.question.id) : undefined}
                onClickCapture={onQuestionFocus ? () => onQuestionFocus(item.question.id) : undefined}
              >
                {blockChoices.length > 0 && (
                  <BlockBulkChoice
                    choices={blockChoices}
                    onPick={(value) => {
                      for (const target of visibleItems) {
                        if (target.rootGroupId === item.rootGroupId) {
                          onResponse(target.question.id, value);
                        }
                      }
                    }}
                  />
                )}
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


/**
 * 블록 일괄 선택 — "이 블록 전부 필요함". 고른 뒤 개별 문항을 다시 바꿀 수 있다
 * (그냥 그 문항의 답을 덮어쓸 뿐이라 별도 해제 상태가 없다).
 */
function BlockBulkChoice({
  choices,
  onPick,
}: {
  choices: BulkChoice[];
  onPick: (value: string) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <span className="text-xs text-gray-500">이 블록 전체</span>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          onClick={() => onPick(choice.value)}
          className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
        >
          {choice.label}
        </button>
      ))}
      <span className="text-[11px] text-gray-400">— 고른 뒤 개별 문항을 다시 바꿀 수 있습니다</span>
    </div>
  );
}
