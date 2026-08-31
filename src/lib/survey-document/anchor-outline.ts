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
