import type { BranchRule, Question, QuestionGroup } from '@/types/survey';

// ── 타입 ──

export type GroupChildItem =
  | { kind: 'question'; data: Question }
  | { kind: 'subgroup'; data: QuestionGroup };

// ── DnD ID 유틸리티 ──

const GROUP_DND_PREFIX = 'group::';

export function toGroupDndId(groupId: string): string {
  return `${GROUP_DND_PREFIX}${groupId}`;
}

export function isGroupDndId(id: string): boolean {
  return id.startsWith(GROUP_DND_PREFIX);
}

export function extractGroupId(dndId: string): string {
  return dndId.slice(GROUP_DND_PREFIX.length);
}

// ── 인터리브 정렬 ──

/**
 * 특정 그룹 내의 직접 자식(질문 + 하위그룹)을 인터리브된 순서로 반환.
 *
 * 알고리즘:
 * 1. 하위그룹을 order 값으로 위치 슬롯에 배치
 * 2. 질문을 전역 order 순으로 정렬한 뒤 남은 슬롯을 순서대로 채움
 *
 * @param groupId 부모 그룹 ID (null이면 최상위 레벨의 그룹 없는 질문)
 */
export function getInterleavedChildren(
  groupId: string | null,
  questions: Question[],
  groups: QuestionGroup[],
): GroupChildItem[] {
  // 직접 질문: 전역 order 순 정렬
  const directQuestions = questions
    .filter((q) => (groupId ? q.groupId === groupId : !q.groupId))
    .sort((a, b) => a.order - b.order);

  // 직접 하위그룹: order 순 정렬
  const directSubGroups = groupId
    ? groups.filter((g) => g.parentGroupId === groupId).sort((a, b) => a.order - b.order)
    : [];

  if (directSubGroups.length === 0) {
    return directQuestions.map((q) => ({ kind: 'question' as const, data: q }));
  }

  const totalSize = directQuestions.length + directSubGroups.length;
  const result: GroupChildItem[] = new Array(totalSize);

  // 1. 하위그룹을 order 위치에 배치 (범위 초과 시 clamp)
  const usedSlots = new Set<number>();
  for (const sg of directSubGroups) {
    const pos = Math.max(0, Math.min(sg.order, totalSize - 1));
    let slot = pos;
    while (usedSlots.has(slot) && slot < totalSize) slot++;
    if (slot >= totalSize) {
      slot = 0;
      while (usedSlots.has(slot) && slot < totalSize) slot++;
    }
    if (slot < totalSize) {
      usedSlots.add(slot);
      result[slot] = { kind: 'subgroup', data: sg };
    }
  }

  // 2. 질문을 남은 슬롯에 순서대로 채움
  let qIdx = 0;
  for (let i = 0; i < totalSize; i++) {
    if (!result[i] && qIdx < directQuestions.length) {
      const q = directQuestions[qIdx];
      if (q) {
        result[i] = { kind: 'question', data: q };
      }
      qIdx++;
    }
  }

  return result;
}

/**
 * 전체 설문의 질문을 그룹 계층 + 인터리브 순서로 평탄화.
 * 결과 배열 순서 = 올바른 전역 순서.
 *
 * 순회 순서:
 * 1. 최상위 그룹을 order 순으로 → 각 그룹의 인터리브 자식 재귀
 * 2. 그룹 없는 질문 (ungrouped)
 */
export function buildFlatOrderedQuestions(
  questions: Question[],
  groups: QuestionGroup[],
): Question[] {
  const result: Question[] = [];

  const topLevelGroups = groups
    .filter((g) => !g.parentGroupId)
    .sort((a, b) => a.order - b.order);

  // 재귀적으로 그룹의 자식을 평탄화
  const flattenGroup = (groupId: string) => {
    const children = getInterleavedChildren(groupId, questions, groups);
    for (const child of children) {
      if (child.kind === 'question') {
        result.push(child.data);
      } else {
        // 하위그룹: 하위그룹 내부의 질문을 재귀적으로 추가
        flattenGroup(child.data.id);
      }
    }
  };

  for (const group of topLevelGroups) {
    flattenGroup(group.id);
  }

  // 그룹 없는 질문
  const ungrouped = questions
    .filter((q) => !q.groupId)
    .sort((a, b) => a.order - b.order);
  result.push(...ungrouped);

  return result;
}

/**
 * 특정 DnD ID(질문 ID 또는 group::그룹ID)의 부모 그룹 ID를 찾는다.
 */
export function findParentGroupId(
  dndId: string,
  questions: Question[],
  groups: QuestionGroup[],
): string | null {
  if (isGroupDndId(dndId)) {
    const groupId = extractGroupId(dndId);
    const group = groups.find((g) => g.id === groupId);
    return group?.parentGroupId ?? null;
  }
  // 질문인 경우
  const question = questions.find((q) => q.id === dndId);
  return question?.groupId ?? null;
}

// ── 응답 페이지 렌더 스텝 구성 ──

export type StepItem = {
  question: Question;
  // 이 질문의 바로 위에 새 하위그룹이 시작되면 그 이름 (소제목 표시용)
  subgroupName: string | null;
};

export type RenderStep =
  | {
      kind: 'group';
      rootGroupId: string | null;
      rootGroupName: string | null;
      items: StepItem[];
    }
  | {
      kind: 'table';
      rootGroupId: string | null;
      rootGroupName: string | null;
      subgroupName: string | null;
      question: Question;
    };

/**
 * 운영 현황 콘솔용 step 고유 식별자 (응답 페이지 진행 위치 = `survey_responses.current_step_id`).
 * - table step: 'table:<questionId>'
 * - group step: 'group:<rootGroupId | "root">' (ungrouped는 'root')
 *
 * 동일 RenderStep에 대해 항상 같은 문자열을 반환해야 recordStepVisit의
 * 멱등성(no-op when currentStepId === nextStepId)이 유지되고, 운영 콘솔의
 * 진행 위치 역매핑(buildStepLocationMap)이 정확히 맞물린다.
 */
export function stepIdOf(step: RenderStep): string {
  if (step.kind === 'table') {
    return `table:${step.question.id}`;
  }
  return `group:${step.rootGroupId ?? 'root'}`;
}

/**
 * 최상위 그룹(또는 ungrouped)의 질문들을 인터리브 순서로 flatten하고,
 * 각 질문에 "이 질문부터 시작되는 하위그룹 이름"을 부여한다.
 */
function flattenRootScope(
  rootGroupId: string | null,
  questions: Question[],
  groups: QuestionGroup[],
): StepItem[] {
  const result: StepItem[] = [];

  const walk = (groupId: string | null, pendingSubgroupName: string | null) => {
    const children = getInterleavedChildren(groupId, questions, groups);
    let subName = pendingSubgroupName;
    for (const child of children) {
      if (child.kind === 'question') {
        result.push({ question: child.data, subgroupName: subName });
        subName = null;
      } else {
        // hideName 그룹은 응답 페이지에서 소제목을 노출하지 않는다.
        walk(child.data.id, child.data.hideName ? null : child.data.name);
        subName = null;
      }
    }
  };

  if (rootGroupId === null) {
    // ungrouped: 그룹 없는 질문만 order 순
    const ungrouped = questions
      .filter((q) => !q.groupId)
      .sort((a, b) => a.order - b.order);
    for (const q of ungrouped) {
      result.push({ question: q, subgroupName: null });
    }
  } else {
    walk(rootGroupId, null);
  }

  return result;
}

/**
 * flatten된 StepItem 목록을 "연속 비테이블 구간" + "테이블 단독"으로 분할한다.
 */
function splitByTable(
  items: StepItem[],
  rootGroupId: string | null,
  rootGroupName: string | null,
): RenderStep[] {
  const steps: RenderStep[] = [];
  let buffer: StepItem[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    steps.push({
      kind: 'group',
      rootGroupId,
      rootGroupName,
      items: buffer,
    });
    buffer = [];
  };

  for (const item of items) {
    if (item.question.type === 'table') {
      flushBuffer();
      steps.push({
        kind: 'table',
        rootGroupId,
        rootGroupName,
        subgroupName: item.subgroupName,
        question: item.question,
      });
    } else {
      buffer.push(item);
    }
  }
  flushBuffer();

  return steps;
}

/**
 * 전체 설문을 "상위그룹 단위 + 테이블 분리" 렌더 스텝 배열로 변환한다.
 *
 * 규칙:
 * 1. 최상위(root) 그룹을 order 순으로 순회
 * 2. 각 최상위 그룹의 질문을 인터리브 순서로 flatten (하위그룹 경계는 무시하되, 각
 *    하위그룹의 첫 질문에 subgroupName을 기록하여 소제목으로 쓸 수 있게 한다)
 * 3. 연속된 비테이블 질문은 하나의 group step, 테이블 질문은 각각 단독 table step
 * 4. 그룹 없는 질문(ungrouped)도 동일 규칙 적용하여 마지막에 추가
 */
export function buildRenderSteps(
  questions: Question[],
  groups: QuestionGroup[],
): RenderStep[] {
  const steps: RenderStep[] = [];

  const topLevelGroups = groups
    .filter((g) => !g.parentGroupId)
    .sort((a, b) => a.order - b.order);

  for (const rootGroup of topLevelGroups) {
    const items = flattenRootScope(rootGroup.id, questions, groups);
    if (items.length === 0) continue;
    // hideName 그룹은 응답 페이지에서 그룹 이름 배지를 노출하지 않는다 (빌더 표시는 유지).
    const rootGroupName = rootGroup.hideName ? null : rootGroup.name;
    steps.push(...splitByTable(items, rootGroup.id, rootGroupName));
  }

  const ungroupedItems = flattenRootScope(null, questions, groups);
  if (ungroupedItems.length > 0) {
    steps.push(...splitByTable(ungroupedItems, null, null));
  }

  return steps;
}

// ── 스텝 단위 분기(branch) 해석 ──

/**
 * 주어진 질문 id 가 속한 렌더 스텝의 인덱스를 반환한다. 없으면 -1.
 */
export function findStepIndexOfQuestion(steps: RenderStep[], questionId: string): number {
  return steps.findIndex((s) =>
    s.kind === 'table'
      ? s.question.id === questionId
      : s.items.some((it) => it.question.id === questionId),
  );
}

export type StepBranchOutcome =
  | { kind: 'end' }
  | { kind: 'goto'; stepIndex: number }
  | { kind: 'fallthrough' };

/**
 * 현재 스텝의 (표시되는 질문 순서대로 정렬된) 분기 규칙 목록을 평가해
 * 다음 스텝 이동 방식을 결정한다.
 *
 * - `end` 규칙이 가장 먼저 만나지면 즉시 종료.
 * - `goto` 규칙은 **타깃이 현재 스텝보다 뒤(전진)일 때만** 점프로 인정한다.
 *   타깃이 같은 스텝(=같은 페이지)이거나 이전 스텝이면 페이지 이동의 의미가 없다.
 *   같은 페이지 내 질문 노출은 displayCondition 으로 처리되므로, 비-전진 goto 는
 *   무시하고 다음 표시 스텝으로 진행한다 (제자리 no-op 트랩 방지).
 * - 적용할 규칙이 없으면 `fallthrough` — 호출부가 다음 표시 스텝을 찾는다.
 */
export function resolveStepBranch(
  steps: RenderStep[],
  currentStepIndex: number,
  rules: Array<BranchRule | null | undefined>,
): StepBranchOutcome {
  for (const rule of rules) {
    if (!rule) continue;
    if (rule.action === 'end') return { kind: 'end' };
    if (rule.action === 'goto' && rule.targetQuestionId) {
      const targetIdx = findStepIndexOfQuestion(steps, rule.targetQuestionId);
      if (targetIdx > currentStepIndex) return { kind: 'goto', stepIndex: targetIdx };
    }
  }
  return { kind: 'fallthrough' };
}
