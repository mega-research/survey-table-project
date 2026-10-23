import type { Question, QuestionGroup } from '@/types/survey';
import type { BranchEvalCtx } from '@/utils/branch-eval';
import { collectTraversedQuestionIds } from '@/utils/branch-logic';
import { buildRenderSteps, stepIdOf, type RenderStep } from '@/utils/group-ordering';

import { type EvalCtxSource, evalCtxForView } from './answer-eval-ctx';
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
 * 조건 평가 컨텍스트는 응답 화면과 같아야 경로가 같다 — 화면은 명단 값 위에 응답 인용값을 얹어
 * 조건을 푼다. 호출부(응답 확정·Raw 내보내기)는 `createAnswerEvalCtx` 로 뷰마다 인용값을 다시
 * 계산하는 출처를 넘긴다.
 *
 * 답할 수 있는 범위(`answerable-scope`)가 부르는 한 단계다 — 응답 확정과 Raw 내보내기는 그 module 을 쓴다.
 * 응답 화면은 즉시 지우지 않고, 초안·구간 저장에도 걸지 않는다 — 부분 패치라 경로를 정하는 상류
 * 답이 없어 멀쩡한 답을 지운다(주의사항 14). server-only 의존 금지.
 */

/** 경로 밖 strip 을 건너뛴 사유. */
export type AnswerPathSkip =
  /** 문항 섞기 — 응답자마다 순서가 달라질 수 있는 설정. 지금은 응답 화면이 섞지 않지만 켜진 설문은 믿지 않는다. */
  | 'shuffle'
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
   * 범위 안 문항 — 표시되고, 경로를 확정했으면 경로 위인 문항(「답할 수 있는 범위」). 계산 칸을 새로 채울 대상이다.
   * 어느 페이지에도 들지 않는 문항은 응답 화면에 그려지지 않으므로 넣지 않는다.
   */
  inScopeQuestionIds: Set<string>;
  /** 경로 밖 strip 을 건너뛴 사유. null 이면 경로를 확정해 적용했다. */
  pathSkipped: AnswerPathSkip | null;
}

/** 응답과 상관없이 정해지는 건너뛰기 사유. */
function staticSkipReason(options: AnswerPathOptions): AnswerPathSkip | null {
  if (options.settings?.shuffleQuestions) return 'shuffle';
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
 * 평가 컨텍스트는 바퀴마다 지운 상태로 다시 만든다 — 고정 컨텍스트는 응답 뷰만, 뷰마다 만드는
 * 함수(`createAnswerEvalCtx`)는 인용값까지(숨은 문항 strip 과 같은 규칙). 원본은 변형하지 않는다.
 */
export function stripUnreachedQuestionValues(
  questions: Question[],
  responses: Record<string, unknown>,
  groups: QuestionGroup[] | undefined,
  evalCtx: EvalCtxSource | undefined,
  options: AnswerPathOptions = {},
): ReachedAnswers {
  const groupList = groups ?? [];
  const ctxFor = (view: Record<string, unknown>): BranchEvalCtx | undefined =>
    evalCtxForView(evalCtx, view, responses);
  // 숨은 문항 strip 에는 뷰마다 만드는 출처를 그대로 넘긴다 — 지운 결과로 인용값을 다시 계산하는
  // 수렴을 그쪽이 돈다.
  const stripHidden = (view: Record<string, unknown>) =>
    stripHiddenQuestionValues(
      questions,
      view,
      groups,
      typeof evalCtx === 'function' ? evalCtx : ctxFor(view),
    );

  let current = stripHidden(responses);
  const visibleOf = (view: Record<string, unknown>) =>
    resolveVisibleQuestionIds(questions, view, groups, ctxFor(view));

  const skip = staticSkipReason(options);
  if (skip) return { responses: current, inScopeQuestionIds: visibleOf(current), pathSkipped: skip };

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
        return { responses: current, inScopeQuestionIds: visibleOf(current), pathSkipped: reason };
      }
    }

    const offPath = new Set<string>();
    for (const id of inSteps) if (!traversed.has(id)) offPath.add(id);
    const next = dropQuestionAnswers(current, offPath);
    if (next === current) {
      return { responses: current, inScopeQuestionIds: traversed, pathSkipped: null };
    }
    current = stripHidden(next);
  }
  // 도달 불가 — 바퀴마다 문항이 하나 이상 지워지므로 문항 수 안에 수렴한다. 방어적으로 마지막 상태.
  const traversed = collectTraversedQuestionIds(steps, current, questions, groups, ctxFor(current));
  return { responses: current, inScopeQuestionIds: traversed, pathSkipped: null };
}
