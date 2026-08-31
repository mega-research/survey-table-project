'use client';

import { useCallback, useMemo } from 'react';

import { History } from 'lucide-react';

import { QuestionInput } from '@/components/survey-response/question-input';
import { RichDescription } from '@/components/survey-response/step-views/rich-description';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { usePriorAnswerMark } from '@/lib/survey/prior-answers-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { isEmptyHtml } from '@/lib/utils';
import { isChoiceTableSource } from '@/utils/choice-source';
import { DEFAULT_REQUIRED_CELL_MESSAGE, resolveRequiredMessage } from '@/utils/required-message';
import { sanitizeRichHtml } from '@/lib/sanitize';
import { StepItem } from '@/lib/group-ordering';
import type { NumericIssue } from '@/lib/survey/numeric-validation';
import { Question } from '@/types/survey';
import {
  DYNAMIC_ROW_SELECTIONS_KEY,
  getDynamicRowSelections,
  updateDynamicRowSelections,
} from '@/utils/dynamic-row-selection-sidecar';

type ResponsesMap = Record<string, unknown>;

export function GroupStepItem({
  item,
  showSubgroupHeading,
  responses,
  questions,
  onResponse,
  isHighlighted,
  showRequiredMessage,
  issues,
}: {
  item: StepItem;
  showSubgroupHeading: boolean;
  responses: ResponsesMap;
  questions: Question[];
  onResponse: (questionId: string, value: unknown) => void;
  isHighlighted: boolean;
  /** 필수 미응답 안내 문구 표시 — 질문별 requiredMessage 또는 기본 문구. */
  showRequiredMessage: boolean;
  issues?: NumericIssue[] | undefined;
}) {
  const q = item.question;
  const onChange = useCallback(
    (value: unknown) => onResponse(q.id, value),
    [onResponse, q.id],
  );
  const selectedDynamicRowIds = getDynamicRowSelections(responses, q.id);
  const onDynamicRowSelectionChange = useCallback(
    (rowIds: string[]) =>
      onResponse(
        DYNAMIC_ROW_SELECTIONS_KEY,
        updateDynamicRowSelections(
          responses[DYNAMIC_ROW_SELECTIONS_KEY],
          q.id,
          rowIds,
        ),
      ),
    [onResponse, q.id, responses],
  );
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  // 추적조사 — 이 문항 값이 지난 회차에서 넘어온 것이면 응답자가 구분할 수 있게 표시한다.
  const { hasPrior, waveLabel } = usePriorAnswerMark(q.id);
  const titleText = useMemo(
    () => substituteTokens(q.title ?? '', attrs, quotes),
    [q.title, attrs, quotes],
  );
  const descriptionHtml = useMemo(
    () => sanitizeRichHtml(substituteTokens(q.description ?? '', attrs, quotes)),
    [q.description, attrs, quotes],
  );
  const subgroupNameText = useMemo(
    () => (item.subgroupName ? substituteTokens(item.subgroupName, attrs, quotes) : null),
    [item.subgroupName, attrs, quotes],
  );
  // 필수 미응답 안내가 이미 뜨는 질문에서 기본 문구의 필수 셀/상세 이슈는 같은 원인을
  // 두 번 알리므로 문구를 필수 안내 하나로 합친다 — 배너의 "위치로 이동"(셀/상세 타깃)은
  // 유지하고, 아래 별도 필수 문구 <p> 를 생략한다 (2026-08-13 결정).
  // 셀별 지정 문구와 범위/합계/수식 위반은 별개 정보이므로 그대로 둔다.
  const { visibleIssues, requiredMessageInBanner } = useMemo(() => {
    if (!showRequiredMessage || !issues?.length) {
      return { visibleIssues: issues, requiredMessageInBanner: false };
    }
    let merged = false;
    const next = issues.map((issue) => {
      const isDefaultRequiredIssue =
        (issue.kind === 'required-cells' || issue.kind === 'required-detail') &&
        issue.message === DEFAULT_REQUIRED_CELL_MESSAGE;
      if (!isDefaultRequiredIssue) return issue;
      merged = true;
      return { ...issue, message: resolveRequiredMessage(q) };
    });
    return { visibleIssues: next, requiredMessageInBanner: merged };
  }, [issues, showRequiredMessage, q]);

  return (
    // 페이지 내 문항 간 여백은 PageStepView 래퍼가 소유한다 (first/last 판정이 래퍼 형제 기준이어야 해서)
    <div>
      {showSubgroupHeading && (
        <h3 className="mb-3 text-sm font-semibold tracking-[0.12em] text-gray-500 uppercase md:text-xs">
          {subgroupNameText}
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
              className="px-1 text-lg leading-snug font-semibold break-keep text-gray-900"
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
        {hasPrior && (
          <div className="px-1">
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              {waveLabel} 답변이 채워져 있습니다
            </span>
          </div>
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
            numericIssues={visibleIssues}
            selectedDynamicRowIds={selectedDynamicRowIds}
            onDynamicRowSelectionChange={onDynamicRowSelectionChange}
          />
        </div>
        {showRequiredMessage && !requiredMessageInBanner && (
          <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {resolveRequiredMessage(q)}
          </p>
        )}
      </div>
    </div>
  );
}
