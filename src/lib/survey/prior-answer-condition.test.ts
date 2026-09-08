import { describe, expect, it } from 'vitest';

import { shouldLoadPriorAnswer } from '@/lib/survey/prior-answer-condition';
import type { Question } from '@/types/survey';

/**
 * 이월값 불러오기 조건 — 문항 단위로 "이 문항은 언제 이월값을 받는가" 를 정한다.
 *
 * 표시 조건과 별개 축이다. 표시 조건은 문항을 보일지 정하고, 이 조건은 **보이는 문항에
 * 이월값을 깔지** 정한다. 이직 여부처럼 같은 문항 안에서 갈리는 경우를 표시 조건으로는
 * 표현할 수 없어서 생겼다 — 이직했으면 작년 회사를 지우고 새로 받아야 하는데, 문항은
 * 양쪽 다 보여야 한다.
 *
 * 미설정(`undefined`)은 **불러온다** 다. 기존 설문의 동작을 그대로 둔다.
 */
function question(id: string, condition?: unknown): Question {
  return {
    id,
    type: 'table',
    title: id,
    required: false,
    order: 0,
    ...(condition ? { priorAnswerCondition: condition } : {}),
  } as unknown as Question;
}

/** value-match 조건 하나짜리 그룹. */
function matches(sourceQuestionId: string, values: string[]) {
  return {
    logicType: 'AND' as const,
    conditions: [
      {
        id: 'c1',
        enabled: true,
        logicType: 'AND' as const,
        conditionType: 'value-match' as const,
        sourceQuestionId,
        requiredValues: values,
      },
    ],
  };
}

const source = {
  id: 'q-move',
  type: 'radio',
  title: '이직 여부',
  required: false,
  order: 0,
} as unknown as Question;

describe('shouldLoadPriorAnswer', () => {
  it('조건이 없으면 불러온다 — 기존 설문의 동작', () => {
    expect(shouldLoadPriorAnswer(question('q1'), {}, [])).toBe(true);
  });

  it('조건이 맞으면 불러온다', () => {
    const q = question('q1', matches('q-move', ['no']));
    expect(shouldLoadPriorAnswer(q, { 'q-move': 'no' }, [source, q])).toBe(true);
  });

  it('조건이 어긋나면 불러오지 않는다', () => {
    const q = question('q1', matches('q-move', ['no']));
    expect(shouldLoadPriorAnswer(q, { 'q-move': 'yes' }, [source, q])).toBe(false);
  });

  it('참조 문항이 아직 미응답이면 불러오지 않는다 — 답하기 전에 깔리면 안 된다', () => {
    const q = question('q1', matches('q-move', ['no']));
    expect(shouldLoadPriorAnswer(q, {}, [source, q])).toBe(false);
  });

  it('조건 배열이 깨져 있으면 불러온다 — JSONB 드리프트는 기존 동작으로 폴백', () => {
    const q = question('q1', { logicType: 'AND', conditions: null });
    expect(shouldLoadPriorAnswer(q, {}, [q])).toBe(true);
  });

  it('conditions 가 비어 있으면 불러온다 — 조건 없음과 같게 본다', () => {
    const q = question('q1', { logicType: 'AND', conditions: [] });
    expect(shouldLoadPriorAnswer(q, {}, [q])).toBe(true);
  });

  it('NOT 결합도 표시 조건과 같은 규칙으로 평가된다', () => {
    const q = question('q1', { ...matches('q-move', ['yes']), logicType: 'NOT' as const });
    expect(shouldLoadPriorAnswer(q, { 'q-move': 'yes' }, [source, q])).toBe(false);
    expect(shouldLoadPriorAnswer(q, { 'q-move': 'no' }, [source, q])).toBe(true);
  });
});
