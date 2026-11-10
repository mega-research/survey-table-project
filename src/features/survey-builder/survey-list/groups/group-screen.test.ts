import { describe, expect, it } from 'vitest';

import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

import { resolveGroupScreen } from './group-screen';

function group(
  id: string,
  parentGroupId: string | null = null,
  over: Partial<SurveyGroupListItem> = {},
): SurveyGroupListItem {
  return { id, name: id, order: 0, parentGroupId, surveyCount: 0, foreignTeamName: null, ...over };
}

const GROUPS = [
  group('이정운', null, { surveyCount: 3 }),
  group('김서연'),
  group('2026', '이정운', { surveyCount: 18 }),
  group('2025', '이정운', { surveyCount: 12 }),
  group('상반기', '2026', { surveyCount: 7 }),
  group('하반기', '2026', { surveyCount: 6 }),
];

describe('resolveGroupScreen — 그룹 화면이 그릴 것', () => {
  it('목록에 없는 그룹은 그릴 화면이 없다', () => {
    expect(resolveGroupScreen(GROUPS, '없는 그룹')).toBeNull();
  });

  it('1단계 그룹 — 경로는 자기 하나, 하위 그룹은 폴더 줄로, 「새 하위 그룹」이 보인다', () => {
    const screen = resolveGroupScreen(GROUPS, '이정운');

    expect(screen?.path.map((g) => g.name)).toEqual(['이정운']);
    expect(screen?.subgroups.map((s) => [s.group.name, s.subgroupCount])).toEqual([
      ['2026', 2],
      ['2025', 0],
    ]);
    expect(screen?.canCreateSubgroup).toBe(true);
  });

  it('2단계 그룹 — 경로가 위 그룹부터 이어지고 「새 하위 그룹」이 보인다', () => {
    const screen = resolveGroupScreen(GROUPS, '2026');

    expect(screen?.path.map((g) => g.name)).toEqual(['이정운', '2026']);
    expect(screen?.subgroups.map((s) => s.group.name)).toEqual(['상반기', '하반기']);
    expect(screen?.canCreateSubgroup).toBe(true);
  });

  it('폴더 줄의 읽어 주는 이름은 뿌리부터의 경로다 — 다른 그룹 밑의 같은 이름과 갈린다', () => {
    const twins = [...GROUPS, group('kim-2026', '김서연', { name: '2026' })];

    expect(resolveGroupScreen(twins, '이정운')?.subgroups.map((s) => s.pathLabel)).toEqual([
      '이정운 › 2026',
      '이정운 › 2025',
    ]);
    expect(resolveGroupScreen(twins, '김서연')?.subgroups.map((s) => s.pathLabel)).toEqual([
      '김서연 › 2026',
    ]);
    expect(resolveGroupScreen(twins, '2026')?.subgroups.map((s) => s.pathLabel)).toEqual([
      '이정운 › 2026 › 상반기',
      '이정운 › 2026 › 하반기',
    ]);
  });

  it('3단계 그룹 — 「새 하위 그룹」이 보이지 않고 폴더 줄도 없다', () => {
    const screen = resolveGroupScreen(GROUPS, '상반기');

    expect(screen?.path.map((g) => g.name)).toEqual(['이정운', '2026', '상반기']);
    expect(screen?.subgroups).toEqual([]);
    expect(screen?.canCreateSubgroup).toBe(false);
  });

  it('하위 그룹을 만들지 않은 팀 — 폴더 줄이 없다', () => {
    const flat = [group('2025'), group('2026')];

    const screen = resolveGroupScreen(flat, '2025');

    expect(screen?.path.map((g) => g.name)).toEqual(['2025']);
    expect(screen?.subgroups).toEqual([]);
    // 만들 수는 있다 — 첫 하위 그룹을 여기서 만든다.
    expect(screen?.canCreateSubgroup).toBe(true);
  });

  it('협업 그룹(타 팀 폴더) — 읽기 전용이라 「새 하위 그룹」도 폴더 줄도 없다', () => {
    const withForeign = [
      ...GROUPS,
      group('A고객사 2026', null, { foreignTeamName: '연구1본부 1팀' }),
    ];

    const screen = resolveGroupScreen(withForeign, 'A고객사 2026');

    expect(screen?.path.map((g) => g.name)).toEqual(['A고객사 2026']);
    expect(screen?.subgroups).toEqual([]);
    expect(screen?.canCreateSubgroup).toBe(false);
  });
});
