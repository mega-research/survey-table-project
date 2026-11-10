import { describe, expect, it } from 'vitest';

import { buildSurveyGroupTree, findSurveyGroupPath } from './survey-group-tree';

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
