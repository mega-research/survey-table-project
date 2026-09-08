import { describe, expect, it } from 'vitest';

import {
  omitDisabledPriorAnswers,
  shouldLoadPriorAnswer,
} from '@/lib/survey/prior-answer-condition';
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

/**
 * 「이월값 불러오기」 스위치.
 *
 * 이월을 아예 막으려면 담당자가 조건에 도달 불가능한 값을 넣어야 했다. 그 우회는
 * "조건이 거짓으로 뒤집혔다" 와 구분되지 않아 회수가 응답자의 입력을 지웠다
 * (2026-09-08 DQ7 매출액). 의도를 값으로 표현한다.
 */
describe('priorAnswerDisabled — 이월값 불러오기 끄기', () => {
  const disabled = (extra?: Record<string, unknown>): Question =>
    ({
      id: 'q',
      type: 'table',
      title: 'q',
      required: false,
      order: 0,
      priorAnswerDisabled: true,
      ...extra,
    }) as unknown as Question;

  it('끄면 조건이 없어도 불러오지 않는다', () => {
    expect(shouldLoadPriorAnswer(disabled(), {}, [])).toBe(false);
  });

  it('끄면 조건이 참이어도 불러오지 않는다 — 스위치가 조건보다 앞선다', () => {
    const q = disabled({ priorAnswerCondition: matches('src', ['yes']) });
    expect(shouldLoadPriorAnswer(q, { src: 'yes' }, [])).toBe(false);
  });

  it('false 로 명시하면 기존 동작 그대로', () => {
    const q = { ...disabled(), priorAnswerDisabled: false } as Question;
    expect(shouldLoadPriorAnswer(q, {}, [])).toBe(true);
  });

  it('미설정은 기존 동작 그대로 — 예전 설문이 그대로 돌아야 한다', () => {
    expect(shouldLoadPriorAnswer(question('q'), {}, [])).toBe(true);
  });
});

/**
 * 상세 기재 사이드카 누수.
 *
 * 로더는 이월 응답의 `__optTexts__` 를 입력란 스토어에 시드하는데, 그 시드는 프리필
 * effect 보다 먼저 돌고 문항별 게이트가 없었다. 스위치를 꺼도 상세 기재 칸에 지난
 * 회차 값이 그대로 보였다(2026-09-08 DQ7 매출액 10000).
 */
describe('omitDisabledPriorAnswers', () => {
  const on = question('q-on');
  const off = { ...question('q-off'), priorAnswerDisabled: true } as Question;
  const prior = {
    'q-on': { a: '켠 문항 값' },
    'q-off': { a: '끈 문항 값' },
    __optTexts__: {
      'q-on': { opt1: '켠 문항 상세' },
      'q-off': { opt1: '10000' },
    },
  } as never;

  it('끈 문항의 값과 상세 기재를 함께 걷어낸다', () => {
    const out = omitDisabledPriorAnswers(prior, [on, off]) as Record<string, unknown>;
    expect(out['q-off']).toBeUndefined();
    expect(out['q-on']).toEqual({ a: '켠 문항 값' });
    expect(out.__optTexts__).toEqual({ 'q-on': { opt1: '켠 문항 상세' } });
  });

  it('끈 문항이 없으면 원본을 그대로 돌려준다', () => {
    expect(omitDisabledPriorAnswers(prior, [on])).toBe(prior);
  });

  it('사이드카가 통째로 비면 키를 남기지 않는다', () => {
    const only = { __optTexts__: { 'q-off': { opt1: '10000' } } } as never;
    expect(omitDisabledPriorAnswers(only, [off])).toEqual({});
  });

  it('이월이 없으면 null', () => {
    expect(omitDisabledPriorAnswers(null, [off])).toBeNull();
  });
});
