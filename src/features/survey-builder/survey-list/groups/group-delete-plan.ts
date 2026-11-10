// 그룹 삭제의 화면 쪽 계산 — 순수 함수 (설문 그룹 중첩 티켓 06).
//
// 그룹을 지우면 그 안의 하위 그룹과 직접 담긴 설문이 **한 단계 위로** 올라간다. 삭제 확인 창이
// 「무엇이 어디로 가는가」를 미리 말하고, 이름이 겹쳐 막혔을 때 무엇을 고치면 되는지 말하고,
// 보고 있던 그룹이 사라졌을 때 갈 화면을 정하는 데 쓴다. 올리기와 겹침 판정 자체는 서버가 한다 —
// 여기는 평평한 그룹 목록에서 문구의 재료만 뽑는다.
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

import { groupHref } from './group-view-header';

/** 내용물이 올라갈 자리 — 최상위 그룹을 지우면 `root`(하위 그룹은 최상위로, 설문은 미분류로). */
export type GroupDeleteDestination =
  | { kind: 'root' }
  /** 상위 그룹. 목록에 없으면(내게 보이지 않는 그룹) 이름을 모른다. */
  | { kind: 'group'; name: string | null };

export interface GroupDeletePlan {
  destination: GroupDeleteDestination;
  /** 함께 올라갈 바로 밑 하위 그룹의 이름 — 내게 보이는 것만, 표시 순서대로. */
  subgroupNames: string[];
}

/** 문구에 이름을 늘어놓는 상한 — 넘으면 「외 N개」로 접는다. */
const NAMED_SUBGROUP_LIMIT = 3;

export function planGroupDelete(
  groups: readonly SurveyGroupListItem[],
  group: Pick<SurveyGroupListItem, 'id' | 'parentGroupId'>,
): GroupDeletePlan {
  const mine = groups.filter((candidate) => candidate.foreignTeamName === null);
  const parentId = group.parentGroupId;
  return {
    destination:
      parentId === null
        ? { kind: 'root' }
        : { kind: 'group', name: mine.find((candidate) => candidate.id === parentId)?.name ?? null },
    subgroupNames: mine
      .filter((candidate) => candidate.parentGroupId === group.id)
      .map((candidate) => candidate.name),
  };
}

/**
 * 삭제 확인 문구 (3단계 시안 G4).
 *
 * **설문 건수는 적지 않는다** — 이 그룹에 내가 볼 수 없는 설문이 담겨 있을 수 있어, 수를 적으면
 * 화면의 카드 수와의 차이로 숨긴 설문의 존재가 드러난다. 하위 그룹도 내게 보이는 것만 말한다.
 */
export function describeGroupDelete(plan: GroupDeletePlan): string {
  const subgroups = describeSubgroups(plan.subgroupNames);
  const reassurance = '설문은 삭제되지 않습니다.';

  if (plan.destination.kind === 'root') {
    return subgroups
      ? `${subgroups}는 최상위 그룹이 되고, 여기에 직접 담긴 설문은 미분류로 돌아갑니다. ${reassurance}`
      : `여기에 직접 담긴 설문은 미분류로 돌아갑니다. ${reassurance}`;
  }

  const destination =
    plan.destination.name === null ? '한 단계 위 그룹' : `한 단계 위 「${plan.destination.name}」 그룹`;
  return subgroups
    ? `${subgroups}와 여기에 직접 담긴 설문이 ${destination}으로 올라갑니다. ${reassurance}`
    : `여기에 직접 담긴 설문이 ${destination}으로 올라갑니다. ${reassurance}`;
}

/** 「하위 그룹 2개(상반기 · 하반기)」 — 없으면 null. 끝이 「…개)」라 뒤에 붙는 조사가 고정이다. */
function describeSubgroups(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const named = names.slice(0, NAMED_SUBGROUP_LIMIT).join(' · ');
  const rest = names.length - NAMED_SUBGROUP_LIMIT;
  return `하위 그룹 ${names.length}개(${rest > 0 ? `${named} 외 ${rest}개` : named})`;
}

/**
 * 이름이 겹쳐 삭제가 막혔을 때의 문구 — 겹치는 이름(서버가 준 값), 겹치는 자리, 고칠 방법.
 */
export function describeGroupDeleteBlocked(
  plan: GroupDeletePlan,
  conflictingNames: readonly string[],
): string {
  const where =
    plan.destination.kind === 'root'
      ? '최상위에'
      : plan.destination.name === null
        ? '한 단계 위에'
        : `「${plan.destination.name}」에`;
  const names = conflictingNames.map((name) => `「${name}」`).join(' · ');
  const fix =
    conflictingNames.length > 1
      ? '겹치는 이름을 바꾼 뒤 다시 삭제하세요.'
      : '둘 중 하나의 이름을 바꾼 뒤 다시 삭제하세요.';
  return `${where} 이미 ${names} 그룹이 있어 하위 그룹을 올릴 수 없습니다. ${fix}`;
}

/**
 * 보고 있던 그룹이 목록에서 사라졌을 때 갈 주소.
 *
 * 마지막으로 본 경로(뿌리 → 그 그룹)를 거슬러 올라가 **아직 남아 있는 가장 가까운 위 그룹**의
 * 화면으로 간다. 그룹을 지우면 내용물이 한 단계 위로 올라가므로 방금 보던 것들이 거기에 있다 —
 * 내가 지웠든 다른 팀원이 지웠든 같다. 위쪽이 없으면(최상위였거나 처음부터 없는 주소) 설문 목록이다.
 */
export function resolveGroupFallbackHref(
  lastPath: readonly Pick<SurveyGroupListItem, 'id'>[],
  groups: readonly Pick<SurveyGroupListItem, 'id'>[],
): string {
  const remaining = new Set(groups.map((group) => group.id));
  const survivor = lastPath
    .slice(0, -1)
    .reverse()
    .find((step) => remaining.has(step.id));
  return survivor ? groupHref(survivor.id) : '/surveys';
}
