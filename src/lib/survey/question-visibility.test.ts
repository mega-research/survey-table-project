import { describe, expect, it } from 'vitest';

import {
  resolveVisibleQuestionIds,
  stripHiddenQuestionValues,
} from '@/lib/survey/question-visibility';
import type { Question, QuestionGroup } from '@/types/survey';

/** value-match 조건 하나짜리 문항 픽스처. */
function q(id: string, opts: { on?: { source: string; values: string[] }; groupId?: string } = {}): Question {
  return {
    id,
    type: 'radio',
    title: id,
    required: false,
    order: 0,
    ...(opts.groupId ? { groupId: opts.groupId } : {}),
    ...(opts.on
      ? {
          displayCondition: {
            logicType: 'AND' as const,
            conditions: [
              {
                id: `${id}-c1`,
                enabled: true,
                logicType: 'AND' as const,
                conditionType: 'value-match' as const,
                sourceQuestionId: opts.on.source,
                requiredValues: opts.on.values,
              },
            ],
          },
        }
      : {}),
  } as unknown as Question;
}

/** 표시 조건·상위 그룹을 얹은 그룹 픽스처. */
function group(
  id: string,
  opts: { on?: { source: string; values: string[] }; parentGroupId?: string } = {},
): QuestionGroup {
  return {
    id,
    name: id,
    order: 0,
    ...(opts.parentGroupId ? { parentGroupId: opts.parentGroupId } : {}),
    ...(opts.on
      ? {
          displayCondition: {
            logicType: 'AND' as const,
            conditions: [
              {
                id: `${id}-c1`,
                enabled: true,
                logicType: 'AND' as const,
                conditionType: 'value-match' as const,
                sourceQuestionId: opts.on.source,
                requiredValues: opts.on.values,
              },
            ],
          },
        }
      : {}),
  } as unknown as QuestionGroup;
}

describe('resolveVisibleQuestionIds', () => {
  it('조건이 없는 문항은 항상 표시된다', () => {
    const qs = [q('a'), q('b')];
    expect(resolveVisibleQuestionIds(qs, {})).toEqual(new Set(['a', 'b']));
  });

  it('조건이 맞지 않으면 숨는다', () => {
    const qs = [q('a'), q('b', { on: { source: 'a', values: ['yes'] } })];
    expect(resolveVisibleQuestionIds(qs, { a: 'no' })).toEqual(new Set(['a']));
  });

  it('상류가 숨으면 그 값에 기대던 하류도 숨는다 — 2단 연쇄', () => {
    const qs = [
      q('a'),
      q('b', { on: { source: 'a', values: ['yes'] } }),
      q('c', { on: { source: 'b', values: ['x'] } }),
    ];
    // b 는 값이 있지만 a 가 어긋나 숨는다 → b 의 값이 죽어 c 도 숨어야 한다
    const visible = resolveVisibleQuestionIds(qs, { a: 'no', b: 'x' });
    expect(visible).toEqual(new Set(['a']));
  });

  it('3단 연쇄도 끝까지 전파된다', () => {
    const qs = [
      q('a'),
      q('b', { on: { source: 'a', values: ['yes'] } }),
      q('c', { on: { source: 'b', values: ['x'] } }),
      q('d', { on: { source: 'c', values: ['y'] } }),
    ];
    expect(resolveVisibleQuestionIds(qs, { a: 'no', b: 'x', c: 'y' })).toEqual(new Set(['a']));
  });

  it('서로를 참조하는 순환 조건에서도 종료한다', () => {
    const qs = [
      q('a', { on: { source: 'b', values: ['x'] } }),
      q('b', { on: { source: 'a', values: ['y'] } }),
    ];
    expect(resolveVisibleQuestionIds(qs, {})).toEqual(new Set());
  });

  it('그룹 조건이 어긋나면 그 그룹의 문항이 모두 숨는다', () => {
    const groups: QuestionGroup[] = [
      {
        id: 'g1',
        name: 'G',
        order: 0,
        displayCondition: {
          logicType: 'AND',
          conditions: [
            {
              id: 'g1-c1',
              enabled: true,
              logicType: 'AND',
              conditionType: 'value-match',
              sourceQuestionId: 'a',
              requiredValues: ['yes'],
            },
          ],
        },
      } as unknown as QuestionGroup,
    ];
    const qs = [q('a'), q('b', { groupId: 'g1' }), q('c', { groupId: 'g1' })];
    expect(resolveVisibleQuestionIds(qs, { a: 'no' }, groups)).toEqual(new Set(['a']));
  });

  it('중첩 그룹 — 조건이 걸린 상위 그룹 밑의 하위 그룹 문항도 숨는다', () => {
    // shouldDisplayGroup 은 parentGroupId 사슬을 타고 올라가므로 하위 그룹 문항도
    // 숨는다. 직접 소속만 보면 큐에 오르지 않아 값이 살아남는다 (회귀 가드).
    const groups = [group('g-parent', { on: { source: 'a', values: ['yes'] } }), group('g-child', { parentGroupId: 'g-parent' })];
    const qs = [q('a'), q('b', { groupId: 'g-child' })];
    expect(resolveVisibleQuestionIds(qs, { a: 'no' }, groups)).toEqual(new Set(['a']));
  });

  it('중첩 그룹 — 하위 그룹 문항이 숨으면 그 값에 기대던 하류도 연쇄로 숨는다', () => {
    const groups = [group('g-parent', { on: { source: 'a', values: ['yes'] } }), group('g-child', { parentGroupId: 'g-parent' })];
    const qs = [
      q('a'),
      q('b', { groupId: 'g-child' }),
      q('c', { on: { source: 'b', values: ['x'] } }),
    ];
    expect(resolveVisibleQuestionIds(qs, { a: 'no', b: 'x' }, groups)).toEqual(new Set(['a']));
  });
});

describe('stripHiddenQuestionValues', () => {
  it('숨은 문항의 값을 지운다', () => {
    const qs = [q('a'), q('b', { on: { source: 'a', values: ['yes'] } })];
    expect(stripHiddenQuestionValues(qs, { a: 'no', b: 'x' })).toEqual({ a: 'no' });
  });

  it('숨은 문항의 사이드카 항목도 함께 지운다', () => {
    const qs = [q('a'), q('b', { on: { source: 'a', values: ['yes'] } })];
    const next = stripHiddenQuestionValues(qs, {
      a: 'no',
      b: 'x',
      __optTexts__: { a: { o1: '남는다' }, b: { o2: '사라진다' } },
      __changeConfirm__: { a: 'same', b: 'changed' },
    });
    expect(next['__optTexts__']).toEqual({ a: { o1: '남는다' } });
    expect(next['__changeConfirm__']).toEqual({ a: 'same' });
  });

  it('지울 것이 없으면 같은 참조를 돌려준다', () => {
    const qs = [q('a')];
    const responses = { a: 'yes' };
    expect(stripHiddenQuestionValues(qs, responses)).toBe(responses);
  });

  it('원본을 변형하지 않는다', () => {
    const qs = [q('a'), q('b', { on: { source: 'a', values: ['yes'] } })];
    const responses = { a: 'no', b: 'x', __optTexts__: { b: { o1: 't' } } };
    stripHiddenQuestionValues(qs, responses);
    expect(responses).toEqual({ a: 'no', b: 'x', __optTexts__: { b: { o1: 't' } } });
  });

  it('응답에 없는 문항 키를 만들지 않는다', () => {
    const qs = [q('a'), q('b')];
    expect(Object.keys(stripHiddenQuestionValues(qs, { a: 'yes' }))).toEqual(['a']);
  });
});
