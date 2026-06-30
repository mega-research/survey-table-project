'use client';

import { useCallback, useMemo } from 'react';

import { QuestionInput } from '@/components/survey-response/question-input';
import { RichDescription } from '@/components/survey-response/step-views/rich-description';
import { RootGroupNameBadge } from '@/components/survey-response/step-views/root-group-name-badge';
import { useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isEmptyHtml } from '@/lib/utils';
import { sanitizeRichHtml } from '@/lib/sanitize';
import { RenderStep } from '@/lib/group-ordering';
import { Question } from '@/types/survey';

type ResponsesMap = Record<string, unknown>;

export function TableStepView({
  step,
  isMobile,
  titleHasMultipleLines,
  responses,
  questions,
  onResponse,
  highlightQuestionIds,
}: {
  step: Extract<RenderStep, { kind: 'table' }>;
  isMobile: boolean;
  titleHasMultipleLines: boolean;
  responses: ResponsesMap;
  questions: Question[];
  onResponse: (questionId: string, value: unknown) => void;
  highlightQuestionIds: Set<string>;
}) {
  const q = step.question;
  const isHighlighted = highlightQuestionIds.has(q.id);
  const onChange = useCallback((value: unknown) => onResponse(q.id, value), [onResponse, q.id]);
  const attrs = useContactAttrs();
  const titleText = useMemo(
    () => substituteTokens(q.title ?? '', attrs),
    [q.title, attrs],
  );
  const descriptionHtml = useMemo(
    () => sanitizeRichHtml(substituteTokens(q.description ?? '', attrs)),
    [q.description, attrs],
  );

  // 헤더(그룹/소제목 배지 · 제목 · 설명)에 표시할 내용이 하나도 없으면 헤더 영역을 통째로 숨긴다.
  const hasHeaderContent =
    !!step.rootGroupName || !!step.subgroupName || !q.hideTitle || !isEmptyHtml(q.description);

  return (
    <>
      {/* 모바일: 제목/설명을 카드 밖으로 분리 */}
      {isMobile && hasHeaderContent && (
        <div className="mb-4 space-y-2.5" data-question-id={q.id}>
          {(step.rootGroupName || step.subgroupName) && (
            <div className="flex flex-wrap items-center gap-2">
              {step.rootGroupName && (
                <RootGroupNameBadge name={step.rootGroupName} design={step.rootGroupNameDesign} />
              )}
              {step.subgroupName && step.subgroupName !== step.rootGroupName && (
                <span className="inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                  {step.subgroupName}
                </span>
              )}
            </div>
          )}
          {!q.hideTitle && (
            <h2
              className={`${
                titleHasMultipleLines ? 'text-lg' : 'text-xl'
              } leading-[1.6] font-bold break-keep text-gray-900`}
            >
              {titleText}
              {q.required && (
                <span className="ml-1 align-top text-sm text-red-500" aria-label="필수 질문">
                  *
                </span>
              )}
            </h2>
          )}
          {!isEmptyHtml(q.description) && (
            <RichDescription
              html={descriptionHtml}
              size="base"
              className="max-h-[40vh] overflow-y-auto leading-relaxed text-base text-gray-500 [&_p]:min-h-[1.5em] [&_p]:leading-relaxed [&_table]:my-2 [&_table_td]:px-3 [&_table_td]:py-1.5 [&_table_th]:px-3 [&_table_th]:py-1.5"
            />
          )}
        </div>
      )}

      <Card
        key={q.id}
        className={`animate-in fade-in duration-200 ${
          isHighlighted ? 'border-red-300 ring-2 ring-red-100' : ''
        }`}
        data-question-id={q.id}
      >
        {!isMobile && hasHeaderContent && (
          <CardHeader className="pb-4">
            {(step.rootGroupName || step.subgroupName) && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {step.rootGroupName && (
                  <RootGroupNameBadge name={step.rootGroupName} design={step.rootGroupNameDesign} />
                )}
                {step.subgroupName && step.subgroupName !== step.rootGroupName && (
                  <span className="inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                    {step.subgroupName}
                  </span>
                )}
              </div>
            )}
            <div className="min-w-0">
              {!q.hideTitle && (
                <CardTitle className="text-2xl leading-relaxed font-semibold break-keep text-gray-900">
                  {titleText}
                  {q.required && (
                    <span className="ml-1.5 align-top text-sm text-red-500" aria-label="필수 질문">
                      *
                    </span>
                  )}
                </CardTitle>
              )}
              {!isEmptyHtml(q.description) && (
                <RichDescription
                  html={descriptionHtml}
                  size="base"
                  className="mt-3 max-h-[60vh] overflow-y-auto text-base text-gray-600 [&_p]:min-h-[1.6em] [&_table]:my-2 [&_table_td]:px-4 [&_table_td]:py-2 [&_table_th]:px-4 [&_table_th]:py-2"
                />
              )}
            </div>
          </CardHeader>
        )}

        <CardContent className={isMobile ? 'p-4' : hasHeaderContent ? '' : 'pt-6'}>
          <div className="space-y-4">
            <QuestionInput
              question={q}
              value={responses[q.id]}
              onChange={onChange}
              allResponses={responses as Record<string, unknown>}
              allQuestions={questions}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
