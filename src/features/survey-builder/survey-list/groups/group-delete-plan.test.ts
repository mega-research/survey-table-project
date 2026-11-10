import { describe, expect, it } from 'vitest';

import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

import {
  describeGroupDelete,
  describeGroupDeleteBlocked,
  planGroupDelete,
  resolveGroupFallbackHref,
} from './group-delete-plan';

function group(
  id: string,
  name: string,
  parentGroupId: string | null = null,
  extra: Partial<SurveyGroupListItem> = {},
): SurveyGroupListItem {
  return { id, name, order: 0, parentGroupId, surveyCount: 7, foreignTeamName: null, ...extra };
}

const LEE = group('lee', '이정운');
const Y2026 = group('2026', '2026', 'lee');
const H1 = group('h1', '상반기', '2026');
const H2 = group('h2', '하반기', '2026');
const KIM = group('kim', '김서연');
const GROUPS = [LEE, Y2026, H1, H2, KIM];

describe('planGroupDelete — 지우면 무엇이 어디로 올라가는가', () => {
  it('하위 그룹이 있는 2단계 그룹 — 올라갈 자리는 부모, 올라가는 것은 바로 밑 하위 그룹', () => {
    expect(planGroupDelete(GROUPS, Y2026)).toEqual({
      destination: { kind: 'group', name: '이정운' },
      subgroupNames: ['상반기', '하반기'],
    });
  });

  it('최상위 그룹 — 하위 그룹은 최상위로, 설문은 미분류로 갈 자리다', () => {
    expect(planGroupDelete(GROUPS, LEE)).toEqual({
      destination: { kind: 'root' },
      subgroupNames: ['2026'],
    });
  });

  it('부모가 목록에 없으면 이름 없이 「한 단계 위」라고만 안다', () => {
    expect(planGroupDelete([Y2026, H1], Y2026).destination).toEqual({ kind: 'group', name: null });
  });

  it('남의 팀 폴더는 하위 그룹으로 세지 않는다', () => {
    const foreign = group('x', '협업', '2026', { foreignTeamName: '연구2팀' });

    expect(planGroupDelete([...GROUPS, foreign], Y2026).subgroupNames).toEqual(['상반기', '하반기']);
  });
});

describe('describeGroupDelete — 삭제 확인 문구', () => {
  it('올라갈 자리의 이름과 하위 그룹 이름을 적는다', () => {
    expect(describeGroupDelete(planGroupDelete(GROUPS, Y2026))).toBe(
      '하위 그룹 2개(상반기 · 하반기)와 여기에 직접 담긴 설문이 한 단계 위 「이정운」 그룹으로 올라갑니다. 설문은 삭제되지 않습니다.',
    );
  });

  it('최상위 그룹이면 설문이 미분류로 간다고 적는다', () => {
    expect(describeGroupDelete(planGroupDelete(GROUPS, LEE))).toBe(
      '하위 그룹 1개(2026)는 최상위 그룹이 되고, 여기에 직접 담긴 설문은 미분류로 돌아갑니다. 설문은 삭제되지 않습니다.',
    );
    expect(describeGroupDelete(planGroupDelete(GROUPS, KIM))).toBe(
      '여기에 직접 담긴 설문은 미분류로 돌아갑니다. 설문은 삭제되지 않습니다.',
    );
  });

  it('하위 그룹이 보이지 않으면 설문만 말한다', () => {
    expect(describeGroupDelete(planGroupDelete(GROUPS, H1))).toBe(
      '여기에 직접 담긴 설문이 한 단계 위 「2026」 그룹으로 올라갑니다. 설문은 삭제되지 않습니다.',
    );
  });

  it('설문 건수는 어디에도 적지 않는다 — 내가 볼 수 없는 설문이 있을 수 있다', () => {
    for (const target of GROUPS) {
      expect(describeGroupDelete(planGroupDelete(GROUPS, target))).not.toMatch(/설문 ?\d|\d+ ?건/);
    }
  });

  it('하위 그룹이 많으면 셋까지만 이름을 적는다', () => {
    const many = ['1분기', '2분기', '3분기', '4분기', '기타'].map((name, index) =>
      group(`q${index}`, name, 'kim'),
    );

    expect(describeGroupDelete(planGroupDelete([KIM, ...many], KIM))).toContain(
      '하위 그룹 5개(1분기 · 2분기 · 3분기 외 2개)는',
    );
  });
});

describe('describeGroupDeleteBlocked — 이름이 겹쳐 막혔을 때', () => {
  it('겹치는 이름과 어디에서 겹치는지, 고칠 방법을 적는다', () => {
    expect(describeGroupDeleteBlocked(planGroupDelete(GROUPS, Y2026), ['상반기'])).toBe(
      '「이정운」에 이미 「상반기」 그룹이 있어 하위 그룹을 올릴 수 없습니다. 둘 중 하나의 이름을 바꾼 뒤 다시 삭제하세요.',
    );
  });

  it('최상위 그룹이면 최상위에서 겹친다고 적는다', () => {
    expect(describeGroupDeleteBlocked(planGroupDelete(GROUPS, LEE), ['2026', '2025'])).toBe(
      '최상위에 이미 「2026」 · 「2025」 그룹이 있어 하위 그룹을 올릴 수 없습니다. 겹치는 이름을 바꾼 뒤 다시 삭제하세요.',
    );
  });
});

describe('resolveGroupFallbackHref — 보고 있던 그룹이 사라지면 어디로 가는가', () => {
  const PATH = [LEE, Y2026, H1];

  it('바로 위 그룹이 남아 있으면 그 그룹 화면으로 간다', () => {
    expect(resolveGroupFallbackHref(PATH, [LEE, Y2026, KIM])).toBe('/surveys?group=2026');
  });

  it('위 그룹도 함께 사라졌으면 남아 있는 가장 가까운 위 그룹으로 간다', () => {
    expect(resolveGroupFallbackHref(PATH, [LEE, KIM])).toBe('/surveys?group=lee');
  });

  it('최상위 그룹이었거나 위쪽이 하나도 남지 않았으면 설문 목록으로 간다', () => {
    expect(resolveGroupFallbackHref([KIM], [LEE])).toBe('/surveys');
    expect(resolveGroupFallbackHref(PATH, [KIM])).toBe('/surveys');
  });

  it('경로를 본 적이 없으면(처음부터 없는 주소) 설문 목록으로 간다', () => {
    expect(resolveGroupFallbackHref([], GROUPS)).toBe('/surveys');
  });
});
