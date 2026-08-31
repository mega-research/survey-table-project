import { describe, expect, it } from 'vitest';

import {
  CHANGE_CONFIRM_KEY,
  collectUnconfirmedQuestionIds,
  getChangeConfirmation,
  readChangeConfirmations,
  requiresChangeConfirmation,
  sanitizeChangeConfirmations,
  updateChangeConfirmations,
} from './change-confirmation';
import type { Question } from '@/types/survey';

function q(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    type: 'text',
    title: id,
    required: false,
    order: 0,
    ...overrides,
  } as Question;
}

describe('readChangeConfirmations', () => {
  it('사이드카가 없으면 빈 묶음이다', () => {
    expect(readChangeConfirmations(undefined)).toEqual({});
    expect(readChangeConfirmations(null)).toEqual({});
    expect(readChangeConfirmations({ q1: 'a' })).toEqual({});
  });

  it('저장된 확인 상태를 그대로 읽는다', () => {
    const responses = { q1: 'a', [CHANGE_CONFIRM_KEY]: { q1: 'same', q2: 'changed' } };
    expect(readChangeConfirmations(responses)).toEqual({ q1: 'same', q2: 'changed' });
  });

  it('알 수 없는 값과 형태 드리프트는 걸러낸다', () => {
    expect(readChangeConfirmations({ [CHANGE_CONFIRM_KEY]: 'same' })).toEqual({});
    expect(readChangeConfirmations({ [CHANGE_CONFIRM_KEY]: ['same'] })).toEqual({});
    expect(
      readChangeConfirmations({ [CHANGE_CONFIRM_KEY]: { q1: 'maybe', q2: 1, q3: 'changed' } }),
    ).toEqual({ q3: 'changed' });
  });
});

describe('sanitizeChangeConfirmations', () => {
  it('실존 문항 판정을 주면 그 문항의 확인만 남긴다', () => {
    const kept = sanitizeChangeConfirmations(
      { q1: 'same', gone: 'changed' },
      (id) => id === 'q1',
    );
    expect(kept).toEqual({ q1: 'same' });
  });

  it('판정을 주지 않으면 값 형태만 검사한다', () => {
    expect(sanitizeChangeConfirmations({ q1: 'same', q2: 'nope' })).toEqual({ q1: 'same' });
  });
});

describe('getChangeConfirmation', () => {
  it('밝히지 않은 문항은 null 이다', () => {
    expect(getChangeConfirmation({}, 'q1')).toBeNull();
  });

  it('밝힌 문항은 그 값을 돌려준다', () => {
    const responses = { [CHANGE_CONFIRM_KEY]: { q1: 'changed' } };
    expect(getChangeConfirmation(responses, 'q1')).toBe('changed');
  });
});

describe('updateChangeConfirmations', () => {
  it('새 확인을 얹는다', () => {
    expect(updateChangeConfirmations(undefined, 'q1', 'same')).toEqual({ q1: 'same' });
  });

  it('기존 확인을 덮되 다른 문항은 건드리지 않는다', () => {
    const next = updateChangeConfirmations({ q1: 'same', q2: 'same' }, 'q1', 'changed');
    expect(next).toEqual({ q1: 'changed', q2: 'same' });
  });

  it('원본 사이드카를 변형하지 않는다', () => {
    const current = { q1: 'same' as const };
    updateChangeConfirmations(current, 'q2', 'changed');
    expect(current).toEqual({ q1: 'same' });
  });
});

describe('requiresChangeConfirmation', () => {
  const prior = { q1: '창업', q2: '', q3: [] };

  it('이월 값이 있는 문항에만 요구한다', () => {
    expect(requiresChangeConfirmation(q('q1'), prior)).toBe(true);
  });

  it('이월 값이 비어 있으면 요구하지 않는다 — 무엇과 비교할지 알 수 없다', () => {
    expect(requiresChangeConfirmation(q('q2'), prior)).toBe(false);
    expect(requiresChangeConfirmation(q('q3'), prior)).toBe(false);
  });

  it('올해 새로 생긴 문항에는 요구하지 않는다', () => {
    expect(requiresChangeConfirmation(q('newQ'), prior)).toBe(false);
  });

  it('익명 응답자에게는 요구하지 않는다', () => {
    expect(requiresChangeConfirmation(q('q1'), null)).toBe(false);
    expect(requiresChangeConfirmation(q('q1'), {})).toBe(false);
  });

  it('안내문에는 요구하지 않는다 — 비교할 답이 없는 문항 유형이다', () => {
    expect(requiresChangeConfirmation(q('q1', { type: 'notice' }), prior)).toBe(false);
  });
});

describe('collectUnconfirmedQuestionIds', () => {
  const prior = { q1: '창업', q2: ['a'], q3: { r1c1: '3' } };

  it('이월 값이 있는데 밝히지 않은 문항을 순서대로 낸다', () => {
    const ids = collectUnconfirmedQuestionIds([q('q1'), q('q2'), q('q3')], prior, {});
    expect(ids).toEqual(['q1', 'q2', 'q3']);
  });

  it('밝힌 문항은 빠진다', () => {
    const responses = { [CHANGE_CONFIRM_KEY]: { q1: 'same', q3: 'changed' } };
    expect(collectUnconfirmedQuestionIds([q('q1'), q('q2'), q('q3')], prior, responses)).toEqual([
      'q2',
    ]);
  });

  it('응답 필수 여부와 별개다 — 필수가 아닌 문항도 변동 확인은 요구된다', () => {
    const ids = collectUnconfirmedQuestionIds([q('q1', { required: false })], prior, {
      q1: '창업',
    });
    expect(ids).toEqual(['q1']);
  });

  it('이월 값이 없으면 필수 미응답이어도 변동 확인 대상이 아니다', () => {
    const ids = collectUnconfirmedQuestionIds([q('newQ', { required: true })], prior, {});
    expect(ids).toEqual([]);
  });

  it('이월 응답이 없는 응답자에게는 아무것도 요구하지 않는다', () => {
    expect(collectUnconfirmedQuestionIds([q('q1'), q('q2')], null, {})).toEqual([]);
  });
});
