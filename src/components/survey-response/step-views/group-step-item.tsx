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
  showSubgroupHeading,
  responses,
  questions,
  onResponse,
  isHighlighted,
}: {
  item: StepItem;
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
    // 페이지 내 문항 간 여백은 PageStepView 래퍼가 소유한다 (first/last 판정이 래퍼 형제 기준이어야 해서)
    <div>
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
        {!q.hideTitle && (
          <div className="flex items-start">
            <div
              id={`q-label-${q.id}`}
              className={`px-1 text-lg leading-snug font-semibold break-keep ${
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
        )}
        {!isEmptyHtml(q.description) && (
          <RichDescription
            html={descriptionHtml}
            size="sm"
            className="px-2 md:overflow-x-auto text-sm text-gray-500 md:text-xs [&_p]:min-h-[1.3em] [&_table]:my-1.5 [&_table_td]:px-2.5 [&_table_td]:py-1 [&_table_th]:px-2.5 [&_table_th]:py-1"
          />
        )}
        <div
          role="group"
          aria-labelledby={`q-label-${q.id}`}
          className="m-2"
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
