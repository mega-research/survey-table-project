// 카드 케밥 「그룹 이동」 메뉴의 줄 — 순수 계산 (설문 그룹 중첩 티켓 04).
//
// 메뉴는 그룹을 들여쓰기 트리로 보여 주고 어느 단계든 고른다. 트리 묶기 자체는 공용
// (`@/utils/survey-group-tree`)이고, 여기는 이 메뉴의 규칙만 둔다 — 옮길 자리는 내 팀 그룹뿐이고,
// 메뉴는 펼침 없이 한 줄씩 늘어놓으므로 트리를 위에서 아래로 편 목록이 필요하다.
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';
import {
  type SurveyGroupTreeNode,
  buildSurveyGroupTree,
  listSurveyGroupPathLabels,
} from '@/utils/survey-group-tree';

export interface GroupMoveOption {
  group: SurveyGroupListItem;
  /** 메뉴 안에서의 단 — 맨 위가 1. 들여쓰기의 기준이다. */
  depth: number;
  /** 뿌리부터 자기까지의 이름(「이정운 › 2026 › 상반기」) — 같은 이름의 하위 그룹을 가른다. */
  pathLabel: string;
}

/**
 * 그룹 목록 → 메뉴에 늘어놓을 줄. 하위 그룹은 부모 바로 아래에 온다(형제 순서는 서버 순서).
 *
 * **협업 그룹(타 팀 폴더)은 뺀다** — 보이는 폴더일 뿐 넣을 수 있는 폴더가 아니다. 설문은 소유
 * 팀의 그룹에만 담기고(팀이 다르면 서버가 거부한다), 그 팀의 구조는 그 팀 사람만 만진다.
 *
 * 하위 그룹을 만들지 않은 팀은 모든 줄이 1단이라 전과 같은 한 단 목록이 된다.
 */
export function listGroupMoveOptions(groups: readonly SurveyGroupListItem[]): GroupMoveOption[] {
  const mine = groups.filter((group) => group.foreignTeamName === null);
  const options: GroupMoveOption[] = [];
  // 경로 문구는 공용 한 벌이다 — 옮기기 창 · 그룹 관리 창 · 사이드바 · 폴더 줄이 같은 말로 읽는다.
  const pathLabels = listSurveyGroupPathLabels(mine);

  function walk(nodes: readonly SurveyGroupTreeNode<SurveyGroupListItem>[]) {
    for (const node of nodes) {
      const pathLabel = pathLabels.get(node.group.id) ?? node.group.name;
      options.push({ group: node.group, depth: node.depth, pathLabel });
      walk(node.children);
    }
  }
  walk(buildSurveyGroupTree(mine));
  return options;
}
