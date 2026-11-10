// 설문 그룹 트리 — 순수 계산 (설문 그룹 중첩 티켓 01).
//
// 그룹 목록은 서버가 **평평하게** 준다(줄마다 상위 그룹 id). 트리로 묶는 일과 위쪽 경로를 찾는
// 일은 그룹 화면·사이드바·그룹 관리 창·옮기기 창·카드의 「그룹 이동」 메뉴가 똑같이 해야 해서
// 화면 밖 공용 자리에 한 벌로 둔다 — 사이드바(workspace)와 설문 목록(survey-builder)은 서로를
// import 하지 못한다.
//
// 모양은 일부러 좁다(id 와 상위 id 만 읽는다). 계약 타입을 끌어오지 않아도 되고, 테스트가
// 그룹 줄 전체를 지어내지 않아도 된다.

/** 트리로 묶는 데 필요한 최소 모양 — 그룹 목록의 줄이 이것을 만족한다. */
export interface SurveyGroupTreeRow {
  id: string;
  /** 상위 그룹 id. 최상위이거나 상위를 알려 주지 않는 줄(협업 그룹)은 null. */
  parentGroupId: string | null;
}

export interface SurveyGroupTreeNode<T extends SurveyGroupTreeRow> {
  group: T;
  /** 이 목록 안에서의 깊이 — 뿌리가 1. */
  depth: number;
  children: SurveyGroupTreeNode<T>[];
}

/**
 * 평평한 목록 → 트리. 형제의 순서는 목록에 온 순서 그대로다(서버가 표시 순서로 정렬해 준다).
 *
 * **부모가 목록에 없는 줄은 뿌리로 둔다.** 상위 그룹이 내게 보이지 않는 경우다(그 그룹에 내가
 * 볼 수 있는 설문이 없다) — 매달 자리가 없다고 버리면 볼 수 있는 폴더가 화면에서 사라진다.
 * 그래서 `depth` 는 「이 목록 안에서의 깊이」이지 DB 의 깊이가 아니다. 깊이 제한의 판정은
 * 서버가 한다.
 *
 * 서로를 부모로 가리키는 줄(DB 가 막지만)이 와도 멈추지 않고 한 줄도 잃지 않는다 — 뿌리에서
 * 닿지 않은 줄은 뿌리로 올린다.
 */
export function buildSurveyGroupTree<T extends SurveyGroupTreeRow>(
  groups: readonly T[],
): SurveyGroupTreeNode<T>[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];

  for (const group of groups) {
    const parentId = group.parentGroupId;
    if (parentId === null || parentId === group.id || !byId.has(parentId)) {
      roots.push(group);
      continue;
    }
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(group);
    else childrenOf.set(parentId, [group]);
  }

  const placed = new Set<string>();
  function toNode(group: T, depth: number): SurveyGroupTreeNode<T> {
    placed.add(group.id);
    const children = (childrenOf.get(group.id) ?? [])
      .filter((child) => !placed.has(child.id))
      .map((child) => toNode(child, depth + 1));
    return { group, depth, children };
  }

  const tree = roots.map((group) => toNode(group, 1));
  // 뿌리에서 닿지 않은 줄 = 순환 안에 갇힌 줄. 목록 순서대로 뿌리로 올린다.
  for (const group of groups) {
    if (!placed.has(group.id)) tree.push(toNode(group, 1));
  }
  return tree;
}

/**
 * 위쪽 경로 — 뿌리부터 지목한 그룹까지(자기 포함). 브레드크럼과 「지금 들어가 있는 가지」가 쓴다.
 *
 * 목록에 없는 그룹은 빈 경로다. 부모가 목록에 없으면 거기서 멈춘다(위 「뿌리로 둔다」와 같은
 * 이유) — 그래서 경로의 길이도 이 목록 안에서의 깊이다.
 */
export function findSurveyGroupPath<T extends SurveyGroupTreeRow>(
  groups: readonly T[],
  groupId: string,
): T[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const path: T[] = [];
  const seen = new Set<string>();

  let current = byId.get(groupId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentGroupId === null ? undefined : byId.get(current.parentGroupId);
  }
  return path;
}

/** 경로 문구의 이음 — 「이정운 › 2026 › 상반기」. 브레드크럼과 같은 화살표다. */
const PATH_SEPARATOR = ' › ';

/**
 * 그룹마다의 **읽어 주는 이름** — 뿌리부터 자기까지의 경로(「이정운 › 2025」). 최상위 그룹은 이름 그대로다.
 *
 * 이름은 같은 상위 그룹 안에서만 유일해서 「2025」가 여러 상위 그룹 밑에 설 수 있다. 화면에서는
 * 들여쓰기가 둘을 가르지만 스크린리더는 단추의 이름만 읽는다 — 「2025 더보기」가 둘이면 어느 것인지
 * 알 수 없다. 그래서 단추·라디오의 이름(`aria-label`)에는 이 문구를 쓰고 **보이는 글자는 이름 그대로**
 * 둔다. 카드의 「그룹 이동」 메뉴 · 옮기기 창 · 그룹 관리 창 · 사이드바 · 폴더 줄이 같은 문구를 쓴다.
 *
 * 경로는 **이 목록 안에서** 센다(`buildSurveyGroupTree` 와 같은 규칙) — 상위 그룹이 목록에 없는 줄은
 * 뿌리라 이름 그대로다.
 */
export function listSurveyGroupPathLabels<T extends SurveyGroupTreeRow & { name: string }>(
  groups: readonly T[],
): Map<string, string> {
  const labels = new Map<string, string>();
  function visit(nodes: readonly SurveyGroupTreeNode<T>[], parentLabel: string | null): void {
    for (const node of nodes) {
      const label =
        parentLabel === null ? node.group.name : `${parentLabel}${PATH_SEPARATOR}${node.group.name}`;
      labels.set(node.group.id, label);
      visit(node.children, label);
    }
  }
  visit(buildSurveyGroupTree(groups), null);
  return labels;
}

// ─────────────────────────────────────────────────────────────────────────────
// 옮길 수 있는 자리 (설문 그룹 중첩 티켓 05)
// ─────────────────────────────────────────────────────────────────────────────
//
// 「이 그룹을 저 자리로 옮길 수 있는가」는 한 벌이다. 옮기기 창과 그룹 관리 창이 갈 수 없는 자리를
// 끄는 데 쓰고, 서버가 팀 키 잠금 아래서 그 팀의 그룹 전부를 읽어 **같은 함수로** 다시 판정한다.
// 화면의 목록은 내게 보이는 그룹뿐이라(숨은 하위 그룹은 높이에 안 잡힌다) 화면 판정은 근사이고
// 서버 판정이 답이다.

/**
 * 옮길 수 없는 사유.
 *
 * - `missing` — 옮기는 그룹이나 새 상위가 목록에 없다(없는 그룹·다른 팀의 그룹).
 * - `self` · `descendant` — 자기 자신, 자기 하위 그룹 밑(순환).
 * - `current` — 이미 그 자리다. 화면은 「지금 여기」로 끄고, 서버는 아무것도 바꾸지 않고 성공한다.
 * - `too_deep` — 옮기면 그 가지의 맨 아래가 최대 단계를 넘는다.
 */
export type SurveyGroupRelocationBlock = 'missing' | 'self' | 'descendant' | 'current' | 'too_deep';

/**
 * 그룹을 `targetParentId` 밑으로(null 이면 최상위로) 옮길 수 있는가. 되면 null, 안 되면 사유.
 *
 * 깊이 규칙은 「새 상위의 깊이 + 옮기는 가지의 높이 ≤ `maxDepth`」다(최상위의 깊이는 0, 하위가
 * 없는 그룹의 높이는 1). 깊이와 높이는 **이 목록 안에서** 센다.
 */
export function judgeSurveyGroupRelocation<T extends SurveyGroupTreeRow>(
  groups: readonly T[],
  groupId: string,
  targetParentId: string | null,
  maxDepth: number,
): SurveyGroupRelocationBlock | null {
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) return 'missing';
  const height = subtreeHeight(groups, groupId);

  if (targetParentId === null) {
    if (group.parentGroupId === null) return 'current';
    return height > maxDepth ? 'too_deep' : null;
  }

  if (targetParentId === groupId) return 'self';
  const targetPath = findSurveyGroupPath(groups, targetParentId);
  if (targetPath.length === 0) return 'missing';
  if (targetPath.some((ancestor) => ancestor.id === groupId)) return 'descendant';
  if (group.parentGroupId === targetParentId) return 'current';
  return targetPath.length + height > maxDepth ? 'too_deep' : null;
}

/** 그 그룹에서 맨 아래 하위 그룹까지의 단 수 — 하위가 없으면 1. */
function subtreeHeight<T extends SurveyGroupTreeRow>(groups: readonly T[], groupId: string): number {
  const seen = new Set<string>();
  function heightOf(id: string): number {
    if (seen.has(id)) return 0;
    seen.add(id);
    let tallest = 0;
    for (const child of groups) {
      if (child.parentGroupId === id && child.id !== id) {
        tallest = Math.max(tallest, heightOf(child.id));
      }
    }
    return 1 + tallest;
  }
  return heightOf(groupId);
}

/** 옮기기 창의 한 줄 — 갈 수 있으면 `blocked` 가 null 이다. */
export interface SurveyGroupRelocationTarget<T extends SurveyGroupTreeRow> {
  group: T;
  /** 이 목록 안에서의 깊이 — 들여쓰기에 쓴다. 뿌리가 1. */
  depth: number;
  blocked: SurveyGroupRelocationBlock | null;
}

export interface SurveyGroupRelocationTargets<T extends SurveyGroupTreeRow> {
  /** 「최상위로」 줄. */
  root: { blocked: SurveyGroupRelocationBlock | null };
  /** 그룹 줄 — 트리 순서(부모 다음에 그 하위)로 편 목록. */
  targets: SurveyGroupRelocationTarget<T>[];
}

/**
 * 옮기기 창이 그릴 자리 전부 — 줄마다 위 판정을 붙인다.
 *
 * **자기 자신과 그 하위는 목록에서 뺀다**(고를 수 없는 자리를 늘어놓지 않는다). 지금 부모와 깊이가
 * 넘는 자리는 남겨 두고 사유를 붙인다 — 왜 못 가는지 눌러 보지 않고 알 수 있게.
 */
export function listSurveyGroupRelocationTargets<T extends SurveyGroupTreeRow>(
  groups: readonly T[],
  groupId: string,
  maxDepth: number,
): SurveyGroupRelocationTargets<T> {
  const root = { blocked: judgeSurveyGroupRelocation(groups, groupId, null, maxDepth) };
  if (root.blocked === 'missing') return { root, targets: [] };

  const targets: SurveyGroupRelocationTarget<T>[] = [];
  function visit(nodes: readonly SurveyGroupTreeNode<T>[]): void {
    for (const node of nodes) {
      // 자기 자신을 건너뛰면 그 하위도 함께 빠진다.
      if (node.group.id === groupId) continue;
      targets.push({
        group: node.group,
        depth: node.depth,
        blocked: judgeSurveyGroupRelocation(groups, groupId, node.group.id, maxDepth),
      });
      visit(node.children);
    }
  }
  visit(buildSurveyGroupTree(groups));
  return { root, targets };
}
