// 실사팀 사이드바의 참여 트리 — 순수 계산 (0139, .pen 사이드바_협업그룹_시안 「방식 A'」).
//
// 본문 목록과 **같은 응답**(surveyBuilder.read.list)에서 센다 — 사이드바가 따로 세면 「5팀 3」
// 인데 그 팀 화면에 카드가 2장인 어긋남이 생긴다. 폴더 이름만 그룹 목록에서 빌린다.
import type { SurveyListItem } from '@/shared/contracts/survey-builder-io';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

export interface ParticipationFolder {
  groupId: string;
  name: string;
  surveyCount: number;
}

export interface ParticipationTeam {
  teamId: string;
  teamName: string;
  surveyCount: number;
  folders: ParticipationFolder[];
  /** 그룹에 안 든 설문 수 — 사이드바의 「미분류」 줄. */
  ungroupedCount: number;
}

/**
 * 보이는 설문을 소유 팀 → 폴더로 묶는다.
 *
 * 그룹 목록에 이름이 없는 그룹 id 는 미분류로 센다 — 이름 없는 폴더를 그리면 누를 수 없는
 * 줄이 생긴다(그룹 화면은 그룹 목록에 있는 id 만 연다). 배치 대기 설문(팀 없음)은 「소유 팀」이
 * 없으므로 세지 않는다.
 */
export function buildParticipationTree(
  surveys: readonly Pick<SurveyListItem, 'teamId' | 'teamName' | 'surveyGroupId'>[],
  groups: readonly SurveyGroupListItem[],
): ParticipationTeam[] {
  const groupOrder = new Map(groups.map((g, index) => [g.id, { name: g.name, index }]));
  const byTeam = new Map<
    string,
    { teamName: string; total: number; ungrouped: number; folders: Map<string, number> }
  >();

  for (const s of surveys) {
    if (!s.teamId) continue;
    const team = byTeam.get(s.teamId) ?? {
      teamName: s.teamName ?? '',
      total: 0,
      ungrouped: 0,
      folders: new Map<string, number>(),
    };
    team.total += 1;
    if (s.surveyGroupId && groupOrder.has(s.surveyGroupId)) {
      team.folders.set(s.surveyGroupId, (team.folders.get(s.surveyGroupId) ?? 0) + 1);
    } else {
      team.ungrouped += 1;
    }
    byTeam.set(s.teamId, team);
  }

  return [...byTeam.entries()]
    .map(([teamId, t]) => ({
      teamId,
      teamName: t.teamName,
      surveyCount: t.total,
      ungroupedCount: t.ungrouped,
      folders: [...t.folders.entries()]
        .map(([groupId, surveyCount]) => ({
          groupId,
          name: groupOrder.get(groupId)!.name,
          surveyCount,
          index: groupOrder.get(groupId)!.index,
        }))
        .sort((a, b) => a.index - b.index)
        .map(({ groupId, name, surveyCount }) => ({ groupId, name, surveyCount })),
    }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName, 'ko'));
}
