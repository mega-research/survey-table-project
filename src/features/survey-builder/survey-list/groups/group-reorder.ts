// 그룹 관리 창의 끌어서 순서 바꾸기 — 순수 계산 (설문 그룹 중첩 티켓 07).
//
// 순서는 **같은 부모 안의 형제끼리만** 바뀐다. 서버도 한 번에 한 부모의 형제만 다시 매기므로
// (`ReorderSurveyGroupsInput.parentGroupId`), 화면이 보내는 것은 「그 부모」와 「그 부모의 형제 id
// 전부를 새 순서로」다. 다른 부모 밑으로 끌어다 놓는 것은 순서 바꾸기가 아니라 옮기기이고, 그 길은
// ⋯ 메뉴의 옮기기 창 하나다.
//
// 읽는 모양은 id 와 상위 id 뿐이다(트리 조립 `@/utils/survey-group-tree` 과 같다). 형제의 순서는
// 목록에 온 순서다.
import type { SurveyGroupTreeRow } from '@/utils/survey-group-tree';

export interface GroupSiblingReorder {
  /** 순서를 다시 매길 부모 — 최상위끼리면 null. */
  parentGroupId: string | null;
  /** 그 부모의 형제 id 전부, 새 순서대로. 다른 부모의 줄은 들어가지 않는다. */
  orderedGroupIds: string[];
}

/**
 * `movedId` 줄을 `overId` 줄의 자리에 놓았을 때 보낼 순서. 보낼 것이 없으면 null.
 *
 * **두 줄의 부모가 다르면 null 이다** — 화면이 끌기를 부모별로 가둬 두지만(형제 목록마다 끌기
 * 영역이 따로다), 그 가둠이 풀리더라도 다른 부모의 줄 사이로는 놓이지 않게 여기서 한 번 더 막는다.
 */
export function planGroupSiblingReorder<T extends SurveyGroupTreeRow>(
  groups: readonly T[],
  movedId: string,
  overId: string,
): GroupSiblingReorder | null {
  if (movedId === overId) return null;
  const moved = groups.find((group) => group.id === movedId);
  const over = groups.find((group) => group.id === overId);
  if (!moved || !over || moved.parentGroupId !== over.parentGroupId) return null;

  const siblingIds = groups
    .filter((group) => group.parentGroupId === moved.parentGroupId)
    .map((group) => group.id);
  const from = siblingIds.indexOf(movedId);
  const to = siblingIds.indexOf(overId);

  // 끌어 온 줄을 빼고 놓은 줄의 자리에 끼운다 — 위로 끌면 그 앞, 아래로 끌면 그 뒤가 된다.
  siblingIds.splice(from, 1);
  siblingIds.splice(to, 0, movedId);
  return { parentGroupId: moved.parentGroupId, orderedGroupIds: siblingIds };
}

/**
 * 평평한 목록에서 그 부모의 형제만 새 순서로 다시 놓는다 — 저장을 기다리는 동안 미리 그리는 데 쓴다.
 * 다른 줄의 자리는 그대로다.
 *
 * **형제의 구성이 `orderedGroupIds` 와 다르면 받은 목록을 그대로 돌려준다.** 그 사이 다른 팀원이
 * 그 자리에 그룹을 만들었거나 지웠거나 옮긴 것이다 — 옛 순서를 억지로 씌우면 새 그룹이 화면에서
 * 사라진다.
 */
export function applyGroupSiblingOrder<T extends SurveyGroupTreeRow>(
  groups: readonly T[],
  parentGroupId: string | null,
  orderedGroupIds: readonly string[],
): readonly T[] {
  const slots: number[] = [];
  const siblingsById = new Map<string, T>();
  groups.forEach((group, index) => {
    if (group.parentGroupId !== parentGroupId) return;
    slots.push(index);
    siblingsById.set(group.id, group);
  });

  const ordered = orderedGroupIds.flatMap((id) => {
    const sibling = siblingsById.get(id);
    return sibling ? [sibling] : [];
  });
  const sameSiblings =
    ordered.length === slots.length &&
    orderedGroupIds.length === slots.length &&
    new Set(orderedGroupIds).size === slots.length;
  if (!sameSiblings) return groups;

  const next = [...groups];
  slots.forEach((slot, index) => {
    next[slot] = ordered[index] as T;
  });
  return next;
}
