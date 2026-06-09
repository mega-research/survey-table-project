'use client';

import { useCallback, useMemo } from 'react';

import { QuestionInput } from '@/components/survey-response/question-input';
import { RichDescription } from '@/components/survey-response/step-views/rich-description';
import { useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { isEmptyHtml } from '@/lib/utils';
import { sanitizeRichHtml } from '@/lib/sanitize';
import { StepItem } from '@/lib/group-ordering';
import { Question } from '@/types/survey';

type ResponsesMap = Record<string, unknown>;

export function GroupStepItem({
  item,
  itemIndex,
  showSubgroupHeading,
  responses,
  questions,
  onResponse,
  isHighlighted,
}: {
  item: StepItem;
  itemIndex: number;
  showSubgroupHeading: boolean;
  responses: ResponsesMap;
  questions: Question[];
  onResponse: (questionId: string, value: unknown) => void;
  isHighlighted: boolean;
}) {
  const q = item.question;
  const onChange = useCallback(
    (value: unknown) => onResponse(q.id, value),
    [onResponse, q.id],
  );
  const attrs = useContactAttrs();
  const titleText = useMemo(
    () => substituteTokens(q.title ?? '', attrs),
    [q.title, attrs],
  );
  const descriptionHtml = useMemo(
    () => sanitizeRichHtml(substituteTokens(q.description ?? '', attrs)),
    [q.description, attrs],
  );

  return (
    <div className="py-5 first:pt-0 last:pb-0">
      {showSubgroupHeading && (
        <h3 className="mb-3 text-sm font-semibold tracking-[0.12em] text-gray-500 uppercase md:text-xs">
          {item.subgroupName}
        </h3>
      )}
      <div
        data-question-id={q.id}
        className={`space-y-2 ${
          isHighlighted ? '-mx-3 rounded-md bg-red-50/40 p-3 ring-1 ring-red-200' : ''
        }`}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums md:h-6 md:w-6 md:text-xs ${
              isHighlighted ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
            }`}
          >
            {itemIndex}
          </span>
          <div
            id={`q-label-${q.id}`}
            className={`text-lg leading-snug font-semibold break-keep ${
              isHighlighted ? 'text-red-700' : 'text-gray-900'
            }`}
          >
            {titleText}
            {q.required && (
              <span className="ml-1 text-red-500" aria-label="필수 질문">
                *
              </span>
            )}
          </div>
        </div>
        {!isEmptyHtml(q.description) && (
          <RichDescription
            html={descriptionHtml}
            size="sm"
            className="ml-3 md:overflow-x-auto text-sm text-gray-500 md:text-xs [&_p]:min-h-[1.3em] [&_table]:my-1.5 [&_table_td]:px-2.5 [&_table_td]:py-1 [&_table_th]:px-2.5 [&_table_th]:py-1"
          />
        )}
        <div
          role="group"
          aria-labelledby={`q-label-${q.id}`}
          className="mt-2 ml-3"
        >
          <QuestionInput
            question={q}
            value={responses[q.id]}
            onChange={onChange}
            allResponses={responses as Record<string, unknown>}
            allQuestions={questions}
          />
        </div>
      </div>
    </div>
  );
}
