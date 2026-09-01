/**
 * 앵커를 붙일 대상 목록과, "이 항목을 고르면 조사표의 어느 영역이 켜지는가" 판정.
 * 순수 모듈 — DB·React·pdf.js 를 모른다.
 */
import { getInterleavedChildren } from '@/lib/group-ordering';
import type { Question, QuestionGroup } from '@/types/survey';

export interface AnchorOutlineQuestion {
  id: string;
  groupId: string | null;
  /** 화면에 보일 짧은 이름 — 문항코드가 있으면 그것, 없으면 문항 문장. */
  label: string;
}

export interface AnchorOutlineSection {
  /** null = 그룹에 속하지 않은 문항들. 그룹 폴백이 없다. */
  groupId: string | null;
  label: string;
  /** 계층 깊이. 0 = 최상위 그룹. 화면이 들여쓰기에 쓴다. */
  depth: number;
  /**
   * 이 그룹의 **첫 구간**인가. 하위그룹이 그룹의 문항 사이에 끼면 한 그룹이 여러
   * 구간으로 쪼개진다 — 머리(그룹 행)는 첫 구간에만 그린다.
   */
  isFirstRun: boolean;
  questions: AnchorOutlineQuestion[];
}

interface GroupInput {
  id: string;
  name: string;
  order: number;
  parentGroupId?: string | null;
}

interface QuestionInput {
  id: string;
  groupId?: string | null;
  order: number;
  questionCode?: string | null;
  title: string;
}

/** 문항 라벨 — 코드가 있으면 코드, 없으면 문장을 줄여 쓴다. */
export function anchorQuestionLabel(question: QuestionInput): string {
  const code = question.questionCode?.trim();
  if (code) return code;
  const title = question.title.trim();
  return title.length > 24 ? `${title.slice(0, 24)}…` : title || '(제목 없음)';
}

/**
 * 조사표 순서로 앵커 대상 목록을 만든다.
 *
 * **순서의 주인은 이 파일이 아니다.** `group-ordering` 의 `getInterleavedChildren` 이
 * 그룹 계층과 인터리브 규칙을 갖고 있고, 응답 화면의 페이지 구성도 그것으로 만들어진다.
 * 여기서 다시 정렬하면 두 벌이 되어 어긋난다 — 실제로 `order` 를 평평하게 정렬했다가
 * 하위그룹이 89번째 문항을 담고도 목록 네 번째로 올라왔다.
 *
 * 문항이 하나도 없는 그룹도 구역으로 남는다 — 문항을 만들기 전에 그룹에 영역을
 * 먼저 붙일 수 있어야 한다.
 */
export function buildAnchorOutline(
  groups: readonly GroupInput[],
  questions: readonly QuestionInput[],
): AnchorOutlineSection[] {
  // getInterleavedChildren 은 앱의 Question/QuestionGroup 을 받는다. 이 모듈은 구조적
  // 타입만 알면 되므로 정렬에 필요한 필드만 실어 넘긴다.
  const questionRows = questions.map((q) => ({
    id: q.id,
    ...(q.groupId ? { groupId: q.groupId } : {}),
    order: q.order,
  })) as unknown as Question[];
  const groupRows = groups.map((g) => ({
    id: g.id,
    name: g.name,
    order: g.order,
    ...(g.parentGroupId ? { parentGroupId: g.parentGroupId } : {}),
  })) as unknown as QuestionGroup[];

  const bySourceId = new Map(questions.map((q) => [q.id, q]));
  const byGroupId = new Map(groups.map((g) => [g.id, g]));
  const sections: AnchorOutlineSection[] = [];

  const toItem = (id: string): AnchorOutlineQuestion | null => {
    const source = bySourceId.get(id);
    if (!source) return null;
    return {
      id: source.id,
      groupId: source.groupId ?? null,
      label: anchorQuestionLabel(source),
    };
  };

  /**
   * 그룹 하나를 구역으로 열고, 그 안을 인터리브 순서로 훑는다.
   *
   * 하위그룹이 그 그룹의 문항 **사이**에 오면 구역을 거기서 끊고, 하위그룹을 먼저
   * 낸 뒤 나머지 문항을 이어지는 구역으로 담는다. 한 구역에 몰아 담으면 하위그룹이
   * 항상 뒤로 밀려, 89~96번을 담은 하위그룹이 97번 뒤에 나오게 된다.
   */
  const walkGroup = (group: GroupInput, depth: number) => {
    const openRun = (isFirstRun: boolean): AnchorOutlineSection => {
      const run: AnchorOutlineSection = {
        groupId: group.id,
        label: group.name,
        depth,
        isFirstRun,
        questions: [],
      };
      sections.push(run);
      return run;
    };

    let run = openRun(true);
    for (const child of getInterleavedChildren(group.id, questionRows, groupRows)) {
      if (child.kind === 'subgroup') {
        const sub = byGroupId.get(child.data.id);
        if (sub) walkGroup(sub, depth + 1);
        run = openRun(false);
        continue;
      }
      const item = toItem(child.data.id);
      if (item) run.questions.push(item);
    }
  };

  // 최상위 그룹부터 order 순으로 — 본체의 선형화(buildLinearStepItems)와 같은 순서다.
  for (const root of [...groups]
    .filter((g) => !g.parentGroupId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
    walkGroup(root, 0);
  }

  // 그룹 없는 문항은 마지막 구역으로 모은다 (선형화도 이 순서다).
  const ungrouped = [...questions]
    .filter((q) => !q.groupId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((q) => toItem(q.id))
    .filter((item): item is AnchorOutlineQuestion => item !== null);
  if (ungrouped.length > 0) {
    sections.push({
      groupId: null,
      label: '그룹 없음',
      depth: 0,
      isFirstRun: true,
      questions: ungrouped,
    });
  }

  // 하위그룹 뒤에 문항이 없으면 이어지는 구역이 비어 남는다 — 머리도 없으므로 버린다.
  return sections.filter((section) => section.isFirstRun || section.questions.length > 0);
}

/**
 * 이 항목을 고르면 조사표의 어느 대상 영역이 켜지는가.
 *
 * 문항에 자기 영역이 없으면 **소속 그룹의 영역으로 떨어진다** — 83개 문항 전부에
 * 사각형을 그리게 하지 않기 위한 규칙이다. 그룹에도 없으면 켤 것이 없다(null).
 */
export function resolveAnchorOwnerId(
  target: { kind: 'group'; id: string } | { kind: 'question'; id: string; groupId: string | null },
  hasAnchors: (ownerId: string) => boolean,
  /**
   * 그룹 → 상위 그룹. 하위그룹에 앵커가 없으면 **조상 사슬을 타고** 올라간다.
   * 분할 판정(resolveSplitSteps)이 이미 사슬 전체를 보므로, 여기서 직속 그룹만
   * 보면 "판은 갈라졌는데 켤 것이 없는" 화면이 나온다.
   */
  parentOf: (groupId: string) => string | null = () => null,
): string | null {
  if (hasAnchors(target.id)) return target.id;
  if (target.kind !== 'question') return null;

  // 자기참조·순환이 들어와도 멈추도록 방문 집합을 둔다
  const seen = new Set<string>();
  let cursor = target.groupId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (hasAnchors(cursor)) return cursor;
    cursor = parentOf(cursor);
  }
  return null;
}

/**
 * 지금 고른 문항 하나가 조사표에 요구하는 것 전부.
 *
 * 셋이 따로 다니면 어긋난다 — 어디를 켜는가(ownerId), 무엇을 맥락으로 함께
 * 그리는가(contextId), 어느 쪽으로 이동하는가(page). 한 덩어리로 묶어 넘긴다.
 */
export interface AnchorFocus {
  /** 켤 대상 — 자기 영역이 있으면 문항, 없으면 소속 그룹. */
  ownerId: string;
  /** 함께 옅게 그릴 맥락 — 언제나 소속 그룹. ownerId 와 같으면 맥락이 곧 초점이다. */
  contextId: string | null;
  /**
   * 맥락이 걸친 쪽들. 오름차순·중복 없음.
   *
   * **한 대상에 사각형이 여럿이고 서로 다른 쪽에 있을 때의 규칙**: 이동은 그중
   * **가장 앞선 쪽**으로 간다(`pages[0]`). 블록이 3쪽·4쪽에 걸쳐 있으면 3쪽으로
   * 가서 순서대로 훑게 되고, 뒤쪽으로 보내면 앞부분을 놓친다.
   *
   * 여럿이면 뷰어가 그 범위를 이어 붙여 보여준다 — 쪽 경계에 걸친 블록을
   * 두 번 넘겨 가며 확인하지 않아도 된다.
   */
  pages: number[];
}

/**
 * 문항 하나에서 초점을 푼다. 켤 것이 아무것도 없으면 null.
 *
 * 문항에 자기 영역이 없으면 소속 그룹의 영역이 대신 켜진다 —
 * [[resolveAnchorOwnerId]] 와 같은 폴백 규칙이다.
 */
export function resolveAnchorFocus(
  target: { id: string; groupId: string | null },
  pagesOf: (ownerId: string) => readonly number[],
  /**
   * 같은 그룹의 문항 id 들. 맥락의 쪽 범위를 넓히는 데만 쓴다 — 블록이 걸친 쪽은
   * 그룹 자신의 사각형뿐 아니라 그 안 문항들의 사각형까지 합쳐야 나온다.
   */
  siblingQuestionIds: readonly string[] = [],
  /** 그룹 → 상위 그룹. 앵커가 상위 그룹에만 있을 때 사슬을 타고 올라간다. */
  parentOf: (groupId: string) => string | null = () => null,
): AnchorFocus | null {
  const hasAnchors = (id: string) => pagesOf(id).length > 0;
  const ownerId = resolveAnchorOwnerId(
    { kind: 'question', id: target.id, groupId: target.groupId },
    hasAnchors,
    parentOf,
  );
  if (!ownerId) return null;
  // 맥락은 앵커를 실제로 가진 가장 가까운 조상 그룹이다 — 초점이 그 그룹으로
  // 떨어졌다면 맥락도 같은 그룹이고, 문항이 자기 영역을 가졌으면 그 위 조상이다.
  const contextId =
    ownerId !== target.id
      ? ownerId
      : (resolveAnchorOwnerId(
          { kind: 'question', id: '\u0000none', groupId: target.groupId },
          hasAnchors,
          parentOf,
        ) ?? null);

  const scope = contextId ? [contextId, ...siblingQuestionIds] : [ownerId];
  const pages = [...new Set(scope.flatMap((id) => [...pagesOf(id)]))].sort((a, b) => a - b);
  // 맥락에 쪽이 하나도 없으면(형제가 비었을 때) 초점 자신의 쪽으로 떨어진다.
  const resolved = pages.length > 0 ? pages : [...pagesOf(ownerId)].sort((a, b) => a - b);
  if (resolved.length === 0) return null;
  return { ownerId, contextId, pages: resolved };
}

/**
 * 조사표에서 사각형을 눌렀을 때 오른쪽에서 고를 문항. 없으면 null.
 *
 * 문항 사각형이면 그 문항, 그룹 사각형이면 그 그룹의 **표시되는 첫 문항**이다 —
 * 그룹은 답하는 단위가 아니라 묶음이라 커서를 놓을 자리가 그 안에 있어야 한다.
 */
export function resolveQuestionForOwner(
  ownerId: string,
  visibleQuestions: readonly { id: string; groupId: string | null }[],
): string | null {
  const self = visibleQuestions.find((q) => q.id === ownerId);
  if (self) return self.id;
  return visibleQuestions.find((q) => q.groupId === ownerId)?.id ?? null;
}

/**
 * 앵커를 **대상이 살아 있는 것**과 주인 없는 것으로 가른다.
 *
 * 질문·그룹을 지우면 저장 시점에 FK 가 앵커를 함께 지운다. 문제는 그 사이다 —
 * 질문 삭제는 초안에만 반영되고 상단 저장을 눌러야 DB 로 가므로, 그전까지 앵커는
 * 서버에 그대로 있고 조사표 위에는 주인 없는 사각형이 떠 있다. 지운 문항의 영역이
 * 남아 보이면 무엇이 지워졌는지 화면을 못 믿게 된다.
 *
 * `knownOwnerIds` 가 비면 전부 그린다. 스토어가 채워지기 전 한 프레임을 "전부
 * 삭제됨"으로 읽어 사각형이 깜빡이는 것이 더 나쁘다.
 */
export function selectDrawableAnchors<T extends { ownerId: string }>(
  anchors: readonly T[],
  knownOwnerIds: ReadonlySet<string>,
): { drawn: T[]; orphaned: T[] } {
  if (knownOwnerIds.size === 0) return { drawn: [...anchors], orphaned: [] };
  const drawn: T[] = [];
  const orphaned: T[] = [];
  for (const anchor of anchors) {
    if (knownOwnerIds.has(anchor.ownerId)) drawn.push(anchor);
    else orphaned.push(anchor);
  }
  return { drawn, orphaned };
}
