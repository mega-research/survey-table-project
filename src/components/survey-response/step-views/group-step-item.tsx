'use client';

import { useCallback, useMemo } from 'react';

import { QuestionInput } from '@/components/survey-response/question-input';
import { RichDescription } from '@/components/survey-response/step-views/rich-description';
import { useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { isEmptyHtml } from '@/lib/utils';
import { isChoiceTableSource } from '@/utils/choice-source';
import { sanitizeRichHtml } from '@/lib/sanitize';
import { StepItem } from '@/lib/group-ordering';
import type { NumericIssue } from '@/lib/survey/numeric-validation';
import { Question } from '@/types/survey';

type ResponsesMap = Record<string, unknown>;

export function GroupStepItem({
  item,
  showSubgroupHeading,
  responses,
  questions,
  onResponse,
  isHighlighted,
  issues,
}: {
  item: StepItem;
  showSubgroupHeading: boolean;
  responses: ResponsesMap;
  questions: Question[];
  onResponse: (questionId: string, value: unknown) => void;
  isHighlighted: boolean;
  issues?: NumericIssue[] | undefined;
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
            className="px-2 pb-2 md:overflow-x-auto text-sm text-gray-500 md:text-xs [&_p]:min-h-[1.3em] [&_table]:my-1.5 [&_table_td]:px-2.5 [&_table_td]:py-1 [&_table_th]:px-2.5 [&_table_th]:py-1"
          />
        )}
        <div
          role="group"
          aria-labelledby={`q-label-${q.id}`}
          // 표 형태(테이블 질문·설명 테이블 소스)만 모바일에서 좌우/하단 margin 을 빼고
          // 제목과의 간격 8px(mt-2)만 남긴다 — 입력 카드가 화면 폭을 그대로 쓰게.
          // 그 외 질문(일반 라디오·체크박스·단답 등)은 좌우 margin 을 빼면 선택지가
          // 제목(px-1)보다 왼쪽으로 삐져나가므로 모든 화면에서 m-2 유지.
          // 데스크탑(md 이상) 표 형태는 설명이 없으면 제목과 표가 8px 로 붙어 보여
          // 24px(mt-6)로 벌린다. 제목 숨김(hideTitle) 질문은 벌릴 기준(제목)이 없으므로
          // 제외 — 그룹 헤더와 표 사이가 불필요하게 벌어지는 회귀 방지.
          className={
            q.type === 'table' ||
            ((q.type === 'radio' || q.type === 'checkbox') && isChoiceTableSource(q))
              ? `mt-2 md:m-2 ${
                  !q.hideTitle && isEmptyHtml(q.description) ? 'md:mt-6' : ''
                }`
              : 'm-2'
          }
        >
          <QuestionInput
            question={q}
            value={responses[q.id]}
            onChange={onChange}
            allResponses={responses as Record<string, unknown>}
            allQuestions={questions}
            numericIssues={issues}
          />
        </div>
      </div>
    </div>
  );
}
