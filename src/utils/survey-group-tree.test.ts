import { describe, expect, it } from 'vitest';

import {
  buildSurveyGroupTree,
  findSurveyGroupPath,
  judgeSurveyGroupRelocation,
  listSurveyGroupPathLabels,
  listSurveyGroupRelocationTargets,
} from './survey-group-tree';

interface Row {
  id: string;
  name: string;
  parentGroupId: string | null;
}

const row = (id: string, parentGroupId: string | null = null): Row => ({
  id,
  name: id,
  parentGroupId,
});

/** 트리를 「이름(깊이)」 들여쓰기 줄로 편다 — 모양을 한눈에 비교하려고. */
function outline(nodes: ReturnType<typeof buildSurveyGroupTree<Row>>): string[] {
  return nodes.flatMap((node) => [
    `${'  '.repeat(node.depth - 1)}${node.group.name}(${node.depth})`,
    ...outline(node.children),
  ]);
}

describe('buildSurveyGroupTree — 평평한 목록을 트리로', () => {
  it('상위 그룹이 없는 줄은 뿌리이고 깊이는 1부터 센다', () => {
    const tree = buildSurveyGroupTree([row('이정운'), row('김서연')]);

    expect(outline(tree)).toEqual(['이정운(1)', '김서연(1)']);
    expect(tree.every((node) => node.children.length === 0)).toBe(true);
  });

  it('3단계까지 부모 밑에 매단다', () => {
    const tree = buildSurveyGroupTree([
      row('이정운'),
      row('2026', '이정운'),
      row('상반기', '2026'),
      row('하반기', '2026'),
      row('2025', '이정운'),
    ]);

    expect(outline(tree)).toEqual([
      '이정운(1)',
      '  2026(2)',
      '    상반기(3)',
      '    하반기(3)',
      '  2025(2)',
    ]);
  });

  it('형제의 순서는 목록에 온 순서 그대로다 — 자식이 부모보다 먼저 와도 같다', () => {
    const tree = buildSurveyGroupTree([
      row('하반기', '2026'),
      row('2026', '이정운'),
      row('상반기', '2026'),
      row('이정운'),
    ]);

    expect(outline(tree)).toEqual(['이정운(1)', '  2026(2)', '    하반기(3)', '    상반기(3)']);
  });

  it('부모가 목록에 없는 줄은 뿌리로 둔다', () => {
    // 상위 그룹이 내게 보이지 않을 때다 — 매달 자리가 없다고 줄을 버리면 볼 수 있는 폴더가 사라진다.
    const tree = buildSurveyGroupTree([row('이정운'), row('2026', '안 보이는 그룹')]);

    expect(outline(tree)).toEqual(['이정운(1)', '2026(1)']);
  });

  it('서로를 부모로 가리키는 줄이 와도 끝나고, 한 줄도 잃지 않는다', () => {
    // DB 가 순환을 막지만 화면 함수가 목록 하나에 멈춰 서면 안 된다.
    const tree = buildSurveyGroupTree([row('가', '나'), row('나', '가'), row('다')]);

    const names = outline(tree).map((line) => line.trim().replace(/\(\d\)$/, ''));
    expect(names.sort()).toEqual(['가', '나', '다']);
  });
});

describe('findSurveyGroupPath — 위쪽 경로', () => {
  const groups = [row('이정운'), row('2026', '이정운'), row('상반기', '2026'), row('김서연')];

  it('뿌리부터 지목한 그룹까지 차례로 돌려준다', () => {
    expect(findSurveyGroupPath(groups, '상반기').map((g) => g.name)).toEqual([
      '이정운',
      '2026',
      '상반기',
    ]);
  });

  it('최상위 그룹의 경로는 자기 하나다', () => {
    expect(findSurveyGroupPath(groups, '김서연').map((g) => g.name)).toEqual(['김서연']);
  });

  it('목록에 없는 그룹은 빈 경로다', () => {
    expect(findSurveyGroupPath(groups, '없는 그룹')).toEqual([]);
  });

  it('부모가 목록에 없으면 거기서 멈춘다', () => {
    const orphaned = [row('2026', '안 보이는 그룹'), row('상반기', '2026')];

    expect(findSurveyGroupPath(orphaned, '상반기').map((g) => g.name)).toEqual(['2026', '상반기']);
  });

  it('순환하는 목록에서도 끝난다', () => {
    const cyclic = [row('가', '나'), row('나', '가')];

    expect(findSurveyGroupPath(cyclic, '가').length).toBeLessThanOrEqual(2);
  });
});

/**
 * 옮길 수 있는 자리 (설문 그룹 중첩 티켓 05) — 옮기기 창·그룹 관리 창이 자리를 끄는 데 쓰고
 * 서버가 잠금 아래서 같은 함수로 다시 판정한다.
 *
 *   이정운 ─ 2026 ─ 상반기 · 하반기
 *          ─ 2025
 *   김서연
 */
describe('judgeSurveyGroupRelocation — 이 그룹을 저 자리로 옮길 수 있는가', () => {
  const groups = [
    row('이정운'),
    row('2026', '이정운'),
    row('상반기', '2026'),
    row('하반기', '2026'),
    row('2025', '이정운'),
    row('김서연'),
  ];
  const judge = (groupId: string, target: string | null) =>
    judgeSurveyGroupRelocation(groups, groupId, target, 3);

  it('다른 그룹 밑과 최상위로 옮길 수 있다', () => {
    expect(judge('2025', '김서연')).toBeNull();
    expect(judge('2025', '2026')).toBeNull();
    expect(judge('2025', null)).toBeNull();
    expect(judge('상반기', '김서연')).toBeNull();
  });

  it('자기 자신 밑으로는 옮길 수 없다', () => {
    expect(judge('2026', '2026')).toBe('self');
  });

  it('자기 하위 그룹 밑으로는 옮길 수 없다 — 몇 단 아래든', () => {
    expect(judge('이정운', '2026')).toBe('descendant');
    expect(judge('이정운', '상반기')).toBe('descendant');
    expect(judge('2026', '하반기')).toBe('descendant');
  });

  it('지금 부모는 「지금 여기」다 — 최상위 그룹에게는 최상위가 그 자리다', () => {
    expect(judge('2025', '이정운')).toBe('current');
    expect(judge('김서연', null)).toBe('current');
  });

  it('새 상위의 깊이 + 옮기는 가지의 높이가 3을 넘으면 옮길 수 없다', () => {
    // 2025(높이 1)를 3단계 그룹 밑으로 → 4단계.
    expect(judge('2025', '상반기')).toBe('too_deep');
    // 2026(높이 2)을 2단계 그룹 밑으로 → 하위가 4단계.
    expect(judge('2026', '2025')).toBe('too_deep');
    // 이정운(높이 3)은 어느 그룹 밑으로도 못 간다.
    expect(judge('이정운', '김서연')).toBe('too_deep');
    // 2026(높이 2)을 1단계 그룹 밑으로 → 꼭 3단계.
    expect(judge('2026', '김서연')).toBeNull();
  });

  it('목록에 없는 그룹은 옮기는 쪽이든 새 상위든 판정하지 않는다', () => {
    expect(judge('없는 그룹', null)).toBe('missing');
    expect(judge('2025', '없는 그룹')).toBe('missing');
  });

  it('서로를 부모로 가리키는 목록에서도 끝난다', () => {
    const cyclic = [row('가', '나'), row('나', '가'), row('다')];

    expect(() => judgeSurveyGroupRelocation(cyclic, '가', '다', 3)).not.toThrow();
  });
});

describe('listSurveyGroupRelocationTargets — 옮기기 창이 그릴 자리', () => {
  const groups = [
    row('이정운'),
    row('2026', '이정운'),
    row('상반기', '2026'),
    row('하반기', '2026'),
    row('2025', '이정운'),
    row('김서연'),
  ];
  const lines = (groupId: string) =>
    listSurveyGroupRelocationTargets(groups, groupId, 3).targets.map(
      (target) =>
        `${'  '.repeat(target.depth - 1)}${target.group.name}${target.blocked ? ` [${target.blocked}]` : ''}`,
    );

  it('자기 자신과 그 하위는 목록에 없고, 나머지는 트리 순서로 선다', () => {
    expect(lines('2026')).toEqual(['이정운 [current]', '  2025 [too_deep]', '김서연']);
  });

  it('지금 부모와 깊이가 넘는 자리는 사유와 함께 꺼져 있다', () => {
    expect(lines('2025')).toEqual([
      '이정운 [current]',
      '  2026',
      '    상반기 [too_deep]',
      '    하반기 [too_deep]',
      '김서연',
    ]);
  });

  it('「최상위로」는 최상위 그룹에게만 「지금 여기」다', () => {
    expect(listSurveyGroupRelocationTargets(groups, '2025', 3).root.blocked).toBeNull();
    expect(listSurveyGroupRelocationTargets(groups, '김서연', 3).root.blocked).toBe('current');
  });

  it('목록에 없는 그룹이면 고를 자리가 없다', () => {
    const listed = listSurveyGroupRelocationTargets(groups, '없는 그룹', 3);

    expect(listed.targets).toEqual([]);
    expect(listed.root.blocked).toBe('missing');
  });
});

describe('listSurveyGroupPathLabels — 읽어 주는 이름을 경로로', () => {
  const named = (id: string, name: string, parentGroupId: string | null = null): Row => ({
    id,
    name,
    parentGroupId,
  });

  it('최상위 그룹은 이름 그대로, 하위 그룹은 뿌리부터의 경로다', () => {
    const labels = listSurveyGroupPathLabels([
      named('lee', '이정운'),
      named('lee-2026', '2026', 'lee'),
      named('lee-2026-h1', '상반기', 'lee-2026'),
    ]);

    expect(labels.get('lee')).toBe('이정운');
    expect(labels.get('lee-2026')).toBe('이정운 › 2026');
    expect(labels.get('lee-2026-h1')).toBe('이정운 › 2026 › 상반기');
  });

  it('서로 다른 상위 그룹 밑의 같은 이름이 갈린다', () => {
    const labels = listSurveyGroupPathLabels([
      named('lee', '이정운'),
      named('kim', '김서연'),
      named('lee-2025', '2025', 'lee'),
      named('kim-2025', '2025', 'kim'),
    ]);

    expect(labels.get('lee-2025')).toBe('이정운 › 2025');
    expect(labels.get('kim-2025')).toBe('김서연 › 2025');
  });

  it('상위 그룹이 목록에 없는 줄은 이름 그대로다 — 트리가 뿌리로 두는 줄이다', () => {
    const labels = listSurveyGroupPathLabels([named('orphan', '2025', 'hidden')]);

    expect(labels.get('orphan')).toBe('2025');
  });
});
