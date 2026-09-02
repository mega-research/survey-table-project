'use client';

import { useCallback, useMemo } from 'react';

import { ChangeConfirmControl } from '@/components/survey-response/change-confirm-control';
import { QuestionInput } from '@/components/survey-response/question-input';
import { RichDescription } from '@/components/survey-response/step-views/rich-description';
import {
  CHANGE_CONFIRM_KEY,
  getChangeConfirmation,
  isPriorAnswerLocked,
  requiresChangeConfirmation,
  resolveAnswerOnConfirmation,
  updateChangeConfirmations,
  type ChangeConfirmation,
} from '@/lib/survey/change-confirmation';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { usePriorAnswers } from '@/lib/survey/prior-answers-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { isEmptyHtml } from '@/lib/utils';
import { isChoiceTableSource } from '@/utils/choice-source';
import { DEFAULT_REQUIRED_CELL_MESSAGE } from '@/utils/required-message';
import { resolveGroupedRequiredMessage } from '@/lib/survey/answer-validation';
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
  showChangeConfirmMessage,
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
  /** 변동 확인 미선택 안내 문구 표시 — 응답 필수와 별개 축이다. */
  showChangeConfirmMessage: boolean;
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
  // 추적조사 — 이 문항 값이 지난 회차에서 넘어온 것이면 응답자가 구분할 수 있게 표시하고,
  // 같은 자리에서 변동 여부를 밝히게 한다(밝히지 않으면 페이지를 넘길 수 없다).
  const { answers: priorAnswers, waveLabel } = usePriorAnswers();
  const hasPrior = requiresChangeConfirmation(q, priorAnswers);
  const priorValue = hasPrior ? priorAnswers?.[q.id] : undefined;
  const changeConfirmation = getChangeConfirmation(responses, q.id);
  // 이월 값이 있는 문항의 기본 상태는 잠금이다. "달라짐"을 골라야 열린다.
  const isLocked = isPriorAnswerLocked(q, priorAnswers, responses);
  // 잠긴 동안에는 이월 값을 그대로 보여준다 — 응답자는 이 값을 보고 같음/달라짐을 판단한다.
  // 이번 회차 값이 이미 들어와 있으면(밝힌 뒤) 그 값이 곧 이월 값의 사본이다.
  const inputValue = hasPrior && responses[q.id] === undefined ? priorValue : responses[q.id];
  const onChangeConfirm = useCallback(
    (value: ChangeConfirmation) => {
      onResponse(
        CHANGE_CONFIRM_KEY,
        updateChangeConfirmations(responses[CHANGE_CONFIRM_KEY], q.id, value),
      );
      // 이월 값을 이번 회차 응답으로 복사할지는 순수 함수가 정한다.
      const next = resolveAnswerOnConfirmation(q, priorAnswers, responses, value);
      if (next.write) onResponse(q.id, next.value);
    },
    [onResponse, q, responses, priorAnswers],
  );
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
      return { ...issue, message: resolveGroupedRequiredMessage(q, responses[q.id]) };
    });
    return { visibleIssues: next, requiredMessageInBanner: merged };
  }, [issues, showRequiredMessage, q, responses]);

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
          <ChangeConfirmControl
            questionId={q.id}
            waveLabel={waveLabel}
            value={changeConfirmation}
            onSelect={onChangeConfirm}
            showRequiredMessage={showChangeConfirmMessage}
          />
        )}
        {/* fieldset[disabled] 은 안쪽 폼 컨트롤 전체를 브라우저가 직접 비활성화한다 —
            타입별 disabled prop 을 9종 + 표 셀까지 흘리지 않고도 잠금이 성립하고,
            값은 그대로 읽히며(스크린리더 포함) 탭 순서에서만 빠진다. */}
        {/* pointer-events-none 은 쓰지 않는다 — 넓은 표의 가로 스크롤까지 죽어
            응답자가 이월 값을 끝까지 볼 수 없게 된다. 그 대가로 폼 컨트롤이 아닌
            div onClick(모바일 옵션 카드 토글)은 잠기지 않는데, 새어 나간 편집은
            "같음"이 이월 값을 다시 복사하므로 값이 어긋난 채 제출되지는 않는다. */}
        <fieldset
          disabled={isLocked}
          className={`m-0 min-w-0 border-0 p-0 ${isLocked ? 'opacity-70' : ''}`}
        >
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
            value={inputValue}
            onChange={onChange}
            allResponses={responses as Record<string, unknown>}
            allQuestions={questions}
            numericIssues={visibleIssues}
            selectedDynamicRowIds={selectedDynamicRowIds}
            onDynamicRowSelectionChange={onDynamicRowSelectionChange}
          />
        </div>
        </fieldset>
        {showRequiredMessage && !requiredMessageInBanner && (
          <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {resolveGroupedRequiredMessage(q, responses[q.id])}
          </p>
        )}
      </div>
    </div>
  );
}
