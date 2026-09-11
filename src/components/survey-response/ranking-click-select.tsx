'use client';

import { type CSSProperties, type KeyboardEvent, type ReactNode, useState } from 'react';

import {
  OPTION_TEXT_BARE_INPUT_CLS,
  OptionTextRow,
} from '@/components/survey-response/option-text-input-stack';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { rankingTextTargetId } from '@/lib/survey/option-text-target';
import {
  isPriorRanking,
  isPriorRankingText,
  PRIOR_HIGHLIGHT_TEXT_CLS,
} from '@/lib/survey/prior-answer-highlight';
import { usePriorHighlight } from '@/lib/survey/prior-answers-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { QuestionOption, RankingAnswer } from '@/types/survey';
import { rankOfOption, toggleRankingOption } from '@/utils/ranking-click';
import { RANKING_OTHER_VALUE } from '@/utils/ranking-shared';

/**
 * 순위형 "보기 클릭" 입력 UI.
 *
 * 드롭다운(RankingDropdownStack)을 대신해 보기 자체를 누르면 순위가 매겨진다.
 * - 상단 요약 줄: `1순위 [n] 2순위 [-]` + 순위초기화
 * - 보기 표: 누르면 비어 있는 가장 낮은 순위, 다시 누르면 해제(뒤 순위 당김)
 * - 기타·상세기재 보기는 순위가 매겨졌을 때만 보기 목록 아래에 `기타 | 입력칸` 줄이 나온다
 *
 * 응답 모양은 드롭다운과 같아 저장·검증·내보내기·이월 표시가 그대로다.
 * 표 소스(내장 표의 순위 옵션 셀)·그룹별 순위는 ranking-question 이 같은 핸들과 조각을
 * TablePreview renderCell / 모바일 카드 안에 그린다. 드롭다운은 표 안 ranking 셀과
 * 중복 순위 허용 문항에만 남는다.
 */

export interface RankingClickArgs {
  answers: RankingAnswer[];
  positions: number;
  onChange: (next: RankingAnswer[]) => void;
  /** 순위가 다 찬 상태에서 다른 보기를 눌렀는지 알린다(안내 문구용). */
  onFull?: ((full: boolean) => void) | undefined;
}

export interface RankingClickHandle {
  toggle: (optionValue: string) => void;
  reset: () => void;
  setOtherText: (optionValue: string, text: string) => void;
  setOptionText: (optionValue: string, text: string) => void;
}

/** 훅이 아니다 — 그룹별 순위처럼 한 컴포넌트가 핸들을 여럿 만들 때 쓴다. */
export function buildRankingClickHandle({
  answers,
  positions,
  onChange,
  onFull,
}: RankingClickArgs): RankingClickHandle {
  const patch = (optionValue: string, field: 'otherText' | 'optionText', text: string) => {
    const current = answers.find((a) => a.optionValue === optionValue);
    if (!current) return;
    onChange(
      answers
        .map((a) => (a === current ? { ...a, [field]: text } : a))
        .sort((a, b) => a.rank - b.rank),
    );
  };
  return {
    toggle: (optionValue) => {
      const { next, full } = toggleRankingOption(answers, optionValue, positions);
      onFull?.(full);
      if (!full) onChange(next);
    },
    reset: () => {
      onFull?.(false);
      onChange([]);
    },
    setOtherText: (v, t) => patch(v, 'otherText', t),
    setOptionText: (v, t) => patch(v, 'optionText', t),
  };
}

export function useRankingClick(
  args: Omit<RankingClickArgs, 'onFull'>,
): RankingClickHandle & { fullNotice: boolean } {
  const [fullNotice, setFullNotice] = useState(false);
  return { ...buildRankingClickHandle({ ...args, onFull: setFullNotice }), fullNotice };
}

/** 요약 칩에 쓰는 보기 번호 — 보기 목록 안의 1-based 순번. 질문 레벨 기타는 마지막 번호. */
export function rankingOptionOrdinal(options: QuestionOption[], optionValue: string): number {
  const idx = options.findIndex((o) => o.value === optionValue);
  if (idx >= 0) return idx + 1;
  return options.length + 1;
}

export interface RankingSummaryBarProps {
  answers: RankingAnswer[];
  options: QuestionOption[];
  positions: number;
  onReset: () => void;
  /** 이월 표시 판정용. 미전달이면 칠하지 않는다. */
  questionId?: string | undefined;
  cellId?: string | undefined;
}

/** `1순위 [n]  2순위 [-]` 요약 + 순위초기화 버튼. */
export function RankingSummaryBar({
  answers,
  options,
  positions,
  onReset,
  questionId,
  cellId,
}: RankingSummaryBarProps) {
  const priorHighlight = usePriorHighlight();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {Array.from({ length: positions }, (_, i) => i + 1).map((rank) => {
        const entry = answers.find((a) => a.rank === rank);
        const prior =
          entry !== undefined &&
          questionId !== undefined &&
          isPriorRanking(priorHighlight, questionId, rank, entry.optionValue, cellId);
        return (
          <div key={rank} className="flex items-center gap-1.5 text-sm text-gray-700">
            <span className="font-medium">{rank}순위</span>
            <span
              aria-label={`${rank}순위 선택`}
              data-testid={`ranking-summary-${rank}`}
              className={cn(
                'inline-flex h-8 min-w-10 items-center justify-center rounded-md border px-2 text-sm font-semibold tabular-nums',
                entry
                  ? 'border-blue-500 bg-blue-50 text-blue-900'
                  : 'border-gray-300 bg-gray-50 text-gray-400',
                prior && PRIOR_HIGHLIGHT_TEXT_CLS,
              )}
            >
              {entry ? rankingOptionOrdinal(options, entry.optionValue) : '-'}
            </span>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onReset}
        disabled={answers.length === 0}
        className="ml-auto rounded-md border border-blue-500 bg-white px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400 disabled:hover:bg-white"
      >
        순위초기화
      </button>
    </div>
  );
}

/** 순위가 다 찼는데 다른 보기를 눌렀을 때의 안내. */
export function RankingFullNotice({ positions }: { positions: number }) {
  return (
    <p role="status" className="text-sm text-amber-700">
      {positions}순위까지 모두 선택했습니다. 바꾸려면 선택한 보기를 다시 누르거나 순위를 초기화하세요.
    </p>
  );
}

/** 보기 앞의 순위 배지. 미선택이면 빈 네모(자리만 잡는다). */
export function RankingRankBadge({ rank, prior }: { rank: number | undefined; prior?: boolean }) {
  const selected = rank !== undefined;
  return (
    <span
      aria-hidden={!selected}
      className={cn(
        'inline-flex h-6 shrink-0 items-center justify-center rounded px-1.5 text-xs font-semibold whitespace-nowrap',
        selected
          ? prior
            ? 'bg-red-600 text-white'
            : 'bg-blue-600 text-white'
          : 'w-6 border border-gray-300 bg-white text-transparent',
      )}
    >
      {selected ? `${rank}순위` : ''}
    </span>
  );
}

/** 보기의 입력 종류 — 기타(otherText) / 상세기재(optionText) / 없음. */
export function rankingTextField(option: QuestionOption): 'otherText' | 'optionText' | null {
  if (option.value === RANKING_OTHER_VALUE) return 'otherText';
  if (option.allowTextInput === true) return 'optionText';
  return null;
}

export interface RankingOptionTextInputProps {
  option: QuestionOption;
  rank: number | undefined;
  entry: RankingAnswer | undefined;
  handle: Pick<RankingClickHandle, 'setOtherText' | 'setOptionText'>;
  detailTargetScopeId?: string | undefined;
  questionId?: string | undefined;
  cellId?: string | undefined;
  /** 라벨 칩에 쓰는 치환된 보기 라벨. */
  label: string;
}

/**
 * 기타·상세기재 보기의 입력 줄 — `기타 | 입력칸` 모양(OptionTextRow). 순위가 매겨졌을 때만 그린다.
 * 보기 행 안이 아니라 보기 목록 **아래**에 쌓는다 — 드롭다운 방식이 드롭다운 아래에 두는 것과
 * 같은 자리다(2026-09-11 결정: 행 안에 늘 보이는 입력칸은 목록을 어지럽힌다).
 */
export function RankingOptionTextInput({
  option,
  rank,
  entry,
  handle,
  detailTargetScopeId,
  questionId,
  cellId,
  label,
}: RankingOptionTextInputProps) {
  const priorHighlight = usePriorHighlight();
  const field = rankingTextField(option);
  if (field === null || rank === undefined) return null;
  const isOther = field === 'otherText';
  const text = entry?.[field] ?? '';
  const priorText =
    questionId !== undefined &&
    isPriorRankingText(priorHighlight, questionId, rank, field, text, cellId);
  return (
    <OptionTextRow label={isOther ? '기타' : label.trim() || '상세 기재'}>
      <input
        type="text"
        value={text}
        placeholder={isOther ? '기타 내용 입력...' : option.textInputPlaceholder || '상세 기재'}
        aria-label={`${rank}순위 ${isOther ? '기타 ' : ''}상세 기재`}
        name={`ranking-${isOther ? 'other' : 'text'}-${option.id}`}
        autoComplete="off"
        onChange={(e) =>
          isOther
            ? handle.setOtherText(option.value, e.target.value)
            : handle.setOptionText(option.value, e.target.value)
        }
        data-option-text-target-id={
          detailTargetScopeId
            ? rankingTextTargetId(detailTargetScopeId, rank, option.value)
            : undefined
        }
        className={cn(OPTION_TEXT_BARE_INPUT_CLS, priorText && PRIOR_HIGHLIGHT_TEXT_CLS)}
      />
    </OptionTextRow>
  );
}

export interface RankingDetailRowsProps {
  answers: RankingAnswer[];
  /** 기타 합성 보기까지 포함한 목록. */
  options: QuestionOption[];
  handle: Pick<RankingClickHandle, 'setOtherText' | 'setOptionText'>;
  detailTargetScopeId?: string | undefined;
  questionId?: string | undefined;
  cellId?: string | undefined;
}

/** 순위가 매겨진 기타·상세기재 보기의 입력 줄을 순위 순으로 쌓는다. 없으면 null. */
export function RankingDetailRows({
  answers,
  options,
  handle,
  detailTargetScopeId,
  questionId,
  cellId,
}: RankingDetailRowsProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const rows = [...answers]
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => {
      const option = options.find((o) => o.value === entry.optionValue);
      if (!option || rankingTextField(option) === null) return null;
      return (
        <RankingOptionTextInput
          key={`detail-${entry.rank}`}
          option={option}
          rank={entry.rank}
          entry={entry}
          handle={handle}
          detailTargetScopeId={detailTargetScopeId}
          questionId={questionId}
          cellId={cellId}
          label={substituteTokens(option.label, attrs, quotes)}
        />
      );
    })
    .filter(Boolean);
  if (rows.length === 0) return null;
  return <div className="space-y-1.5">{rows}</div>;
}

export interface RankingOptionFaceProps {
  option: QuestionOption;
  /** 이 보기의 현재 순위. 없으면 미선택. */
  rank: number | undefined;
  handle: Pick<RankingClickHandle, 'toggle'>;
  questionId?: string | undefined;
  cellId?: string | undefined;
  /** 라벨 대신 그릴 노드(표 셀의 이미지 등). 미전달이면 option.label 을 치환해 그린다. */
  labelNode?: ReactNode;
  /** 표 셀 안처럼 배경·테두리를 바깥이 책임질 때 true — 여백 없이 내용만 그린다. */
  bare?: boolean | undefined;
  className?: string | undefined;
}

/**
 * 보기 하나의 얼굴 — 순위 배지 + 라벨. 기타·상세기재 입력은 여기 없고 목록 아래(RankingDetailRows)다.
 * 수동 보기 목록의 행과 표 소스의 셀이 쓴다. 모바일 카드는 배지 조각만 가져다 쓴다.
 */
export function RankingOptionFace({
  option,
  rank,
  handle,
  questionId,
  cellId,
  labelNode,
  bare = false,
  className,
}: RankingOptionFaceProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const priorHighlight = usePriorHighlight();

  const selected = rank !== undefined;
  const label = substituteTokens(option.label, attrs, quotes);
  const prior =
    selected &&
    questionId !== undefined &&
    isPriorRanking(priorHighlight, questionId, rank, option.value, cellId);

  // 빌더가 보기에 색을 지정했으면 미선택일 때만 그대로 쓴다 — 선택 표시가 그 색에 묻히면 안 된다.
  const customStyle: CSSProperties | undefined =
    !selected && (option.backgroundColor || option.textColor)
      ? {
          ...(option.backgroundColor ? { backgroundColor: option.backgroundColor } : {}),
          ...(option.textColor ? { color: option.textColor } : {}),
        }
      : undefined;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handle.toggle(option.value);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={label}
      onClick={() => handle.toggle(option.value)}
      onKeyDown={onKeyDown}
      data-ranking-option={option.value}
      className={cn(
        // items-center: 배지와 글자를 행 가운데에 — 위쪽 기준이면 한 줄짜리 행에서 내용이 떠 보인다
        'flex min-w-0 cursor-pointer items-center gap-2.5 text-base leading-snug outline-none select-none',
        'rounded-md transition-colors',
        bare ? 'w-full px-2 py-1' : 'px-3 py-2',
        selected ? 'bg-blue-50 text-blue-900' : bare ? 'hover:bg-gray-50' : 'bg-white text-gray-800 hover:bg-gray-50',
        'focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-inset',
        option.textBold && 'font-bold',
        prior && PRIOR_HIGHLIGHT_TEXT_CLS,
        className,
      )}
      style={customStyle}
    >
      {/* 배지는 행의 직접 자식으로 — 인라인 span 으로 감싸면 기준선 여백이 생겨 글자보다 위로 뜬다 */}
      <RankingRankBadge rank={rank} prior={prior} />
      <span className="min-w-0 flex-1 whitespace-pre-line [overflow-wrap:anywhere]">
        {labelNode ?? label}
      </span>
    </div>
  );
}

export interface RankingClickListProps {
  answers: RankingAnswer[];
  options: QuestionOption[];
  positions: number;
  /** 질문 레벨 '기타 (직접 입력)' 합성 보기를 마지막 행으로 붙일지. */
  allowOther: boolean;
  onChange: (next: RankingAnswer[]) => void;
  /** 보기 열 수 — question.optionsColumns 와 같은 의미(undefined/1=1열, 0=가로, N≥2=N열). */
  columns?: number | undefined;
  detailTargetScopeId?: string | undefined;
  questionId?: string | undefined;
  cellId?: string | undefined;
}

export const RANKING_OTHER_OPTION: QuestionOption = {
  id: RANKING_OTHER_VALUE,
  value: RANKING_OTHER_VALUE,
  label: '기타 (직접 입력)',
};

/** 보기 표의 격자 클래스/스타일 — 응답 UI 와 빌더 미리보기가 같은 모양을 쓴다. */
export function rankingGridLayout(columns: number | undefined): {
  className: string;
  style: CSSProperties | undefined;
  itemClassName: string;
} {
  if (columns === 0) {
    return {
      className: 'flex flex-wrap gap-2',
      style: undefined,
      itemClassName: 'rounded-md border border-gray-300',
    };
  }
  const cols = columns !== undefined && columns >= 2 ? columns : 1;
  return {
    className: 'grid border-t border-l border-gray-300 sm:[grid-template-columns:var(--ranking-cols)]',
    style: { '--ranking-cols': `repeat(${cols}, minmax(0, 1fr))` } as CSSProperties,
    itemClassName: 'border-r border-b border-gray-300',
  };
}

/** 수동 보기(optionsSource=manual) 순위형: 요약 줄 + 보기 표. */
export function RankingClickList({
  answers,
  options,
  positions,
  allowOther,
  onChange,
  columns,
  detailTargetScopeId,
  questionId,
  cellId,
}: RankingClickListProps) {
  const handle = useRankingClick({ answers, positions, onChange });
  const rows = allowOther ? [...options, RANKING_OTHER_OPTION] : options;
  const layout = rankingGridLayout(columns);

  return (
    <div className="space-y-3">
      <RankingSummaryBar
        answers={answers}
        options={options}
        positions={positions}
        onReset={handle.reset}
        questionId={questionId}
        cellId={cellId}
      />
      {handle.fullNotice && <RankingFullNotice positions={positions} />}
      <div role="group" aria-label="순위 보기" className={layout.className} style={layout.style}>
        {rows.map((opt) => (
          <RankingOptionFace
            key={opt.id}
            option={opt}
            rank={rankOfOption(answers, opt.value)}
            handle={handle}
            questionId={questionId}
            cellId={cellId}
            className={layout.itemClassName}
          />
        ))}
      </div>
      <RankingDetailRows
        answers={answers}
        options={rows}
        handle={handle}
        detailTargetScopeId={detailTargetScopeId}
        questionId={questionId}
        cellId={cellId}
      />
    </div>
  );
}
