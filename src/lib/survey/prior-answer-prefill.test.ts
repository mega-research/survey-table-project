import { describe, expect, it } from 'vitest';

import { collectPriorAnswerPrefills } from '@/lib/survey/prior-answer-prefill';
import type { Question } from '@/types/survey';

function q(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    surveyId: 's1',
    type: 'text',
    title: id,
    required: false,
    order: 0,
    ...overrides,
  } as Question;
}

describe('collectPriorAnswerPrefills', () => {
  it('이월 값이 없으면 아무것도 채우지 않는다', () => {
    expect(collectPriorAnswerPrefills([q('q1')], null, {})).toEqual([]);
    expect(collectPriorAnswerPrefills([q('q1')], {}, {})).toEqual([]);
  });

  it('표시되는 문항의 이월 값을 문항 순서대로 낸다', () => {
    const entries = collectPriorAnswerPrefills(
      [q('q1'), q('q2')],
      { q1: '작년 답', q2: ['a', 'b'] },
      {},
    );
    expect(entries).toEqual([
      { questionId: 'q1', value: '작년 답' },
      { questionId: 'q2', value: ['a', 'b'] },
    ]);
  });

  it('호출부가 넘기지 않은 문항은 채우지 않는다 — 숨은 문항이 여기로 안 온다', () => {
    // q2 는 표시 조건으로 숨겨져 호출부가 목록에서 뺐다. 이월 값이 있어도 채우면 안 된다.
    const entries = collectPriorAnswerPrefills([q('q1')], { q1: 'A', q2: 'B' }, {});
    expect(entries).toEqual([{ questionId: 'q1', value: 'A' }]);
  });

  it('이미 값이 있는 문항은 덮지 않는다 — 응답자가 고친 값이 밀리면 안 된다', () => {
    const entries = collectPriorAnswerPrefills(
      [q('q1'), q('q2')],
      { q1: 'A', q2: 'B' },
      {
        q1: '고친 값',
      },
    );
    expect(entries).toEqual([{ questionId: 'q2', value: 'B' }]);
  });

  it('빈 문자열로 고친 값도 값이다 — 지운 것을 지난 값으로 되살리지 않는다', () => {
    expect(collectPriorAnswerPrefills([q('q1')], { q1: 'A' }, { q1: '' })).toEqual([]);
  });

  it('이월 값이 비어 있으면 채우지 않는다', () => {
    const entries = collectPriorAnswerPrefills(
      [q('q1'), q('q2'), q('q3')],
      { q1: '', q2: [], q3: {} },
      {},
    );
    expect(entries).toEqual([]);
  });

  it('안내문은 답이 없는 유형이라 제외한다', () => {
    const entries = collectPriorAnswerPrefills([q('n1', { type: 'notice' })], { n1: '무언가' }, {});
    expect(entries).toEqual([]);
  });

  it('본문 프리필 템플릿이 걸린 문항은 제외한다 — 템플릿 값이 이긴다', () => {
    const entries = collectPriorAnswerPrefills(
      [q('q1', { defaultValueTemplate: '{{attrs.회사명}}' })],
      { q1: '작년 회사' },
      {},
    );
    expect(entries).toEqual([]);
  });

  it('사이드카 키는 문항이 아니라 채우지 않는다', () => {
    const entries = collectPriorAnswerPrefills(
      [q('q1')],
      { __optTexts__: { a: 'x' }, q1: 'A' },
      {},
    );
    expect(entries).toEqual([{ questionId: 'q1', value: 'A' }]);
  });
});

describe('이월값 불러오기 조건', () => {
  const mover = {
    id: 'q-move',
    type: 'radio',
    title: '이직 여부',
    required: false,
    order: 0,
  } as unknown as Question;

  /** 이직 안 함(no)일 때만 이월값을 받는 문항. */
  function gated(): Question {
    return {
      id: 'q-emp',
      type: 'table',
      title: '취업 현황',
      required: false,
      order: 1,
      priorAnswerCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'c1',
            enabled: true,
            logicType: 'AND',
            conditionType: 'value-match',
            sourceQuestionId: 'q-move',
            requiredValues: ['no'],
          },
        ],
      },
    } as unknown as Question;
  }

  const prior = { 'q-emp': { cell1: '작년 회사' } };

  it('조건이 맞으면 채운다', () => {
    const q = gated();
    const out = collectPriorAnswerPrefills([mover, q], prior, { 'q-move': 'no' }, [mover, q]);
    expect(out.map((e) => e.questionId)).toEqual(['q-emp']);
  });

  it('조건이 어긋나면 채우지 않는다 — 이직했으면 작년 회사를 깔면 안 된다', () => {
    const q = gated();
    const out = collectPriorAnswerPrefills([mover, q], prior, { 'q-move': 'yes' }, [mover, q]);
    expect(out).toEqual([]);
  });

  it('조건이 없는 문항은 종전대로 채운다', () => {
    const { priorAnswerCondition: _drop, ...plain } = gated();
    const out = collectPriorAnswerPrefills([plain], prior, {}, [plain]);
    expect(out.map((e) => e.questionId)).toEqual(['q-emp']);
  });
});
