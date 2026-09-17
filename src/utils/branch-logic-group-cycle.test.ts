import { describe, expect, it } from 'vitest';

import type { Question, QuestionGroup } from '@/types/survey';
import { shouldDisplayGroup, shouldDisplayQuestion } from '@/utils/branch-logic';

/**
 * `question_groups.parent_group_id` 는 자기 참조 FK 라 손상된 데이터에서 순환이 가능하다.
 * `shouldDisplayGroup` 은 그 사슬을 재귀로 타므로 가드가 없으면 스택이 넘친다 — 응답
 * 화면·자격미달 판정·숨은 문항 삭제가 전부 이 함수를 지나므로 한 번 넘치면 설문이 통째로
 * 죽는다. 순환은 "더 볼 조상이 없다" 로 끊고 나머지 판정은 평소대로 진행한다.
 */
function group(id: string, parentGroupId: string | null): QuestionGroup {
  return {
    id,
    name: id,
    order: 0,
    ...(parentGroupId ? { parentGroupId } : {}),
  } as unknown as QuestionGroup;
}

/** 조건이 참조하는 문항 — evaluateQuestionCondition 은 소스 문항이 목록에 있어야 값을 본다. */
const sourceQuestion = {
  id: 'q1',
  type: 'radio',
  title: 'Q1',
  required: false,
  order: 0,
} as unknown as Question;

/** value-match 조건 하나를 얹은 그룹. */
function conditioned(base: QuestionGroup, sourceQuestionId: string): QuestionGroup {
  return {
    ...base,
    displayCondition: {
      logicType: 'AND' as const,
      conditions: [
        {
          id: `${base.id}-c1`,
          enabled: true,
          logicType: 'AND' as const,
          conditionType: 'value-match' as const,
          sourceQuestionId,
          requiredValues: ['yes'],
        },
      ],
    },
  } as unknown as QuestionGroup;
}

describe('shouldDisplayGroup 의 상위 그룹 순환 가드', () => {
  it('두 그룹이 서로를 부모로 가리켜도 스택이 넘치지 않는다', () => {
    const groups = [group('a', 'b'), group('b', 'a')];
    expect(() => shouldDisplayGroup(groups[0]!, {}, [], groups)).not.toThrow();
  });

  it('자기 자신을 부모로 가리켜도 스택이 넘치지 않는다', () => {
    const groups = [group('self', 'self')];
    expect(() => shouldDisplayGroup(groups[0]!, {}, [], groups)).not.toThrow();
  });

  it('세 그룹 순환도 끊는다', () => {
    const groups = [group('a', 'b'), group('b', 'c'), group('c', 'a')];
    expect(() => shouldDisplayGroup(groups[0]!, {}, [], groups)).not.toThrow();
  });

  it('순환 안의 그룹에 걸린 조건은 그대로 평가된다 — 가드가 판정을 삼키지 않는다', () => {
    const a = conditioned(group('a', 'b'), 'q1');
    const groups = [a, group('b', 'a')];

    expect(shouldDisplayGroup(a, { q1: 'yes' }, [sourceQuestion], groups)).toBe(true);
    expect(shouldDisplayGroup(a, { q1: 'no' }, [sourceQuestion], groups)).toBe(false);
  });

  it('순환 상대편의 조건도 상속된다 — 가드는 재방문만 끊는다', () => {
    const a = group('a', 'b');
    const b = conditioned(group('b', 'a'), 'q1');
    const groups = [a, b];

    expect(shouldDisplayGroup(a, { q1: 'yes' }, [sourceQuestion], groups)).toBe(true);
    expect(shouldDisplayGroup(a, { q1: 'no' }, [sourceQuestion], groups)).toBe(false);
  });

  it('순환 그룹에 속한 문항 판정도 넘치지 않는다', () => {
    const groups = [group('a', 'b'), group('b', 'a')];
    const question = {
      id: 'q1',
      type: 'text',
      title: 'Q',
      required: false,
      order: 0,
      groupId: 'a',
    } as unknown as Question;
    expect(() => shouldDisplayQuestion(question, {}, [question], groups)).not.toThrow();
  });

  it('정상 계층은 종전대로 상위 조건을 상속한다', () => {
    const parent = conditioned(group('parent', null), 'q1');
    const child = group('child', 'parent');
    const groups = [parent, child];

    expect(shouldDisplayGroup(child, { q1: 'yes' }, [sourceQuestion], groups)).toBe(true);
    expect(shouldDisplayGroup(child, { q1: 'no' }, [sourceQuestion], groups)).toBe(false);
  });
});
