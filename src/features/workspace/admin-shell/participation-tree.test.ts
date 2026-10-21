import { describe, expect, it } from 'vitest';

import type { SurveyListItem } from '@/shared/contracts/survey-builder-io';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

import { buildParticipationTree } from './participation-tree';

const TEAM_5 = '55555555-5555-4555-8555-555555555555';
const TEAM_1 = '11111111-1111-4111-8111-111111111111';

function survey(
  over: Partial<SurveyListItem>,
): Pick<SurveyListItem, 'id' | 'teamId' | 'teamName' | 'surveyGroupId'> {
  return {
    id: crypto.randomUUID(),
    teamId: TEAM_5,
    teamName: '연구3본부 5팀',
    surveyGroupId: null,
    ...over,
  };
}

function group(id: string, name: string, order: number): SurveyGroupListItem {
  return { id, name, order, surveyCount: 0, foreignTeamName: '연구3본부 5팀' };
}

describe('buildParticipationTree', () => {
  it('소유 팀별로 묶고 팀 이름순으로 세운다', () => {
    const tree = buildParticipationTree(
      [
        survey({ teamId: TEAM_5, teamName: '연구3본부 5팀' }),
        survey({ teamId: TEAM_1, teamName: '연구1본부 1팀' }),
        survey({ teamId: TEAM_5, teamName: '연구3본부 5팀' }),
      ],
      [],
    );
    expect(tree.map((t) => [t.teamName, t.surveyCount])).toEqual([
      ['연구1본부 1팀', 1],
      ['연구3본부 5팀', 2],
    ]);
  });

  it('팀 안에서 폴더는 그룹 목록 순서대로, 그룹 밖 설문은 미분류 수로 센다', () => {
    const tree = buildParticipationTree(
      [
        survey({ surveyGroupId: 'g-2025' }),
        survey({ surveyGroupId: 'g-2026' }),
        survey({ surveyGroupId: 'g-2026' }),
        survey({ surveyGroupId: null }),
      ],
      [group('g-2026', '2026', 0), group('g-2025', '2025', 1)],
    );
    expect(tree).toHaveLength(1);
    expect(tree[0]?.folders).toEqual([
      { groupId: 'g-2026', name: '2026', surveyCount: 2 },
      { groupId: 'g-2025', name: '2025', surveyCount: 1 },
    ]);
    expect(tree[0]?.ungroupedCount).toBe(1);
    expect(tree[0]?.surveyCount).toBe(4);
  });

  it('그룹 목록에 없는 그룹 id 는 미분류로 센다 — 이름 없는 폴더를 만들지 않는다', () => {
    const tree = buildParticipationTree([survey({ surveyGroupId: 'g-missing' })], []);
    expect(tree[0]?.folders).toEqual([]);
    expect(tree[0]?.ungroupedCount).toBe(1);
  });

  it('배치 대기 설문(팀 없음)은 세지 않는다', () => {
    expect(buildParticipationTree([survey({ teamId: null, teamName: null })], [])).toEqual([]);
  });
});
