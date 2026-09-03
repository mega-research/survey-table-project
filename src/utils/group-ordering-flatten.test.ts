import { describe, expect, it } from 'vitest';

import type { QuestionGroup } from '@/types/survey';

import { flattenGroupTree } from './group-ordering';

const g = (id: string, name: string, order: number, parentGroupId?: string): QuestionGroup =>
  ({
    id,
    surveyId: 's1',
    name,
    order,
    ...(parentGroupId ? { parentGroupId } : {}),
  }) as QuestionGroup;

describe('flattenGroupTree — 그룹 트리를 깊이 우선·order 순으로 평탄화', () => {
  it('3단계 이상도 부모 바로 아래에 depth 와 함께 나온다', () => {
    const groups = [
      g('b', 'B', 1),
      g('a', 'A', 0),
      g('a2', 'A-2', 1, 'a'),
      g('a1', 'A-1', 0, 'a'),
      g('a1x', 'A-1-x', 0, 'a1'),
      g('a1x9', 'A-1-x-9', 0, 'a1x'),
    ];
    expect(flattenGroupTree(groups).map(({ group, depth }) => `${depth}:${group.id}`)).toEqual([
      '0:a',
      '1:a1',
      '2:a1x',
      '3:a1x9',
      '1:a2',
      '0:b',
    ]);
  });

  it('부모가 없는 참조(고아)는 무시하고 빈 목록은 빈 배열', () => {
    expect(flattenGroupTree([g('x', 'X', 0, 'missing')])).toEqual([]);
    expect(flattenGroupTree([])).toEqual([]);
  });
});
