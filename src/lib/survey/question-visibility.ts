import type {
  Question,
  QuestionCondition,
  QuestionConditionGroup,
  QuestionGroup,
} from '@/types/survey';
import { OPT_TEXTS_KEY } from '@/lib/option-text-read';
import type { BranchEvalCtx } from '@/utils/branch-eval';
import { shouldDisplayQuestion } from '@/utils/branch-logic';

import { type EvalCtxSource, evalCtxForView } from './answer-eval-ctx';
import { PERSISTED_ROOT_SIDECAR_KEYS } from './response-sidecars';
import { dropHiddenTableSelections, resolveTableCellVisibility } from './table-cell-visibility';

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
 * 표시되는 문항 id 집합. 삭제 연쇄를 고정점까지 수렴시킨다.
 *
 * "전부 표시" 에서 시작해 숨김만 늘린다 — 숨김이 단조 증가라야 종료가 보장된다. 반대
 * 방향(전부 숨김에서 늘려가기)은 순환 조건에서 진동한다. 각 문항은 표시→숨김으로 많아야
 * 한 번 뒤집히므로 큐는 반드시 빈다 (stripDisabledCellValues 의 게이팅 체인 수렴과 같은 논거).
 *
 * 평가 컨텍스트의 응답 뷰는 숨김이 늘 때마다 지워진 상태 기준으로 다시 만든다. `table-cell-check`
 * 의 숫자 비교가 다른 문항의 셀을 가리키면 그 값은 응답 본문이 아니라 `ctx.responses` 에서
 * 풀린다(`branch-eval` 의 `kind: 'cell'` operand) — strip 전에 만든 뷰를 그대로 쓰면 이미 지워진
 * 문항의 셀 값으로 하류 조건이 만족해 한 단계 덜 지워진다. 지운 것이 없으면 원본 ctx 그대로다.
 *
 * 뷰마다 컨텍스트를 만드는 출처(`EvalCtxSource` 함수)는 받은 응답으로 한 번 만들어 고정한다 —
 * 응답 화면이 한 번 그릴 때와 같다(인용값은 그 렌더의 응답으로 계산하고 숨김 연쇄 동안 고정).
 * 지운 결과로 인용값을 다시 계산하는 수렴은 `stripHiddenQuestionValues` 가 돈다.
 */
export function resolveVisibleQuestionIds(
  questions: Question[],
  responses: Record<string, unknown>,
  groups?: QuestionGroup[],
  evalCtx?: EvalCtxSource,
): Set<string> {
  const visible = new Set(questions.map((q) => q.id));
  const byId = new Map(questions.map((q) => [q.id, q]));
  const ancestryOf = buildGroupAncestry(groups);
  const dependents = buildDependents(questions, groups, ancestryOf);
  const hidden = new Set<string>();
  const baseCtx = evalCtxForView(evalCtx, responses, responses);
  let view = responses;
  let ctx = baseCtx;

  const queue = conditionedQuestionIds(questions, groups, ancestryOf);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (hidden.has(id)) continue;
    const question = byId.get(id);
    if (!question) continue;
    if (shouldDisplayQuestion(question, view, questions, groups, ctx)) continue;
    hidden.add(id);
    visible.delete(id);
    view = withoutHidden(responses, hidden);
    ctx = evalCtxForView(baseCtx, view);
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

/** 숨은 문항의 답과 사이드카 항목을 뺀 응답 — 한 번. 지울 것이 없으면 입력 참조. */
function stripHiddenQuestionsOnce(
  questions: Question[],
  responses: Record<string, unknown>,
  groups: QuestionGroup[] | undefined,
  evalCtx: BranchEvalCtx | undefined,
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

/**
 * 표시되는 문항 중 **보기를 표로 그리는 문항**(표 문항·보기 소스 radio/checkbox)에서 지금 숨은 칸 —
 * 행 표시조건·열 표시조건·고르지 않은 동적 행 — 의 답을 뺀다. 셀 값, 보기 선택(보기 소스 표의 문항 값,
 * 보기 그룹 선택), 기타 상세기재·표 안 입력칸 사이드카. 숨은 문항과 같은 규칙이다: 숨는 순간 지우고,
 * 되돌려도 살아나지 않는다.
 *
 * 판정은 렌더러·차단 검증과 같은 `resolveTableCellVisibility` 다 — 숨은 행에서 시작한 세로 병합 칸처럼
 * 렌더러가 보이는 행에 올려 그리는 칸은 보이는 칸이라 지우지 않는다. 표 응답 안 `__selectedRowIds`
 * 같은 다른 예약 키는 건드리지 않는다. 동적 행 선택 해제도 여기서 값이 지워진다 — 선택을 풀면
 * 행이 숨고, 숨은 행의 답은 남기지 않는다. 지울 것이 없으면 입력 참조를 그대로 돌려준다.
 */
function stripHiddenTableCellValues(
  questions: Question[],
  responses: Record<string, unknown>,
  evalCtx: BranchEvalCtx | undefined,
): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  const ctx = evalCtxForView(evalCtx, responses);
  for (const question of questions) {
    const visibility = resolveTableCellVisibility(question, responses, questions, ctx);
    if (!visibility || visibility.hiddenCellIds.size === 0) continue;
    const { hiddenCellIds } = visibility;

    if (Object.hasOwn(responses, question.id)) {
      const value = responses[question.id];
      const next = dropHiddenTableSelections(question, value, hiddenCellIds);
      if (next !== value) {
        out ??= { ...responses };
        if (next === undefined) delete out[question.id];
        else out[question.id] = next;
      }
    }

    // 기타 상세기재·표 안 입력칸은 루트 사이드카 `__optTexts__[문항 id][셀 id]` 에 있다. 누적 결과에서
    // 이어 써야 앞 표에서 지운 항목이 이 표를 처리하며 되살아나지 않는다.
    const sidecar = (out ?? responses)[OPT_TEXTS_KEY];
    if (sidecar && typeof sidecar === 'object' && !Array.isArray(sidecar)) {
      const texts = (sidecar as Record<string, unknown>)[question.id];
      if (texts && typeof texts === 'object' && !Array.isArray(texts)) {
        const entries = Object.entries(texts as Record<string, unknown>);
        const kept = entries.filter(([cellId]) => !hiddenCellIds.has(cellId));
        if (kept.length !== entries.length) {
          out ??= { ...responses };
          out[OPT_TEXTS_KEY] = {
            ...(sidecar as Record<string, unknown>),
            [question.id]: Object.fromEntries(kept),
          };
        }
      }
    }
  }
  return out ?? responses;
}

/**
 * 숨은 문항의 답과 사이드카 항목, 그리고 표시되는 표의 숨은 칸(행·열 조건, 고르지 않은 동적 행) 답을
 * 제거한 응답.
 * 원본은 변형하지 않는다. 지울 것이 없으면 입력 참조를 그대로 돌려준다 — 호출부의 메모
 * 의존을 흔들지 않는다.
 *
 * 문항 숨김과 칸 숨김은 서로를 부른다 — 숨은 칸의 값을 조건으로 쓰던 문항이 숨고, 숨은 문항을
 * 조건으로 쓰던 행·열이 숨는다. 둘을 번갈아 돌려 더 지울 것이 없을 때까지 수렴시킨다. 매 바퀴가
 * 값을 지우기만 하므로(되살리지 않는다) 바퀴 수는 문항 수 + 행 수 + 열 수를 넘지 않는다.
 *
 * `evalCtx` 가 고정 컨텍스트면 응답 화면이 한 번 그릴 때처럼 명단 값·인용값을 그대로 둔다(화면은
 * 지운 뒤 다시 그릴 때 인용값을 다시 계산한다). 뷰마다 컨텍스트를 만드는 함수(응답 확정·Raw
 * 내보내기의 `createAnswerEvalCtx`)면 그 다시 그리기까지 여기서 수렴시킨다.
 */
export function stripHiddenQuestionValues(
  questions: Question[],
  responses: Record<string, unknown>,
  groups?: QuestionGroup[],
  evalCtx?: EvalCtxSource,
): Record<string, unknown> {
  const maxPasses =
    questions.length +
    questions.reduce(
      (n, q) => n + (q.tableRowsData?.length ?? 0) + (q.tableColumns?.length ?? 0),
      0,
    ) +
    1;
  if (typeof evalCtx !== 'function') {
    return stripHiddenWithCtx(questions, responses, groups, evalCtx, maxPasses);
  }
  // 뷰마다 컨텍스트를 만드는 출처(응답 인용값) — 응답 화면은 숨은 값을 지운 뒤 다시 그리며 인용값을
  // 지금 응답으로 다시 계산하고, 바뀐 인용값으로 조건을 다시 풀어 또 지운다. 같은 수렴을 여기서
  // 돈다: 지금 응답으로 만든 컨텍스트로 지우고, 더 지울 것이 없을 때까지. 문항 연쇄(역인덱스)는
  // 인용 이름으로 이어진 의존을 모르므로 바퀴를 다시 돌려야 잡힌다. 바퀴마다 아직 값이 남은 문항·
  // 행·열을 하나 이상 지우므로 아래 상한 안에 수렴한다.
  let current = responses;
  for (let pass = 0; pass < maxPasses; pass++) {
    const next = stripHiddenWithCtx(questions, current, groups, evalCtx(current), maxPasses);
    if (next === current) break;
    current = next;
  }
  return current;
}

/** 고정 컨텍스트로 숨은 문항·칸을 고정점까지 지운다 — 응답 뷰만 바퀴마다 다시 만든다. */
function stripHiddenWithCtx(
  questions: Question[],
  responses: Record<string, unknown>,
  groups: QuestionGroup[] | undefined,
  evalCtx: BranchEvalCtx | undefined,
  maxPasses: number,
): Record<string, unknown> {
  let current = responses;
  for (let pass = 0; pass < maxPasses; pass++) {
    // 행 값을 지운 뒤 바퀴는 평가 컨텍스트의 응답 뷰도 지운 상태로 다시 만든다 — 숫자 비교
    // operand 가 다른 표의 셀을 ctx.responses 에서 읽는다(resolveVisibleQuestionIds 주석과 같은 이유).
    const ctx = evalCtxForView(evalCtx, current, responses);
    const afterQuestions = stripHiddenQuestionsOnce(questions, current, groups, ctx);
    const afterRows = stripHiddenTableCellValues(questions, afterQuestions, evalCtx);
    const settled = afterRows === afterQuestions;
    current = afterRows;
    if (settled) break;
  }
  return current;
}
