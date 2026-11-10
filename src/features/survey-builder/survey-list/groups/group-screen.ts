// 그룹 화면이 그릴 것 — 순수 계산 (설문 그룹 중첩 티켓 01).
//
// 그룹 화면(`/surveys?group=<id>`)은 평평한 그룹 목록 하나에서 세 가지를 뽑는다: 브레드크럼의
// 경로, 폴더 줄로 그릴 하위 그룹, 「새 하위 그룹」을 보일지. 트리 묶기와 경로 찾기 자체는 공용
// (`@/utils/survey-group-tree`)이고 여기는 그 화면의 규칙만 둔다.
import { SURVEY_GROUP_MAX_DEPTH } from '@/shared/contracts/workspace-io';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';
import { findSurveyGroupPath } from '@/utils/survey-group-tree';

export interface GroupScreenSubgroup {
  group: SurveyGroupListItem;
  /** 이 하위 그룹 바로 밑의 그룹 수 — 폴더 줄의 「하위 그룹 M」. */
  subgroupCount: number;
}

export interface GroupScreen {
  /** 브레드크럼 — 뿌리부터 지금 그룹까지(자기 포함). */
  path: SurveyGroupListItem[];
  /** 지금 그룹 바로 밑의 하위 그룹, 표시 순서대로. 없으면 폴더 줄 영역을 그리지 않는다. */
  subgroups: GroupScreenSubgroup[];
  /** 「새 하위 그룹」을 보일지 — 내 팀 그룹이고 3단계가 아닐 때만. */
  canCreateSubgroup: boolean;
}

/**
 * 지목한 그룹의 화면 재료. 목록에 없는 그룹이면 null(주소를 정리할 화면이다).
 *
 * **협업 그룹(타 팀 폴더)은 한 줄이다** — 서버가 상위 그룹을 내지 않아 경로가 자기 하나이고,
 * 구조를 고칠 수 없으므로 하위 그룹도 만들기도 없다.
 *
 * 깊이는 경로의 길이로 센다. 위쪽 그룹이 내게 보이지 않으면 실제보다 얕게 세어 3단계 그룹에
 * 「새 하위 그룹」이 보일 수 있다 — 그때는 서버가 「3단계까지만」으로 거부한다.
 */
export function resolveGroupScreen(
  groups: readonly SurveyGroupListItem[],
  groupId: string,
): GroupScreen | null {
  const path = findSurveyGroupPath(groups, groupId);
  const current = path.at(-1);
  if (!current) return null;

  const isMine = current.foreignTeamName === null;
  const mine = groups.filter((group) => group.foreignTeamName === null);
  const subgroups = isMine
    ? mine
        .filter((group) => group.parentGroupId === current.id)
        .map((group) => ({
          group,
          subgroupCount: mine.filter((child) => child.parentGroupId === group.id).length,
        }))
    : [];

  return {
    path,
    subgroups,
    canCreateSubgroup: isMine && path.length < SURVEY_GROUP_MAX_DEPTH,
  };
}
