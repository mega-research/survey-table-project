import { describe, expect, it } from 'vitest';

import {
  CHANGE_CONFIRM_KEY,
  collectUnconfirmedQuestionIds,
  collectUnmodifiedChangedQuestionIds,
  getChangeConfirmation,
  isAwaitingChangeConfirmation,
  isPriorAnswerLocked,
  resolveAnswerOnConfirmation,
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

describe('isPriorAnswerLocked', () => {
  const prior = { q1: '작년 답' };

  it('밝히기 전에는 잠겨 있다', () => {
    expect(isPriorAnswerLocked(q('q1'), prior, {})).toBe(true);
  });

  it('"같음"을 골라도 잠긴 채로 지나간다 — 더 손댈 것이 없다', () => {
    const responses = { q1: '작년 답', [CHANGE_CONFIRM_KEY]: { q1: 'same' } };
    expect(isPriorAnswerLocked(q('q1'), prior, responses)).toBe(true);
  });

  it('"달라짐"을 고르면 열린다', () => {
    const responses = { q1: '작년 답', [CHANGE_CONFIRM_KEY]: { q1: 'changed' } };
    expect(isPriorAnswerLocked(q('q1'), prior, responses)).toBe(false);
  });

  it('이월 값이 없는 문항과 익명 응답자는 처음부터 열려 있다', () => {
    expect(isPriorAnswerLocked(q('newQ'), prior, {})).toBe(false);
    expect(isPriorAnswerLocked(q('q1'), null, {})).toBe(false);
  });
});

describe('collectUnmodifiedChangedQuestionIds', () => {
  const prior = { q1: '작년 답', q2: { r1: 'a', r2: 'b' } };

  it('"달라짐"인데 이월 값과 완전히 같은 문항을 낸다', () => {
    const responses = {
      q1: '작년 답',
      q2: { r2: 'b', r1: 'a' },
      [CHANGE_CONFIRM_KEY]: { q1: 'changed', q2: 'changed' },
    };
    // q2 는 키 순서만 다르다 — 값이 같으므로 "안 고침"이다.
    expect(collectUnmodifiedChangedQuestionIds([q('q1'), q('q2')], prior, responses)).toEqual([
      'q1',
      'q2',
    ]);
  });

  it('한 칸이라도 고쳤으면 빠진다', () => {
    const responses = {
      q1: '올해 답',
      q2: { r1: 'a', r2: 'c' },
      [CHANGE_CONFIRM_KEY]: { q1: 'changed', q2: 'changed' },
    };
    expect(collectUnmodifiedChangedQuestionIds([q('q1'), q('q2')], prior, responses)).toEqual([]);
  });

  it('"같음"은 대상이 아니다 — 같다고 밝힌 것이 정상이다', () => {
    const responses = { q1: '작년 답', [CHANGE_CONFIRM_KEY]: { q1: 'same' } };
    expect(collectUnmodifiedChangedQuestionIds([q('q1')], prior, responses)).toEqual([]);
  });

  it('밝히지 않은 문항과 이월 값이 없는 문항은 대상이 아니다', () => {
    expect(collectUnmodifiedChangedQuestionIds([q('q1'), q('newQ')], prior, {})).toEqual([]);
  });
});

describe('isAwaitingChangeConfirmation', () => {
  const prior = { q1: '작년 답' };

  it('아직 밝히지 않은 문항만 대기 상태다', () => {
    expect(isAwaitingChangeConfirmation(q('q1'), prior, {})).toBe(true);
  });

  it('밝히고 나면 대기가 끝난다 — "같음"으로 잠긴 채여도 마찬가지다', () => {
    expect(
      isAwaitingChangeConfirmation(q('q1'), prior, { [CHANGE_CONFIRM_KEY]: { q1: 'same' } }),
    ).toBe(false);
    expect(
      isAwaitingChangeConfirmation(q('q1'), prior, { [CHANGE_CONFIRM_KEY]: { q1: 'changed' } }),
    ).toBe(false);
  });

  it('이월 값이 없는 문항은 대기하지 않는다', () => {
    expect(isAwaitingChangeConfirmation(q('newQ'), prior, {})).toBe(false);
  });
});

describe('resolveAnswerOnConfirmation', () => {
  const prior = { q1: '작년 답' };

  it('"같음"은 언제나 이월 값을 다시 복사한다 — 되돌리기에서 값이 어긋나지 않게', () => {
    expect(resolveAnswerOnConfirmation(q('q1'), prior, { q1: '고친 값' }, 'same')).toEqual({
      write: true,
      value: '작년 답',
    });
  });

  it('"달라짐"은 값이 아직 없을 때만 이월 값을 채워 연다', () => {
    expect(resolveAnswerOnConfirmation(q('q1'), prior, {}, 'changed')).toEqual({
      write: true,
      value: '작년 답',
    });
    expect(resolveAnswerOnConfirmation(q('q1'), prior, { q1: '고친 값' }, 'changed')).toEqual({
      write: false,
    });
  });

  it('이월 값이 없는 문항에는 아무것도 쓰지 않는다', () => {
    expect(resolveAnswerOnConfirmation(q('newQ'), prior, {}, 'same')).toEqual({ write: false });
  });
});

describe('본문 프리필 템플릿이 걸린 문항', () => {
  const prior = { q1: '작년 답' };
  const templated = q('q1', { defaultValueTemplate: '{{회사명}}' });

  it('변동 확인을 요구하지 않는다 — 템플릿이 이월 값보다 우선한다', () => {
    expect(requiresChangeConfirmation(templated, prior)).toBe(false);
    expect(isPriorAnswerLocked(templated, prior, {})).toBe(false);
    expect(collectUnconfirmedQuestionIds([templated], prior, {})).toEqual([]);
  });
});
