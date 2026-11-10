import { describe, expect, it } from 'vitest';

import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

import { listGroupMoveOptions } from './group-move-options';

function group(
  id: string,
  name: string,
  parentGroupId: string | null,
  over: Partial<SurveyGroupListItem> = {},
): SurveyGroupListItem {
  return { id, name, order: 0, parentGroupId, surveyCount: 0, foreignTeamName: null, ...over };
}

/** 줄을 「깊이:이름」으로 — 순서와 들여쓰기를 한눈에 본다. */
function outline(groups: SurveyGroupListItem[]): string[] {
  return listGroupMoveOptions(groups).map((option) => `${option.depth}:${option.group.name}`);
}

describe('「그룹 이동」 메뉴의 줄', () => {
  it('하위 그룹을 부모 바로 아래에, 깊이와 함께 늘어놓는다', () => {
    // 서버 목록은 평평하다 — 부모·자식이 떨어져 와도 가지째 묶인다.
    const groups = [
      group('lee', '이정운', null),
      group('kim', '김서연', null),
      group('lee-2026', '2026', 'lee'),
      group('lee-2025', '2025', 'lee'),
      group('kim-2025', '2025', 'kim'),
      group('lee-2026-h1', '상반기', 'lee-2026'),
    ];

    expect(outline(groups)).toEqual([
      '1:이정운',
      '2:2026',
      '3:상반기',
      '2:2025',
      '1:김서연',
      '2:2025',
    ]);
  });

  it('하위 그룹이 없는 팀은 전과 같은 한 단 목록이다', () => {
    const groups = [group('a', '2025', null), group('b', '2026 상반기', null)];

    expect(outline(groups)).toEqual(['1:2025', '1:2026 상반기']);
  });

  it('경로는 뿌리부터 자기까지다 — 같은 이름의 줄을 가른다', () => {
    const groups = [
      group('lee', '이정운', null),
      group('kim', '김서연', null),
      group('lee-2025', '2025', 'lee'),
      group('kim-2025', '2025', 'kim'),
    ];

    const paths = listGroupMoveOptions(groups).map((option) => option.pathLabel);

    expect(paths).toEqual(['이정운', '이정운 › 2025', '김서연', '김서연 › 2025']);
  });

  it('협업 그룹(타 팀 폴더)은 옮길 자리가 아니다', () => {
    const groups = [
      group('mine', '내 그룹', null),
      group('theirs', 'A고객사 2026', null, { foreignTeamName: '연구1본부 1팀' }),
    ];

    expect(outline(groups)).toEqual(['1:내 그룹']);
  });

  it('위쪽 그룹이 목록에 없는 줄도 버리지 않고 맨 위 단에 둔다', () => {
    const groups = [group('orphan', '상반기', 'hidden-parent'), group('top', '이정운', null)];

    expect(outline(groups)).toEqual(['1:상반기', '1:이정운']);
  });

  it('그룹이 없으면 줄도 없다', () => {
    expect(listGroupMoveOptions([])).toEqual([]);
  });
});
