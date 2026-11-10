import { describe, expect, it } from 'vitest';

import { applyGroupSiblingOrder, planGroupSiblingReorder } from './group-reorder';

/**
 * 시안 G3 의 구조다. 목록은 서버가 주는 대로 평평하고, 형제의 순서는 목록에 온 순서다.
 *
 *   이정운 ─ 2026 ─ 상반기 · 하반기
 *          ─ 2025
 *          ─ 2024
 *   김서연 ─ 2026(같은 이름, 다른 부모)
 *   기타
 */
const row = (id: string, parentGroupId: string | null = null) => ({ id, parentGroupId });
const GROUPS = [
  row('lee'),
  row('lee-2026', 'lee'),
  row('h1', 'lee-2026'),
  row('h2', 'lee-2026'),
  row('lee-2025', 'lee'),
  row('lee-2024', 'lee'),
  row('kim'),
  row('kim-2026', 'kim'),
  row('etc'),
];

describe('planGroupSiblingReorder — 끌어 놓은 줄이 보낼 순서', () => {
  it('같은 부모 안에서 끌면 그 부모와, 그 부모의 형제 id 만 새 순서로 낸다', () => {
    expect(planGroupSiblingReorder(GROUPS, 'lee-2024', 'lee-2026')).toEqual({
      parentGroupId: 'lee',
      orderedGroupIds: ['lee-2024', 'lee-2026', 'lee-2025'],
    });
  });

  it('아래로 끌면 놓은 줄 뒤에 선다', () => {
    expect(planGroupSiblingReorder(GROUPS, 'lee-2026', 'lee-2025')).toEqual({
      parentGroupId: 'lee',
      orderedGroupIds: ['lee-2025', 'lee-2026', 'lee-2024'],
    });
  });

  it('최상위끼리는 부모가 없다(null) — 하위 그룹 id 는 섞이지 않는다', () => {
    expect(planGroupSiblingReorder(GROUPS, 'etc', 'lee')).toEqual({
      parentGroupId: null,
      orderedGroupIds: ['etc', 'lee', 'kim'],
    });
  });

  it('다른 부모의 줄 위에는 놓이지 않는다', () => {
    // 같은 단계라도 부모가 다르면 형제가 아니다.
    expect(planGroupSiblingReorder(GROUPS, 'lee-2025', 'kim-2026')).toBeNull();
    // 부모와 자식, 최상위와 하위.
    expect(planGroupSiblingReorder(GROUPS, 'lee-2026', 'lee')).toBeNull();
    expect(planGroupSiblingReorder(GROUPS, 'h1', 'lee-2025')).toBeNull();
    expect(planGroupSiblingReorder(GROUPS, 'etc', 'h2')).toBeNull();
  });

  it('제자리에 놓거나 목록에 없는 줄이면 보낼 것이 없다', () => {
    expect(planGroupSiblingReorder(GROUPS, 'lee-2025', 'lee-2025')).toBeNull();
    expect(planGroupSiblingReorder(GROUPS, 'gone', 'lee')).toBeNull();
    expect(planGroupSiblingReorder(GROUPS, 'lee', 'gone')).toBeNull();
  });
});

describe('applyGroupSiblingOrder — 저장을 기다리는 동안 미리 그리는 순서', () => {
  const ids = (groups: readonly { id: string }[]) => groups.map((g) => g.id);

  it('그 부모의 형제만 새 순서로 놓고 다른 줄의 자리는 그대로 둔다', () => {
    const next = applyGroupSiblingOrder(GROUPS, 'lee', ['lee-2024', 'lee-2026', 'lee-2025']);

    expect(ids(next)).toEqual([
      'lee',
      'lee-2024',
      'h1',
      'h2',
      'lee-2026',
      'lee-2025',
      'kim',
      'kim-2026',
      'etc',
    ]);
  });

  it('최상위끼리의 순서도 같은 방식이다', () => {
    const next = applyGroupSiblingOrder(GROUPS, null, ['etc', 'lee', 'kim']);

    expect(ids(next).filter((id) => ['lee', 'kim', 'etc'].includes(id))).toEqual([
      'etc',
      'lee',
      'kim',
    ]);
  });

  it('그 사이 형제가 늘거나 줄었으면 옛 순서를 씌우지 않는다', () => {
    // 다른 팀원이 「이정운」 밑에 그룹을 하나 더 만들었다 — 옛 순서를 씌우면 새 그룹이 사라진다.
    const grown = [...GROUPS, row('lee-2023', 'lee')];
    expect(applyGroupSiblingOrder(grown, 'lee', ['lee-2024', 'lee-2026', 'lee-2025'])).toBe(grown);

    // 형제 하나가 다른 자리로 옮겨 갔다.
    const moved = GROUPS.map((g) => (g.id === 'lee-2024' ? row('lee-2024', 'kim') : g));
    expect(applyGroupSiblingOrder(moved, 'lee', ['lee-2024', 'lee-2026', 'lee-2025'])).toBe(moved);
  });
});
