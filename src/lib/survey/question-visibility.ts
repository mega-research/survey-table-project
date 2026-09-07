import type { Question, QuestionConditionGroup, QuestionGroup } from '@/types/survey';
import type { BranchEvalCtx } from '@/utils/branch-eval';
import { shouldDisplayQuestion } from '@/utils/branch-logic';

import { PERSISTED_ROOT_SIDECAR_KEYS } from './response-sidecars';

/**
 * 표시 조건으로 숨겨진 문항의 응답 처리 (스펙: 2026-09-07 숨은 문항 응답 삭제).
 *
 * 응답 페이지·서버 저장 경계가 **같은 판정**을 쓴다 — 판정이 갈리면 "화면에선 안 보이는데
 * 서버는 값이 있다고 함" 이 생긴다 (cell-gating 과 같은 규약). server-only 의존 금지.
 */

/** 조건 그룹이 참조하는 문항 id 들. */
function sourceIdsOf(condition: QuestionConditionGroup | undefined): string[] {
  if (!condition || !Array.isArray(condition.conditions)) return [];
  return condition.conditions
    .filter((c) => c.enabled !== false)
    .map((c) => c.sourceQuestionId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * `참조되는 문항 id → 그 문항이 숨으면 다시 평가해야 할 문항 id 들` 역인덱스.
 *
 * 그룹 조건도 그래프에 넣는다 — 그룹이 숨으면 소속 문항이 전부 숨으므로, 그룹 조건이
 * 참조하는 문항의 의존자는 그 그룹의 **모든 멤버**다.
 */
function buildDependents(
  questions: readonly Question[],
  groups: readonly QuestionGroup[] | undefined,
): Map<string, Set<string>> {
  const dependents = new Map<string, Set<string>>();
  const add = (sourceId: string, dependentId: string) => {
    const set = dependents.get(sourceId) ?? new Set<string>();
    set.add(dependentId);
    dependents.set(sourceId, set);
  };

  for (const question of questions) {
    for (const sourceId of sourceIdsOf(question.displayCondition)) add(sourceId, question.id);
  }
  for (const group of groups ?? []) {
    const sourceIds = sourceIdsOf(group.displayCondition);
    if (sourceIds.length === 0) continue;
    const members = questions.filter((question) => question.groupId === group.id);
    for (const sourceId of sourceIds) for (const member of members) add(sourceId, member.id);
  }
  return dependents;
}

/** 조건을 하나라도 타는 문항 — 처음 평가 대상. 조건이 없는 문항은 영원히 표시다. */
function conditionedQuestionIds(
  questions: readonly Question[],
  groups: readonly QuestionGroup[] | undefined,
): string[] {
  const groupHasCondition = new Set(
    (groups ?? []).filter((group) => group.displayCondition).map((group) => group.id),
  );
  return questions
    .filter((q) => q.displayCondition || (q.groupId && groupHasCondition.has(q.groupId)))
    .map((q) => q.id);
}

/** 사이드카를 뺀 문항 응답만 남긴 뷰 — 조건 평가에 넘길 재료. */
function withoutHidden(
  responses: Record<string, unknown>,
  hidden: ReadonlySet<string>,
): Record<string, unknown> {
  if (hidden.size === 0) return responses;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(responses)) {
    if (hidden.has(key)) continue;
    next[key] = value;
  }
  return next;
}

/**
 * 표시되는 문항 id 집합. 삭제 연쇄를 고정점까지 수렴시킨다.
 *
 * "전부 표시" 에서 시작해 숨김만 늘린다 — 숨김이 단조 증가라야 종료가 보장된다. 반대
 * 방향(전부 숨김에서 늘려가기)은 순환 조건에서 진동한다. 각 문항은 표시→숨김으로 많아야
 * 한 번 뒤집히므로 큐는 반드시 빈다 (stripDisabledCellValues 의 게이팅 체인 수렴과 같은 논거).
 */
export function resolveVisibleQuestionIds(
  questions: Question[],
  responses: Record<string, unknown>,
  groups?: QuestionGroup[],
  evalCtx?: BranchEvalCtx,
): Set<string> {
  const visible = new Set(questions.map((q) => q.id));
  const byId = new Map(questions.map((q) => [q.id, q]));
  const dependents = buildDependents(questions, groups);
  const hidden = new Set<string>();

  const queue = conditionedQuestionIds(questions, groups);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (hidden.has(id)) continue;
    const question = byId.get(id);
    if (!question) continue;
    const view = withoutHidden(responses, hidden);
    if (shouldDisplayQuestion(question, view, questions, groups, evalCtx)) continue;
    hidden.add(id);
    visible.delete(id);
    for (const dependentId of dependents.get(id) ?? []) {
      if (!hidden.has(dependentId)) queue.push(dependentId);
    }
  }
  return visible;
}

/** 사이드카 하나에서 숨은 문항 항목을 뺀다. 뺄 것이 없으면 null. */
function stripSidecar(raw: unknown, visible: ReadonlySet<string>): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  const kept = entries.filter(([questionId]) => visible.has(questionId));
  if (kept.length === entries.length) return null;
  return Object.fromEntries(kept);
}

/**
 * 숨은 문항의 답과 사이드카 항목을 제거한 응답. 원본은 변형하지 않는다.
 * 지울 것이 없으면 입력 참조를 그대로 돌려준다 — 호출부의 메모 의존을 흔들지 않는다.
 */
export function stripHiddenQuestionValues(
  questions: Question[],
  responses: Record<string, unknown>,
  groups?: QuestionGroup[],
  evalCtx?: BranchEvalCtx,
): Record<string, unknown> {
  const visible = resolveVisibleQuestionIds(questions, responses, groups, evalCtx);
  const known = new Set(questions.map((q) => q.id));

  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(responses)) {
    if (PERSISTED_ROOT_SIDECAR_KEYS.includes(key)) {
      const stripped = stripSidecar(value, visible);
      if (stripped === null) next[key] = value;
      else {
        next[key] = stripped;
        changed = true;
      }
      continue;
    }
    // 설문에 없는 키(구버전 잔재 등)는 이 모듈의 소관이 아니다 — 그대로 둔다.
    if (known.has(key) && !visible.has(key)) {
      changed = true;
      continue;
    }
    next[key] = value;
  }
  return changed ? next : responses;
}
