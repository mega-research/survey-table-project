import type { BranchRule, GroupNameDesign, Question, QuestionGroup } from '@/types/survey';

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
  // 페이지 헤더 출처가 되는 root 그룹 컨텍스트
  rootGroupId: string | null;
  rootGroupName: string | null; // hideName 그룹이면 null
  rootGroupNameDesign?: GroupNameDesign | undefined;
  // 이 질문의 바로 위에 새 하위그룹이 시작되면 그 이름 (소제목 표시용)
  subgroupName: string | null;
};

export type RenderStep = {
  kind: 'page';
  items: StepItem[]; // 1개 이상
};

/**
 * 운영 현황 콘솔용 step 고유 식별자 (`survey_responses.current_step_id`).
 * 신모델: 'page:<페이지 첫 질문 id>'. 구조적 anchor라 분기/역매핑이 맞물린다.
 */
export function stepIdOf(step: RenderStep): string {
  return `page:${step.items[0]?.question.id ?? 'empty'}`;
}

type FlatItem = { question: Question; subgroupName: string | null };

/**
 * 최상위 그룹(또는 ungrouped)의 질문들을 인터리브 순서로 flatten하고,
 * 각 질문에 "이 질문부터 시작되는 하위그룹 이름"을 부여한다.
 */
function flattenRootScope(
  rootGroupId: string | null,
  questions: Question[],
  groups: QuestionGroup[],
): FlatItem[] {
  const result: FlatItem[] = [];

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
 * 모든 최상위 그룹(order 순) + ungrouped를 이어 하나의 선형 StepItem 목록으로 만든다.
 * 각 항목에 root 그룹 컨텍스트(이름/디자인)를 주석한다 — 페이지는 그룹과 무관하게 잘리지만
 * 헤더는 항목이 속한 그룹에서 파생되기 때문이다.
 */
function buildLinearStepItems(questions: Question[], groups: QuestionGroup[]): StepItem[] {
  const result: StepItem[] = [];

  const topLevelGroups = groups
    .filter((g) => !g.parentGroupId)
    .sort((a, b) => a.order - b.order);

  for (const rootGroup of topLevelGroups) {
    const rootGroupName = rootGroup.hideName ? null : rootGroup.name;
    const design = rootGroup.hideName ? undefined : rootGroup.nameDesign;
    for (const it of flattenRootScope(rootGroup.id, questions, groups)) {
      result.push({
        question: it.question,
        rootGroupId: rootGroup.id,
        rootGroupName,
        rootGroupNameDesign: design,
        subgroupName: it.subgroupName,
      });
    }
  }

  for (const it of flattenRootScope(null, questions, groups)) {
    result.push({
      question: it.question,
      rootGroupId: null,
      rootGroupName: null,
      rootGroupNameDesign: undefined,
      subgroupName: it.subgroupName,
    });
  }

  return result;
}

/**
 * 전체 설문을 페이지 렌더 스텝 배열로 변환한다.
 *
 * 규칙(수동 구분점 모델):
 * 1. 그룹 계층 + 인터리브 순서를 보존한 전역 선형 질문열을 만든다.
 * 2. 첫 항목과, `pageBreakBefore === true`인 항목에서만 새 페이지를 시작한다.
 *    (전체 첫 질문의 플래그는 무시 — 이미 페이지 시작이다.)
 */
export function buildRenderSteps(
  questions: Question[],
  groups: QuestionGroup[],
): RenderStep[] {
  const linear = buildLinearStepItems(questions, groups);
  if (linear.length === 0) return [];

  const steps: RenderStep[] = [];
  let buffer: StepItem[] = [];

  linear.forEach((item, idx) => {
    if (idx > 0 && item.question.pageBreakBefore) {
      steps.push({ kind: 'page', items: buffer });
      buffer = [];
    }
    buffer.push(item);
  });
  if (buffer.length > 0) steps.push({ kind: 'page', items: buffer });

  return steps;
}

// ── 분할 레이아웃 시작 지점 파생 ──

/**
 * 앵커 하나에서 이 판정에 필요한 것 전부. 좌표도 조사표도 알 필요가 없다 —
 * "무엇에 붙어 있는가"만 본다. 앵커 저장 방식과 무관하게 구조적으로 들어맞는다.
 */
export type AnchorOwnerRef = { ownerKind: 'question' | 'group'; ownerId: string };

/** 그 질문이 속한 그룹 사슬(자기 그룹 → 상위 → 루트). 그룹이 없으면 빈 배열. */
function groupChainOf(question: Question, parentOf: Map<string, string | null>): string[] {
  const chain: string[] = [];
  let cursor = question.groupId ?? null;
  // 자기참조 사이클이 들어와도 멈추도록 방문 집합을 둔다
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return chain;
}

/**
 * 분할 레이아웃이 시작되는 페이지 인덱스. 앵커가 하나도 걸리지 않으면 -1.
 *
 * **모드는 설정이 아니라 파생이다.** 앵커를 가진 항목이 처음 나타나는 페이지부터
 * 마지막 페이지까지 분할을 유지한다(sticky) — 앞쪽 인적사항 페이지는 일반이고,
 * 검토가 시작되면 조사표 뷰어가 끝까지 한 번만 마운트된다. 대가로 포기한 것은
 * 뒤쪽에 다시 일반 페이지를 두는 것이다.
 *
 * **판정은 구조 기준이다.** 조건부 표시로 숨은 질문의 앵커도 센다 — 그래야 응답자가
 * 앞 답을 고쳐도 시작점이 발밑에서 움직이지 않는다. 그러려면 호출자가 조건 필터를
 * 거치지 않은 스텝 목록을 넘겨야 한다. 좌측에 사각형을 *그리는* 것은 표시되는 항목
 * 것만이지만 그건 이 함수의 일이 아니다 — 레이아웃은 구조에서, 표시는 조건에서.
 *
 * 그룹에 붙은 앵커는 그 그룹의 **후손 질문**이 처음 나타나는 페이지에서 걸린다.
 */
export function resolveSplitStartIndex(
  steps: readonly RenderStep[],
  anchors: readonly AnchorOwnerRef[],
  groups: readonly QuestionGroup[],
): number {
  if (anchors.length === 0) return -1;

  const anchoredQuestionIds = new Set<string>();
  const anchoredGroupIds = new Set<string>();
  for (const anchor of anchors) {
    if (anchor.ownerKind === 'question') anchoredQuestionIds.add(anchor.ownerId);
    else anchoredGroupIds.add(anchor.ownerId);
  }

  const parentOf = new Map<string, string | null>(
    groups.map((g) => [g.id, g.parentGroupId ?? null]),
  );

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step) continue;
    for (const item of step.items) {
      if (anchoredQuestionIds.has(item.question.id)) return index;
      if (anchoredGroupIds.size > 0) {
        for (const groupId of groupChainOf(item.question, parentOf)) {
          if (anchoredGroupIds.has(groupId)) return index;
        }
      }
    }
  }
  return -1;
}

/** 이 페이지가 분할인가. sticky 라 시작점 이후는 앵커 유무와 무관하게 전부 분할이다. */
export function isSplitStep(splitStartIndex: number, stepIndex: number): boolean {
  return splitStartIndex >= 0 && stepIndex >= splitStartIndex;
}

// ── 스텝 단위 분기(branch) 해석 ──

/**
 * 주어진 질문 id 가 속한 렌더 스텝의 인덱스를 반환한다. 없으면 -1.
 */
export function findStepIndexOfQuestion(steps: RenderStep[], questionId: string): number {
  return steps.findIndex((s) => s.items.some((it) => it.question.id === questionId));
}

/**
 * 재개 위치 해석 (응답 버전 이관, ADR-0014).
 *
 * 답이 폐기·제거된 질문(affectedQuestionIds)이 있으면 그중 신버전에 실존하는
 * 가장 앞 페이지와 저장된 진행 위치 중 앞선 쪽을 고른다 — 응답자가 빈 답을
 * 모른 채 지나치지 않게 한다. 신버전에서 삭제된 영향 질문은 다시 답할 대상이
 * 없으므로 무시한다. 둘 다 해석 불능이면 -1 (호출자가 1페이지 시작 처리).
 */
export function resolveRestoreStepIndex(
  steps: RenderStep[],
  savedStepId: string,
  affectedQuestionIds: readonly string[] = [],
): number {
  const savedIdx = steps.findIndex((s) => stepIdOf(s) === savedStepId);
  const affectedIndices = affectedQuestionIds
    .map((qid) => findStepIndexOfQuestion(steps, qid))
    .filter((idx) => idx >= 0);
  if (affectedIndices.length === 0) return savedIdx;
  const earliestAffected = Math.min(...affectedIndices);
  return savedIdx < 0 ? earliestAffected : Math.min(savedIdx, earliestAffected);
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
