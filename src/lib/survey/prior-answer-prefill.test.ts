import { describe, expect, it } from 'vitest';

import {
  collectPriorAnswerPrefills,
  dropHiddenUntouchedPriorAnswers,
} from '@/lib/survey/prior-answer-prefill';
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

describe('dropHiddenUntouchedPriorAnswers', () => {
  const visible = new Set(['q1']);

  it('이월 응답이 없으면 원본을 그대로 돌려준다', () => {
    const responses = { q1: 'a' };
    expect(dropHiddenUntouchedPriorAnswers(responses, visible, null)).toBe(responses);
  });

  it('숨겨진 문항의 손대지 않은 이월 값을 걷어낸다', () => {
    const result = dropHiddenUntouchedPriorAnswers({ q1: '해당없음', q2: '작년 값' }, visible, {
      q1: '해당있음',
      q2: '작년 값',
    });
    expect(result).toEqual({ q1: '해당없음' });
  });

  it('숨겨졌어도 응답자가 고친 값은 남긴다', () => {
    const result = dropHiddenUntouchedPriorAnswers(
      { q1: '해당없음', q2: '올해 고친 값' },
      visible,
      { q1: '해당있음', q2: '작년 값' },
    );
    expect(result).toEqual({ q1: '해당없음', q2: '올해 고친 값' });
  });

  it('표시되는 문항은 이월 값과 같아도 남긴다', () => {
    const responses = { q1: '작년 값' };
    const result = dropHiddenUntouchedPriorAnswers(responses, visible, { q1: '작년 값' });
    expect(result).toBe(responses);
  });

  it('키 순서가 달라도 같은 값으로 본다', () => {
    const result = dropHiddenUntouchedPriorAnswers({ q2: { b: 2, a: 1 } }, new Set<string>(), {
      q2: { a: 1, b: 2 },
    });
    expect(result).toEqual({});
  });

  it('사이드카 키는 문항이 아니라 건드리지 않는다', () => {
    const responses = { __optTexts__: { o1: 'x' }, __changeConfirm__: { q2: 'same' } };
    expect(dropHiddenUntouchedPriorAnswers(responses, new Set<string>(), { q2: 'v' })).toBe(
      responses,
    );
  });

  it('걷어낼 것이 없으면 같은 참조를 돌려준다', () => {
    const responses = { q1: 'a', q2: '내 값' };
    expect(dropHiddenUntouchedPriorAnswers(responses, visible, { q2: '작년' })).toBe(responses);
  });
});
