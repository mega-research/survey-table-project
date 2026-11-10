import { describe, expect, it } from 'vitest';

import { partitionSurveyList } from '@/utils/survey-list-groups';

const row = (id: string, listGroup: string | null) => ({ id, listGroup });

describe('partitionSurveyList', () => {
  it('묶음이 없으면 전부 묶이지 않은 설문이다', () => {
    const rows = [row('a', null), row('b', null)];
    expect(partitionSurveyList(rows)).toEqual({ groups: [], ungrouped: rows });
  });

  it('묶음은 처음 나오는 순서로, 안의 설문은 목록 순서로 모은다', () => {
    const rows = [row('a', '나'), row('b', null), row('c', '가'), row('d', '나'), row('e', null)];
    const { groups, ungrouped } = partitionSurveyList(rows);
    expect(groups.map((g) => [g.name, g.surveys.map((s) => s.id)])).toEqual([
      ['나', ['a', 'd']],
      ['가', ['c']],
    ]);
    expect(ungrouped.map((s) => s.id)).toEqual(['b', 'e']);
  });
});
