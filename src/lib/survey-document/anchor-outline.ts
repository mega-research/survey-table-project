/**
 * 앵커를 붙일 대상 목록과, "이 항목을 고르면 조사표의 어느 영역이 켜지는가" 판정.
 * 순수 모듈 — DB·React·pdf.js 를 모른다.
 */

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
  questions: AnchorOutlineQuestion[];
}

interface GroupInput {
  id: string;
  name: string;
  order: number;
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
 * 그룹 순서 → 그룹 안 문항 순서로 조사표 순서를 만든다.
 *
 * 문항의 `order` 는 그룹 안에서만 매겨지므로 그룹 순서를 먼저 태우지 않으면
 * 조사표 순서와 어긋난다. 그룹 없는 문항은 마지막 구역으로 모은다.
 */
export function buildAnchorOutline(
  groups: readonly GroupInput[],
  questions: readonly QuestionInput[],
): AnchorOutlineSection[] {
  const ordered = [...groups].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const byGroup = new Map<string | null, AnchorOutlineQuestion[]>();

  for (const question of [...questions].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  )) {
    const groupId = question.groupId ?? null;
    const item: AnchorOutlineQuestion = {
      id: question.id,
      groupId,
      label: anchorQuestionLabel(question),
    };
    const list = byGroup.get(groupId);
    if (list) list.push(item);
    else byGroup.set(groupId, [item]);
  }

  const sections: AnchorOutlineSection[] = ordered.map((group) => ({
    groupId: group.id,
    label: group.name,
    questions: byGroup.get(group.id) ?? [],
  }));

  const ungrouped = byGroup.get(null);
  if (ungrouped && ungrouped.length > 0) {
    sections.push({ groupId: null, label: '그룹 없음', questions: ungrouped });
  }
  return sections;
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
): string | null {
  if (hasAnchors(target.id)) return target.id;
  if (target.kind === 'question' && target.groupId && hasAnchors(target.groupId)) {
    return target.groupId;
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
): AnchorFocus | null {
  const ownerId = resolveAnchorOwnerId(
    { kind: 'question', id: target.id, groupId: target.groupId },
    (id) => pagesOf(id).length > 0,
  );
  if (!ownerId) return null;
  const contextId =
    target.groupId && pagesOf(target.groupId).length > 0 ? target.groupId : null;

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
