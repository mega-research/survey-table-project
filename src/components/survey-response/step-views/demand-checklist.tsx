'use client';

import { useMemo, useState } from 'react';

import { ChevronDown, Crop } from 'lucide-react';

import { GroupStepItem } from '@/components/survey-response/step-views/group-step-item';
import { StepItem } from '@/lib/group-ordering';
import {
  resolveJudgementBulkChoices,
  resolveJudgementShape,
} from '@/lib/survey/judgement-item';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import type { NumericIssue } from '@/lib/survey/numeric-validation';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import { Question, QuestionGroup } from '@/types/survey';

type ResponsesMap = Record<string, unknown>;

/**
 * 분할 레이아웃 오른쪽의 판단 체크리스트.
 *
 * 조사표를 나란히 놓고 훑는 화면이라 **한 문항이 한 줄**이어야 한다. 일반 응답
 * 렌더는 문항마다 제목·설명·라디오를 세로로 쌓는데, 20쪽 조사표의 83문항에서는
 * 그 밀도로 조사표와 눈을 오갈 수 없다.
 *
 * **전용 질문 유형을 만든 것이 아니다.** 데이터는 그대로 평범한 radio 이고,
 * 여기서 바뀌는 것은 그리는 방식뿐이다. 3지선다 판단 항목이 아닌 문항
 * (척도·장문형 등)은 일반 렌더로 떨어진다 — 조사표 순서를 끊지 않기 위해서다.
 */
interface Props {
  items: StepItem[];
  groups: QuestionGroup[];
  responses: ResponsesMap;
  questions: Question[];
  onResponse: (questionId: string, value: unknown) => void;
  highlightQuestionIds: Set<string>;
  requiredMessageQuestionIds: Set<string>;
  numericIssues: Map<string, NumericIssue[]>;
  /** 클릭·포커스로 초점을 옮긴다 — 조사표가 그 영역으로 이동한다. */
  onQuestionFocus?: ((questionId: string) => void) | undefined;
  /** 훑는 동안의 미리보기 — 조사표를 움직이지 않고 해당 영역만 밝힌다. null 이면 해제. */
  onQuestionHover?: ((questionId: string | null) => void) | undefined;
  /** 블록 머리를 누르면 그 그룹의 영역만 밝힌다. */
  onGroupSelect?: ((groupId: string) => void) | undefined;
}

/** 한 블록(문항이 실제로 속한 그룹) 단위 묶음. 앵커가 하위그룹에도 붙으므로 root 가 아니다. */
interface Block {
  id: string | null;
  name: string | null;
  items: StepItem[];
}

export function DemandChecklist({
  items,
  groups,
  responses,
  questions,
  onResponse,
  highlightQuestionIds,
  requiredMessageQuestionIds,
  numericIssues,
  onQuestionFocus,
  onQuestionHover,
  onGroupSelect,
}: Props) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();

  const blocks = useMemo<Block[]>(() => {
    const byId = new Map(groups.map((g) => [g.id, g.name]));
    const out: Block[] = [];
    for (const item of items) {
      const id = item.question.groupId ?? item.rootGroupId;
      const last = out[out.length - 1];
      if (last && last.id === id) last.items.push(item);
      else out.push({ id, name: id ? (byId.get(id) ?? null) : null, items: [item] });
    }
    return out;
  }, [items, groups]);

  if (items.length === 0) return null;

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => (
        <BlockCard
          key={block.id ?? `__ungrouped__${index}`}
          block={block}
          blockName={block.name ? substituteTokens(block.name, attrs, quotes) : null}
          responses={responses}
          questions={questions}
          onResponse={onResponse}
          highlightQuestionIds={highlightQuestionIds}
          requiredMessageQuestionIds={requiredMessageQuestionIds}
          numericIssues={numericIssues}
          onQuestionFocus={onQuestionFocus}
          onQuestionHover={onQuestionHover}
          onGroupSelect={onGroupSelect}
        />
      ))}
    </div>
  );
}

function BlockCard({
  block,
  blockName,
  responses,
  questions,
  onResponse,
  highlightQuestionIds,
  requiredMessageQuestionIds,
  numericIssues,
  onQuestionFocus,
  onQuestionHover,
  onGroupSelect,
}: {
  block: Block;
  blockName: string | null;
} & Omit<Props, 'items' | 'groups'>) {
  const optionTextsAll = useSurveyResponseStore((s) => s.optionTexts);

  /** 판단 항목만 일괄 선택의 대상이다 — 다른 유형에는 그 값이 없다. */
  const judgements = block.items
    .map((item) => ({ item, shape: resolveJudgementShape(item.question) }))
    .filter((x): x is { item: StepItem; shape: NonNullable<typeof x.shape> } => x.shape !== null);

  const answeredCount = judgements.filter(({ item, shape }) => {
    const value = responses[item.question.id];
    if (value === shape.needValue || value === shape.dropValue) return true;
    // 의견은 서술이 있어야 답으로 친다 — 집계와 같은 규칙이다
    if (value !== shape.opinionValue) return false;
    return (optionTextsAll[item.question.id]?.[shape.opinionOptionId] ?? '').trim().length > 0;
  }).length;

  /**
   * 블록 일괄 선택. 판정은 `resolveBulkChoices` 한 곳에 있다 — 선택지 값이 **완전히
   * 같은** 단일선택 문항 둘 이상일 때만 나오고, 기타입력(의견)은 대상에서 빠진다.
   * 값이 다른 문항에 남의 값을 쓰면 응답자에게 보이지 않는 오답이 되기 때문이다.
   */
  const bulk = resolveJudgementBulkChoices(judgements.map(({ item }) => item.question));

  const applyBulk = (choice: (typeof bulk)[number]) => {
    for (const [questionId, value] of Object.entries(choice.valueByQuestionId)) {
      onResponse(questionId, value);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      {blockName && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-2 border-b border-gray-200 bg-blue-50/60 px-4 py-2.5',
            block.id && onGroupSelect && 'cursor-pointer hover:bg-blue-100/60',
          )}
          onClick={block.id && onGroupSelect ? () => onGroupSelect(block.id!) : undefined}
        >
          <Crop className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          <span className="text-sm font-semibold text-gray-900">{blockName}</span>
          <span className="text-xs text-gray-500">
            {judgements.length > 0
              ? `${judgements.length}문항 · ${answeredCount} 응답`
              : `${block.items.length}문항`}
          </span>
          {bulk.length > 0 && (
            <div className="ml-auto flex items-center gap-1.5">
              {bulk.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  onClick={() => applyBulk(choice)}
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
                >
                  모두 {choice.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {block.items.map((item) => {
          const shape = resolveJudgementShape(item.question);
          return shape ? (
            <JudgementRow
              key={item.question.id}
              question={item.question}
              shape={shape}
              value={responses[item.question.id]}
              onResponse={onResponse}
              isHighlighted={highlightQuestionIds.has(item.question.id)}
              onFocus={onQuestionFocus}
              onHover={onQuestionHover}
            />
          ) : (
            <div
              key={item.question.id}
              className="px-4 py-4"
              onFocusCapture={onQuestionFocus ? () => onQuestionFocus(item.question.id) : undefined}
              onClickCapture={onQuestionFocus ? () => onQuestionFocus(item.question.id) : undefined}
            >
              {/* 판단 항목이 아닌 문항은 일반 렌더 그대로 — 조사표 순서를 끊지 않는다 */}
              <GroupStepItem
                item={item}
                showSubgroupHeading={false}
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
    </div>
  );
}

function JudgementRow({
  question,
  shape,
  value,
  onResponse,
  isHighlighted,
  onFocus,
  onHover,
}: {
  question: Question;
  shape: NonNullable<ReturnType<typeof resolveJudgementShape>>;
  value: unknown;
  onResponse: (questionId: string, value: unknown) => void;
  isHighlighted: boolean;
  onFocus?: ((questionId: string) => void) | undefined;
  onHover?: ((questionId: string | null) => void) | undefined;
}) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const optionText =
    useSurveyResponseStore((s) => s.optionTexts[question.id]?.[shape.opinionOptionId]) ?? '';
  const setOptionText = useSurveyResponseStore((s) => s.setOptionText);
  const [manuallyOpen, setManuallyOpen] = useState(false);

  const isOpinion = value === shape.opinionValue;
  // 의견을 고르면 서술 칸이 열린다. 서술이 남아 있으면 접어도 다시 보여준다.
  const showNote = isOpinion || manuallyOpen || optionText.length > 0;

  const options = question.options ?? [];
  const labelOf = (optionValue: string) =>
    options.find((o) => o.value === optionValue)?.label ?? optionValue;

  const choices = [
    { value: shape.needValue, label: labelOf(shape.needValue) },
    { value: shape.dropValue, label: labelOf(shape.dropValue) },
    { value: shape.opinionValue, label: labelOf(shape.opinionValue) },
  ];

  return (
    <div
      data-question-id={question.id}
      className={cn('px-4 py-2.5', isHighlighted && 'bg-amber-50')}
      onFocusCapture={onFocus ? () => onFocus(question.id) : undefined}
      onClickCapture={onFocus ? () => onFocus(question.id) : undefined}
      // 훑는 동안의 미리보기 — 조사표를 움직이지 않고 이 문항의 영역만 밝힌다.
      onMouseEnter={onHover ? () => onHover(question.id) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {question.questionCode && (
          <span className="w-10 shrink-0 text-xs text-gray-500 tabular-nums">
            {question.questionCode}
          </span>
        )}
        <span className="min-w-0 flex-1 text-sm text-gray-900">
          {substituteTokens(question.title ?? '', attrs, quotes)}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={value === choice.value}
              onClick={() => onResponse(question.id, choice.value)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs transition-colors',
                value === choice.value
                  ? 'border-blue-500 bg-blue-500 font-medium text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700',
              )}
            >
              {choice.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setManuallyOpen((v) => !v)}
            aria-label={showNote ? '의견 칸 접기' : '의견 칸 펼치기'}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showNote && 'rotate-180')} />
          </button>
        </div>
      </div>

      {showNote && (
        <textarea
          value={optionText}
          onChange={(e) => setOptionText(question.id, shape.opinionOptionId, e.target.value)}
          rows={2}
          placeholder="의견을 적어 주세요. 비워두면 답한 것으로 치지 않습니다."
          className={cn(
            'mt-2 w-full rounded-md border p-2 text-sm outline-none',
            isOpinion && optionText.trim().length === 0
              ? 'border-amber-300 bg-amber-50/50 focus:border-amber-400'
              : 'border-gray-300 focus:border-blue-500',
          )}
        />
      )}
    </div>
  );
}
