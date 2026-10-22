import type { Question, QuestionGroup } from '@/types/survey';
import { type BranchEvalCtx, responsesToLookupShape } from '@/utils/branch-eval';
import { collectTraversedQuestionIds } from '@/utils/branch-logic';
import { buildRenderSteps, stepIdOf, type RenderStep } from '@/utils/group-ordering';

import { resolveVisibleQuestionIds, stripHiddenQuestionValues } from './question-visibility';
import { PERSISTED_ROOT_SIDECAR_KEYS } from './response-sidecars';

/**
 * 경로 밖 문항 응답 (CONTEXT.md 「경로 밖 문항」) — 분기 이동(goto·end)으로 건너뛴 페이지의 답.
 *
 * 응답자가 앞 페이지 답을 바꿔 분기로 다른 페이지로 건너뛰면, 전에 답해 둔 건너뛴 페이지의 값이
 * 응답에 남는다. 표시 조건은 참이라 숨은 문항 strip 이 지우지 못하고, 그 값이 자격미달 보기면
 * 자격미달 판정이 정상 완료를 screened_out 으로 오판한다.
 *
 * **경로는 응답 화면과 같은 함수로 계산한다.** 페이지는 `buildRenderSteps(questions, groups)`,
 * 걸음은 `collectTraversedQuestionIds` — 응답 화면이 제출 검증·응답 수에 쓰는 바로 그 시뮬레이션이다.
 * 첫 페이지부터 지금 답으로 끝까지 걷고(end 에서 멈춤, 전진 goto 만 점프, 뒤로 가는 goto 는 무시),
 * 걸음에 들지 않은 페이지의 문항이 경로 밖이다. 끝까지 걸으므로 진행 중 응답이 아직 가지 않은
 * 뒤쪽 경로 페이지는 경로 위로 남는다.
 *
 * **경로를 확정할 수 없으면 경로 밖 strip 을 건너뛴다**(fail-safe — 숨은 문항 strip 은 그대로).
 * 서버가 계산한 경로가 응답 화면과 어긋나면 멀쩡한 답을 지우기 때문이다. 사유는 `AnswerPathSkip`.
 *
 * 저장 경계 중 응답 확정(완료 제출·빈 complete·관리자 수정)과 Raw 내보내기의 마지막 그물만 쓴다.
 * 응답 화면은 즉시 지우지 않고, 초안·구간 저장에도 걸지 않는다 — 부분 패치라 경로를 정하는 상류
 * 답이 없어 멀쩡한 답을 지운다(주의사항 14). server-only 의존 금지.
 */

/** 경로 밖 strip 을 건너뛴 사유. */
export type AnswerPathSkip =
  /** 문항 섞기 — 응답자마다 순서가 달라질 수 있는 설정. 지금은 응답 화면이 섞지 않지만 켜진 설문은 믿지 않는다. */
  | 'shuffle'
  /**
   * 문항·그룹 표시 조건이 응답 인용 이름을 명단 값 자리로 읽는다. 응답 화면은 인용값을 명단 값 위에
   * 얹어 조건을 풀지만(인용 우선) 서버 재료에는 인용값이 없다.
   */
  | 'answer-quote-condition'
  /** 응답 행에 기록된 마지막 페이지가 계산한 경로 위에 없다 — 응답자가 이 시뮬레이션대로 걷지 않았다. */
  | 'last-step-off-path'
  /** 기록된 마지막 페이지가 지금 구조에 없다(재배포·옛 형식) — 경로를 맞춰 볼 수 없다. */
  | 'last-step-unknown';

export interface AnswerPathOptions {
  /** 그 응답이 수집된 버전의 설정. 문항 섞기가 켜져 있으면 건너뛴다. */
  settings?: { shuffleQuestions?: boolean | null } | null | undefined;
  /**
   * 응답 행에 기록된 마지막 페이지(`current_step_id`, `stepIdOf` 형식). 주어지면 그 페이지가
   * 계산한 경로 위에 있어야 경로를 믿는다 — 재배포 후 이어하기가 응답자를 시뮬레이션 경로 밖
   * 페이지에 세운 경우를 걸러낸다. 관리자 수정은 넘기지 않는다(편집 화면은 늘 첫 페이지부터
   * 분기대로 걷고, 저장이 이 값을 비운다). null·undefined 면 이 확인을 하지 않는다.
   */
  lastStepId?: string | null | undefined;
}

export interface ReachedAnswers {
  /** 숨은 문항·경로 밖 문항의 답과 사이드카 항목을 뺀 응답. 지울 것이 없으면 입력 참조. */
  responses: Record<string, unknown>;
  /**
   * 남은 문항 — 표시되고, 경로를 확정했으면 경로 위인 문항. 계산 칸을 새로 채울 대상이다.
   * 어느 페이지에도 들지 않는 문항은 응답 화면에 그려지지 않으므로 넣지 않는다.
   */
  reachedQuestionIds: Set<string>;
  /** 경로 밖 strip 을 건너뛴 사유. null 이면 경로를 확정해 적용했다. */
  pathSkipped: AnswerPathSkip | null;
}

/** 조건 트리 어디에든 박힌 `attrsKey` 문자열을 모은다(attr 피연산자·LUT 키 매핑 공통). */
function collectAttrsKeys(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectAttrsKeys(item, out);
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'attrsKey' && typeof value === 'string') out.add(value);
    else collectAttrsKeys(value, out);
  }
}

/** 이 설문이 만드는 응답 인용 이름(문항 레벨 + 셀 레벨) — answer-quote 의 수집 규칙과 같은 기준. */
function collectAnswerQuoteNames(questions: readonly Question[]): Set<string> {
  const names = new Set<string>();
  for (const question of questions) {
    const name = question.answerQuoteEnabled ? (question.answerQuoteName ?? '').trim() : '';
    if (name) names.add(name);
    for (const row of question.tableRowsData ?? []) {
      for (const cell of row.cells ?? []) {
        const cellName = cell.answerQuoteEnabled ? (cell.answerQuoteName ?? '').trim() : '';
        if (cellName) names.add(cellName);
      }
    }
  }
  return names;
}

/** 걸음을 정하는 표시 조건(문항·그룹)이 응답 인용 이름을 읽는가. */
function pathConditionsReadAnswerQuotes(
  questions: readonly Question[],
  groups: readonly QuestionGroup[],
): boolean {
  const names = collectAnswerQuoteNames(questions);
  if (names.size === 0) return false;
  const keys = new Set<string>();
  for (const question of questions) collectAttrsKeys(question.displayCondition, keys);
  for (const group of groups) collectAttrsKeys(group.displayCondition, keys);
  for (const key of keys) if (names.has(key)) return true;
  return false;
}

/** 응답과 상관없이 정해지는 건너뛰기 사유. */
function staticSkipReason(
  questions: readonly Question[],
  groups: readonly QuestionGroup[],
  options: AnswerPathOptions,
): AnswerPathSkip | null {
  if (options.settings?.shuffleQuestions) return 'shuffle';
  if (pathConditionsReadAnswerQuotes(questions, groups)) return 'answer-quote-condition';
  return null;
}

/** 페이지가 걸음에 들었는가 — 걸은 페이지는 표시 문항이 하나 이상이라 반드시 흔적을 남긴다. */
function isStepTraversed(step: RenderStep, traversed: ReadonlySet<string>): boolean {
  return step.items.some((item) => traversed.has(item.question.id));
}

/** 질문 답과 그 질문의 루트 사이드카 항목을 뺀다. 지울 것이 없으면 입력 참조. */
function dropQuestionAnswers(
  responses: Record<string, unknown>,
  ids: ReadonlySet<string>,
): Record<string, unknown> {
  if (ids.size === 0) return responses;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(responses)) {
    if (PERSISTED_ROOT_SIDECAR_KEYS.includes(key)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const entries = Object.entries(value as Record<string, unknown>);
        const kept = entries.filter(([questionId]) => !ids.has(questionId));
        if (kept.length !== entries.length) {
          next[key] = Object.fromEntries(kept);
          changed = true;
          continue;
        }
      }
      next[key] = value;
      continue;
    }
    if (ids.has(key)) {
      changed = true;
      continue;
    }
    next[key] = value;
  }
  return changed ? next : responses;
}

/**
 * 숨은 문항과 경로 밖 문항의 답을 지운다 — 응답 확정·Raw 내보내기 공용.
 *
 * 순서는 **숨은 문항 strip → 경로 밖 strip** 이고, 둘을 번갈아 고정점까지 돌린다. 경로 밖 답을
 * 지우면 그 값을 조건으로 쓰던 문항이 숨거나 분기가 바뀌어 경로가 다시 바뀔 수 있다. 매 바퀴가
 * 지우기만 하므로(되살리지 않는다) 바퀴 수는 문항 수를 넘지 않는다.
 *
 * `evalCtx` 의 명단 값·LUT 은 그대로 쓰고 응답 뷰만 바퀴마다 지운 상태로 다시 만든다
 * (숨은 문항 strip 과 같은 규칙). 원본은 변형하지 않는다.
 */
export function stripUnreachedQuestionValues(
  questions: Question[],
  responses: Record<string, unknown>,
  groups: QuestionGroup[] | undefined,
  evalCtx: BranchEvalCtx | undefined,
  options: AnswerPathOptions = {},
): ReachedAnswers {
  const groupList = groups ?? [];
  const ctxFor = (view: Record<string, unknown>): BranchEvalCtx | undefined =>
    evalCtx && view !== responses
      ? { ...evalCtx, responses: responsesToLookupShape(view) }
      : evalCtx;

  let current = stripHiddenQuestionValues(questions, responses, groups, ctxFor(responses));
  const visibleOf = (view: Record<string, unknown>) =>
    resolveVisibleQuestionIds(questions, view, groups, ctxFor(view));

  const skip = staticSkipReason(questions, groupList, options);
  if (skip) return { responses: current, reachedQuestionIds: visibleOf(current), pathSkipped: skip };

  const steps = buildRenderSteps(questions, groupList);
  const inSteps = new Set(steps.flatMap((step) => step.items.map((item) => item.question.id)));

  for (let pass = 0; pass <= questions.length; pass++) {
    const traversed = collectTraversedQuestionIds(
      steps,
      current,
      questions,
      groups,
      ctxFor(current),
    );

    // 첫 바퀴의 걸음이 응답 화면이 제출할 때 계산한 걸음과 같은 재료다 — 기록된 마지막 페이지를
    // 여기서 맞춰 본다. 다음 바퀴부터는 지운 답이 만든 경로라 비교 대상이 아니다.
    if (pass === 0 && options.lastStepId) {
      const lastStep = steps.find((step) => stepIdOf(step) === options.lastStepId);
      const reason: AnswerPathSkip | null = !lastStep
        ? 'last-step-unknown'
        : isStepTraversed(lastStep, traversed)
          ? null
          : 'last-step-off-path';
      if (reason) {
        return { responses: current, reachedQuestionIds: visibleOf(current), pathSkipped: reason };
      }
    }

    const offPath = new Set<string>();
    for (const id of inSteps) if (!traversed.has(id)) offPath.add(id);
    const next = dropQuestionAnswers(current, offPath);
    if (next === current) {
      return { responses: current, reachedQuestionIds: traversed, pathSkipped: null };
    }
    current = stripHiddenQuestionValues(questions, next, groups, ctxFor(next));
  }
  // 도달 불가 — 바퀴마다 문항이 하나 이상 지워지므로 문항 수 안에 수렴한다. 방어적으로 마지막 상태.
  const traversed = collectTraversedQuestionIds(steps, current, questions, groups, ctxFor(current));
  return { responses: current, reachedQuestionIds: traversed, pathSkipped: null };
}
