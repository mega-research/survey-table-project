'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChevronDown, Crop } from 'lucide-react';

import { GroupStepItem } from '@/components/survey-response/step-views/group-step-item';
import { StepItem } from '@/lib/group-ordering';
import {
  resolveHoverAction,
  SCROLL_QUIET_MS,
} from '@/lib/survey-document/hover-follow';
import { questionShortCode } from '@/lib/question/label';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import {
  hasOpinionText,
  resolveJudgementBulkChoices,
  resolveJudgementShape,
  resolveOpinionPairs,
  type JudgementShape,
  type OpinionPairs,
} from '@/lib/survey/judgement-item';
import type { NumericIssue } from '@/lib/survey/numeric-validation';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import { Question, QuestionGroup } from '@/types/survey';

type ResponsesMap = Record<string, unknown>;

/**
 * 선택 컨트롤 폭. 그룹 머리의 일괄 버튼과 문항 행의 버튼이 **같은 자**를 써야
 * 세로줄이 맞는다 — 머리는 두 개뿐이라 세 번째 자리를 빈칸으로 채운다.
 */
const PICK_WIDTH = 'w-[312px]';

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
  /** 변동 확인 미선택 사유로 막힌 질문 — 컨트롤 아래 안내 문구를 표시한다(추적조사). */
  changeConfirmMessageQuestionIds: Set<string>;
  numericIssues: Map<string, NumericIssue[]>;
  /** 이 문항으로 초점을 옮긴다 — 조사표가 그 영역으로 따라간다. */
  onQuestionFocus?: ((questionId: string) => void) | undefined;
  /** 이 그룹으로 초점을 옮긴다 — 그룹 영역만 밝힌다. */
  onGroupSelect?: ((groupId: string) => void) | undefined;
  /** 지금 초점이 놓인 그룹 (문항이 초점이면 그 문항의 소속 그룹). */
  activeGroupId?: string | null;
  /** 지금 초점인 문항. 그룹이 초점이면 null. */
  focusedQuestionId?: string | null;
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
  changeConfirmMessageQuestionIds,
  numericIssues,
  onQuestionFocus,
  onGroupSelect,
  activeGroupId = null,
  focusedQuestionId = null,
}: Props) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();

  const rootRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 이 시각까지는 목록이 스크롤 중인 것으로 본다. */
  const scrollingUntil = useRef(0);

  const cancelHover = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }, []);

  // 스크롤 중에는 커서가 가만히 있어도 행이 밑으로 지나가며 hover 가 발화한다.
  // 어느 컨테이너가 목록을 스크롤할지는 셸이 정하므로 캡처 단계에서 전부 받되,
  // **이 목록을 담고 있는 스크롤러의 것만** 인정한다. 왼쪽 조사표 판이 초점을
  // 따라 부드럽게 스크롤하는 동안에도 이벤트가 여기까지 오는데, 그것까지 세면
  // 초점을 옮길 때마다 수백 ms 동안 hover 가 죽는다 — "가끔 안 먹는" 정체다.
  useEffect(() => {
    const onAnyScroll = (event: Event) => {
      const root = rootRef.current;
      const scroller = event.target as Node | null;
      if (!root || !scroller || typeof (scroller as Node).contains !== 'function') return;
      if (!scroller.contains(root)) return;
      scrollingUntil.current = Date.now() + SCROLL_QUIET_MS;
      cancelHover();
    };
    window.addEventListener('scroll', onAnyScroll, true);
    return () => {
      window.removeEventListener('scroll', onAnyScroll, true);
      cancelHover();
    };
  }, [cancelHover]);

  /** 머무르면 따라가고 스쳐 지나가면 무시한다 — 판정은 hover-follow 소관이다. */
  const hoverQuestion = useCallback(
    (questionId: string, groupId: string | null) => {
      cancelHover();
      if (!onQuestionFocus) return;
      const action = resolveHoverAction({
        groupId,
        activeGroupId,
        now: Date.now(),
        scrollingUntil: scrollingUntil.current,
      });
      if (action.kind === 'ignore') return;
      if (action.kind === 'now') {
        onQuestionFocus(questionId);
        return;
      }
      hoverTimer.current = setTimeout(() => onQuestionFocus(questionId), action.delayMs);
    },
    [cancelHover, onQuestionFocus, activeGroupId],
  );

  // 의견 짝은 스텝 순서로 판정한다 — 부모 바로 다음이라는 조건이 순서에 걸려 있다.
  const pairs = useMemo(() => resolveOpinionPairs(items.map((item) => item.question)), [items]);

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
    <div ref={rootRef} className="space-y-3" onMouseLeave={cancelHover}>
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
          changeConfirmMessageQuestionIds={changeConfirmMessageQuestionIds}
          numericIssues={numericIssues}
          onQuestionFocus={onQuestionFocus}
          onGroupSelect={onGroupSelect}
          onQuestionHover={hoverQuestion}
          onHoverEnd={cancelHover}
          isActiveGroup={block.id !== null && block.id === activeGroupId}
          focusedQuestionId={focusedQuestionId}
          pairs={pairs}
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
  changeConfirmMessageQuestionIds,
  numericIssues,
  onQuestionFocus,
  onGroupSelect,
  onQuestionHover,
  onHoverEnd,
  isActiveGroup,
  focusedQuestionId,
  pairs,
}: {
  block: Block;
  blockName: string | null;
  responses: ResponsesMap;
  questions: Question[];
  onResponse: (questionId: string, value: unknown) => void;
  highlightQuestionIds: Set<string>;
  requiredMessageQuestionIds: Set<string>;
  /** 변동 확인 미선택 사유로 막힌 질문 — 컨트롤 아래 안내 문구를 표시한다(추적조사). */
  changeConfirmMessageQuestionIds: Set<string>;
  numericIssues: Map<string, NumericIssue[]>;
  onQuestionFocus?: ((questionId: string) => void) | undefined;
  onGroupSelect?: ((groupId: string) => void) | undefined;
  onQuestionHover: (questionId: string, groupId: string | null) => void;
  onHoverEnd: () => void;
  isActiveGroup: boolean;
  focusedQuestionId: string | null;
  pairs: OpinionPairs;
}) {
  const judgements = useMemo(
    () =>
      block.items
        .map((item) => ({ item, shape: resolveJudgementShape(item.question) }))
        .filter((x): x is { item: StepItem; shape: JudgementShape } => x.shape !== null),
    [block.items],
  );

  // 판정만 응답으로 센다. 의견은 판정에 딸린 것이라 있든 없든 응답 수와 무관하다.
  const answeredCount = judgements.filter(({ item, shape }) => {
    const value = responses[item.question.id];
    return value === shape.needValue || value === shape.dropValue;
  }).length;

  /**
   * 블록 일괄 선택. 문항마다 **자기 값**을 쓴다 — 선택지 값은 문항별로 발번되므로
   * 값 하나를 전부에 쓰면 그 문항에 없는 값이 들어가 보이지 않는 오답이 된다.
   */
  const bulk = resolveJudgementBulkChoices(judgements.map(({ item }) => item.question));
  const allAre = (choice: (typeof bulk)[number]) =>
    Object.entries(choice.valueByQuestionId).every(([id, value]) => responses[id] === value);

  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border bg-white',
        isActiveGroup ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-200',
      )}
    >
      {blockName && (
        <div
          onClick={block.id && onGroupSelect ? () => onGroupSelect(block.id!) : undefined}
          className={cn(
            'flex items-center gap-3 border-b border-gray-200 px-4 py-2.5',
            // 파란색은 "지금 이 그룹" 하나만 쓴다 — 전부 파랗게 두면 어디를 보는지 모른다.
            isActiveGroup ? 'bg-blue-50' : 'bg-gray-50',
            block.id && onGroupSelect && 'cursor-pointer',
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Crop size={14} className={isActiveGroup ? 'text-blue-600' : 'text-gray-400'} />
            <span
              className={cn(
                'truncate text-[13px] font-semibold',
                isActiveGroup ? 'text-blue-700' : 'text-gray-800',
              )}
            >
              {blockName}
            </span>
            <span className="shrink-0 text-[11px] text-gray-500">
              {judgements.length > 0
                ? `${judgements.length}문항 · ${answeredCount} 응답`
                : `${block.items.length}문항`}
            </span>
          </span>
          <div
            className={cn('flex shrink-0 gap-1.5', PICK_WIDTH)}
            onClick={(e) => e.stopPropagation()}
          >
            {bulk.map((choice) => (
              <Seg
                key={choice.key}
                className="text-[10px]"
                label={`모두 ${choice.label}`}
                on={allAre(choice)}
                tone={choice.key}
                onClick={() => {
                  for (const [questionId, value] of Object.entries(choice.valueByQuestionId)) {
                    onResponse(questionId, value);
                  }
                }}
              />
            ))}
            {/* 의견은 문항마다 다른 글을 받는 것이라 일괄이 성립하지 않는다 — 자리만 비운다 */}
            <span className="flex-1" />
          </div>
          <span className="w-[14px] shrink-0" />
        </div>
      )}

      {block.items.map((item) => {
        // 의견 짝 문항은 부모 행 안에 그려진다 — 여기서 자기 행을 만들면 두 번 나온다.
        if (pairs.opinionIds.has(item.question.id)) return null;
        const shape = resolveJudgementShape(item.question);
        const opinionQuestion = pairs.opinionOf.get(item.question.id) ?? null;
        return shape ? (
          <JudgementRow
            key={item.question.id}
            question={item.question}
            shape={shape}
            value={responses[item.question.id]}
            opinionQuestion={opinionQuestion}
            opinion={opinionQuestion ? responses[opinionQuestion.id] : undefined}
            active={focusedQuestionId === item.question.id}
            invalid={highlightQuestionIds.has(item.question.id)}
            onPick={(value) => onResponse(item.question.id, value)}
            onOpinion={(text) => opinionQuestion && onResponse(opinionQuestion.id, text)}
            onFocus={() => onQuestionFocus?.(item.question.id)}
            onHover={() => onQuestionHover(item.question.id, item.question.groupId ?? null)}
            onHoverEnd={onHoverEnd}
          />
        ) : (
          // 판단 항목이 아닌 행도 자기 영역을 가질 수 있다 — hover 를 빼면
          // 목록 가운데 몇 줄만 반응하지 않는 것처럼 보인다.
          <div
            key={item.question.id}
            className="border-b border-gray-100 px-4 py-4 last:border-0"
            onClick={() => onQuestionFocus?.(item.question.id)}
            onMouseEnter={() => onQuestionHover(item.question.id, item.question.groupId ?? null)}
            onMouseLeave={onHoverEnd}
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
              showChangeConfirmMessage={changeConfirmMessageQuestionIds.has(item.question.id)}
              issues={numericIssues.get(item.question.id)}
            />
          </div>
        );
      })}
    </section>
  );
}

/** 세 번째 버튼의 이름. 판정이 아니라 서술 칸을 여닫는 토글이지만 화면은 그대로다. */
const OPINION_TOGGLE_LABEL = '의견 (자유기재)';

function JudgementRow({
  question,
  shape,
  value,
  opinionQuestion,
  opinion,
  active,
  invalid,
  onPick,
  onOpinion,
  onFocus,
  onHover,
  onHoverEnd,
}: {
  question: Question;
  shape: JudgementShape;
  value: unknown;
  /** 의견 짝 문항. 없으면 서술 칸도 토글도 그리지 않는다 — 담을 곳이 없다. */
  opinionQuestion: Question | null;
  /** 짝 문항의 답. */
  opinion: unknown;
  active: boolean;
  invalid: boolean;
  onPick: (value: string) => void;
  onOpinion: (text: string) => void;
  onFocus: () => void;
  onHover: () => void;
  onHoverEnd: () => void;
}) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();

  // 조사표 사각형과 같은 규칙 — 엑셀 라벨이 있으면 그것, 없으면 문항코드.
  const shortCode = questionShortCode(question);

  const note = typeof opinion === 'string' ? opinion : '';
  const hasNote = hasOpinionText(note);
  /**
   * 서술 칸을 열어 둔 상태. 글이 있으면 늘 열려 있고, 없을 때만 토글이 여닫는다 —
   * 적어 둔 글을 접어서 숨기면 "내가 뭐라고 썼지"를 다시 눌러 봐야 한다.
   * 의견은 판정과 직교하므로 필요함/필요하지 않음 선택과 무관하게 열린다 (ADR 0022).
   */
  const [opened, setOpened] = useState(false);
  const isOpinionOpen = opinionQuestion !== null && (hasNote || opened);

  /**
   * 이 행의 입력칸에 커서가 있는 동안은 hover 로 따라가지 않는다.
   * 적는 도중 마우스가 스치기만 해도 조사표가 이 문항 쪽으로 돌아와, 맥락을 보려고
   * 넘겨둔 쪽을 빼앗는다.
   */
  const typing = useRef(false);

  const labelOf = (optionValue: string) =>
    question.options?.find((o) => o.value === optionValue)?.label ?? optionValue;

  return (
    <div
      data-question-id={question.id}
      onClick={onFocus}
      onMouseEnter={() => {
        if (!typing.current) onHover();
      }}
      onMouseLeave={onHoverEnd}
      className={cn(
        'cursor-pointer border-b border-gray-100 px-4 py-2.5 last:border-0',
        active && 'bg-amber-50',
        invalid && 'bg-red-50 ring-1 ring-inset ring-red-300',
      )}
    >
      <div className="flex items-center gap-3">
        {/* 코드 칸은 한 줄이다. B6_1_A 가 두 줄로 접히면 행 높이가 들쭉날쭉해져
            옆 문항과 눈으로 짝지을 수 없다. 넘치면 줄이고 전체는 툴팁으로 준다. */}
        <span
          className="w-14 shrink-0 truncate text-center text-[11px] font-bold whitespace-nowrap text-gray-500"
          title={shortCode ?? undefined}
        >
          {shortCode}
        </span>
        <span className="min-w-0 flex-1 text-[13px] text-gray-900">
          {substituteTokens(question.title ?? '', attrs, quotes)}
        </span>
        <div className={cn('flex shrink-0 gap-1.5', PICK_WIDTH)}>
          <Seg
            label={labelOf(shape.needValue)}
            on={value === shape.needValue}
            tone="need"
            invalid={invalid}
            onClick={() => onPick(shape.needValue)}
          />
          <Seg
            label={labelOf(shape.dropValue)}
            on={value === shape.dropValue}
            tone="drop"
            invalid={invalid}
            onClick={() => onPick(shape.dropValue)}
          />
          {/* 판정 버튼이 아니라 서술 칸 토글이다. 글이 있으면 켜진 색으로 남는다. */}
          {opinionQuestion && (
            <Seg
              label={OPINION_TOGGLE_LABEL}
              on={hasNote || opened}
              tone="opinion"
              invalid={false}
              onClick={() => setOpened((v) => !v)}
            />
          )}
        </div>
        <span className="flex w-[14px] shrink-0 justify-center text-gray-400">
          {isOpinionOpen && <ChevronDown size={14} className="rotate-180" />}
        </span>
      </div>

      {/* 서술은 짝 문항의 답이다. 판정과 직교하므로 어느 판정을 골랐든 함께 남는다. */}
      {isOpinionOpen && opinionQuestion && (
        <div className="mt-2">
          <textarea
            value={note}
            onChange={(e) => onOpinion(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onFocus={() => (typing.current = true)}
            onBlur={() => (typing.current = false)}
            rows={3}
            placeholder="이 문항에 대한 의견을 자유롭게 적어 주십시오"
            className="w-full rounded-md border border-gray-300 p-2 text-[12px] outline-none focus:border-blue-500"
          />
        </div>
      )}
    </div>
  );
}

/** 눌린 선택지의 색. 필요함은 파랑, 필요하지 않음은 짙은 회색, 의견은 주황. */
const SEG_ON: Record<'need' | 'drop' | 'opinion', string> = {
  need: 'bg-blue-500 text-white',
  drop: 'bg-[#4b4b52] text-white',
  opinion: 'bg-amber-600 text-white',
};

function Seg({
  label,
  on,
  tone,
  invalid,
  className,
  onClick,
}: {
  label: string;
  on: boolean;
  tone: 'need' | 'drop' | 'opinion';
  invalid?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex-1 rounded-md px-1 py-1.5 text-[11px] whitespace-nowrap transition-colors',
        on
          ? cn('font-semibold', SEG_ON[tone])
          : invalid
            ? 'border border-red-400 bg-white text-red-500 hover:bg-red-50'
            : 'border border-gray-200 bg-white text-gray-500 hover:bg-gray-50',
        className,
      )}
    >
      {label}
    </button>
  );
}
