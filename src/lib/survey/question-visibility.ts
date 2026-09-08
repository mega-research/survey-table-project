import type {
  Question,
  QuestionCondition,
  QuestionConditionGroup,
  QuestionGroup,
} from '@/types/survey';
import { type BranchEvalCtx, responsesToLookupShape } from '@/utils/branch-eval';
import { shouldDisplayQuestion } from '@/utils/branch-logic';

import { PERSISTED_ROOT_SIDECAR_KEYS } from './response-sidecars';

/**
 * 표시 조건으로 숨겨진 문항의 응답 처리 (스펙: 2026-09-07 숨은 문항 응답 삭제).
 *
 * 응답 페이지·서버 저장 경계가 **같은 판정**을 쓴다 — 판정이 갈리면 "화면에선 안 보이는데
 * 서버는 값이 있다고 함" 이 생긴다 (cell-gating 과 같은 규약). server-only 의존 금지.
 */

/** 조건 그룹이 참조하는 문항 id 들. */
/**
 * operand 안에 박힌 문항 참조를 모은다.
 *
 * `sourceQuestionId` 는 조건이 스캔할 표를 가리킬 뿐이고, 비교의 좌·우변은 **다른 문항의
 * 셀**을 가리킬 수 있다 (`kind: 'cell'`·`kind: 'question'`, 그리고 그 둘을 감싼 `binop`).
 * 이것을 놓치면 그 문항이 숨어도 의존자가 재평가 큐에 오르지 않아 삭제 연쇄가 한 단계에서
 * 멈춘다. 형태가 깨진 JSONB 는 조용히 건너뛴다 — 여기서 던지면 표시 판정이 통째로 죽는다.
 */
function collectOperandQuestionIds(operand: unknown, out: Set<string>): void {
  if (!operand || typeof operand !== 'object') return;
  const node = operand as Record<string, unknown>;
  if (typeof node['questionId'] === 'string' && node['questionId'].length > 0) {
    out.add(node['questionId']);
  }
  collectOperandQuestionIds(node['left'], out);
  collectOperandQuestionIds(node['right'], out);
}

/** 조건 하나가 실제로 읽는 문항 id 전부 — 스캔 대상 표 + operand 안의 셀·문항 참조. */
function questionIdsReadBy(condition: QuestionCondition, out: Set<string>): void {
  if (typeof condition.sourceQuestionId === 'string' && condition.sourceQuestionId.length > 0) {
    out.add(condition.sourceQuestionId);
  }
  collectOperandQuestionIds(condition.tableConditions?.numericComparison, out);
  collectOperandQuestionIds(condition.additionalConditions?.numericComparison, out);
  for (const clause of condition.expressionConfig?.clauses ?? []) {
    if (clause.kind === 'comparison') {
      collectOperandQuestionIds(clause.comparison?.left, out);
      collectOperandQuestionIds(clause.comparison?.right, out);
    }
  }
}

function sourceIdsOf(condition: QuestionConditionGroup | undefined): string[] {
  if (!condition || !Array.isArray(condition.conditions)) return [];
  const out = new Set<string>();
  for (const c of condition.conditions) {
    if (c.enabled === false) continue;
    questionIdsReadBy(c, out);
  }
  return [...out];
}

/**
 * `문항의 소속 그룹 → 그 조상 그룹들` 사슬 해석기.
 *
 * question_groups 는 parentGroupId 로 자기 참조하고 `shouldDisplayGroup` 은 그 사슬을
 * 재귀로 타고 올라간다 — 상위 그룹이 숨으면 하위 그룹 문항도 숨는다. 직접 소속만 보면
 * 중첩 그룹 안의 문항이 큐에도 역인덱스에도 오르지 않아 영영 지워지지 않는다.
 *
 * 사슬은 자기 자신부터 담고, 손상된 데이터의 순환 참조는 방문 집합으로 끊는다.
 */
function buildGroupAncestry(
  groups: readonly QuestionGroup[] | undefined,
): (groupId: string | null | undefined) => readonly string[] {
  const parentOf = new Map((groups ?? []).map((group) => [group.id, group.parentGroupId ?? null]));
  const cache = new Map<string, readonly string[]>();
  return (groupId) => {
    if (!groupId) return [];
    const cached = cache.get(groupId);
    if (cached) return cached;
    const chain: string[] = [];
    const seen = new Set<string>();
    let cursor: string | null | undefined = groupId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      chain.push(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
    cache.set(groupId, chain);
    return chain;
  };
}

/**
 * `참조되는 문항 id → 그 문항이 숨으면 다시 평가해야 할 문항 id 들` 역인덱스.
 *
 * 그룹 조건도 그래프에 넣는다 — 그룹이 숨으면 소속 문항이 전부 숨으므로, 그룹 조건이
 * 참조하는 문항의 의존자는 그 그룹의 **모든 멤버**다. 멤버는 직접 소속뿐 아니라 하위
 * 그룹 소속까지 포함한다(위 buildGroupAncestry 주석).
 */
function buildDependents(
  questions: readonly Question[],
  groups: readonly QuestionGroup[] | undefined,
  ancestryOf: (groupId: string | null | undefined) => readonly string[],
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
    const members = questions.filter((question) =>
      ancestryOf(question.groupId).includes(group.id),
    );
    for (const sourceId of sourceIds) for (const member of members) add(sourceId, member.id);
  }
  return dependents;
}

/** 조건을 하나라도 타는 문항 — 처음 평가 대상. 조건이 없는 문항은 영원히 표시다. */
function conditionedQuestionIds(
  questions: readonly Question[],
  groups: readonly QuestionGroup[] | undefined,
  ancestryOf: (groupId: string | null | undefined) => readonly string[],
): string[] {
  const groupHasCondition = new Set(
    (groups ?? []).filter((group) => group.displayCondition).map((group) => group.id),
  );
  return questions
    .filter(
      (q) =>
        q.displayCondition ||
        ancestryOf(q.groupId).some((groupId) => groupHasCondition.has(groupId)),
    )
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
 * 평가 컨텍스트의 응답 뷰를 지워진 상태 기준으로 다시 만든다.
 *
 * `table-cell-check` 의 숫자 비교가 다른 문항의 셀을 가리키면 그 값은 응답 본문이 아니라
 * `ctx.responses` 에서 풀린다 (`branch-eval` 의 `kind: 'cell'` operand). 호출부가 strip 전에
 * 만든 뷰를 그대로 쓰면, 이미 지워진 문항의 셀 값으로 하류 조건이 만족해 한 단계 덜 지워진다.
 * 반복마다 다시 만들어 본문과 컨텍스트가 같은 것을 보게 한다.
 *
 * 지운 것이 없으면 원본 ctx 를 그대로 돌려준다 — 흔한 경로에서 객체를 만들지 않는다.
 */
function maskedCtx(
  evalCtx: BranchEvalCtx | undefined,
  view: Record<string, unknown>,
  hidden: ReadonlySet<string>,
): BranchEvalCtx | undefined {
  if (!evalCtx || hidden.size === 0) return evalCtx;
  return { ...evalCtx, responses: responsesToLookupShape(view) };
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
  const ancestryOf = buildGroupAncestry(groups);
  const dependents = buildDependents(questions, groups, ancestryOf);
  const hidden = new Set<string>();

  const queue = conditionedQuestionIds(questions, groups, ancestryOf);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (hidden.has(id)) continue;
    const question = byId.get(id);
    if (!question) continue;
    const view = withoutHidden(responses, hidden);
    if (shouldDisplayQuestion(question, view, questions, groups, maskedCtx(evalCtx, view, hidden)))
      continue;
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
