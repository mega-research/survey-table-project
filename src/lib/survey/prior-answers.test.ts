import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PRIOR_WAVE_LABEL,
  hasPriorAnswer,
  normalizePriorAnswers,
  resolvePriorWaveLabel,
} from './prior-answers';

describe('normalizePriorAnswers', () => {
  it('객체가 아니면 빈 묶음으로 수렴한다', () => {
    expect(normalizePriorAnswers(null)).toEqual({});
    expect(normalizePriorAnswers(undefined)).toEqual({});
    expect(normalizePriorAnswers('{"q":1}')).toEqual({});
    expect(normalizePriorAnswers(['q'])).toEqual({});
  });

  it('질문 단위 값 묶음을 그대로 통과시킨다', () => {
    const raw = { q1: '창업', q2: ['a', 'b'], q3: { r1: 'c1' } };
    expect(normalizePriorAnswers(raw)).toEqual(raw);
  });

  it('사이드카 키도 보존한다 — 기타 기재 텍스트가 프리필에 함께 실려야 한다', () => {
    const raw = { q1: 'x', __optTexts__: { q1: { o1: '직접입력' } } };
    expect(normalizePriorAnswers(raw)).toEqual(raw);
  });
});

describe('hasPriorAnswer', () => {
  it('값이 있는 문항만 이월 값 보유로 본다', () => {
    const prior = normalizePriorAnswers({
      text: '창업',
      zero: 0,
      falsy: false,
      empty: '',
      nullish: null,
      emptyArray: [],
      emptyObject: {},
      table: { r1c1: '3' },
      blankTable: { r1c1: '' },
    });
    expect(hasPriorAnswer(prior, 'text')).toBe(true);
    expect(hasPriorAnswer(prior, 'zero')).toBe(true);
    expect(hasPriorAnswer(prior, 'falsy')).toBe(true);
    expect(hasPriorAnswer(prior, 'table')).toBe(true);
    expect(hasPriorAnswer(prior, 'empty')).toBe(false);
    expect(hasPriorAnswer(prior, 'nullish')).toBe(false);
    expect(hasPriorAnswer(prior, 'emptyArray')).toBe(false);
    expect(hasPriorAnswer(prior, 'emptyObject')).toBe(false);
    expect(hasPriorAnswer(prior, 'blankTable')).toBe(false);
    expect(hasPriorAnswer(prior, 'unknown')).toBe(false);
  });

  it('사이드카 키는 문항이 아니므로 이월 값으로 세지 않는다', () => {
    const prior = normalizePriorAnswers({ __optTexts__: { q1: { o1: 'x' } } });
    expect(hasPriorAnswer(prior, '__optTexts__')).toBe(false);
  });

  it('이월 응답이 없으면 항상 false', () => {
    expect(hasPriorAnswer(null, 'q1')).toBe(false);
    expect(hasPriorAnswer({}, 'q1')).toBe(false);
  });
});

describe('resolvePriorWaveLabel', () => {
  it('설정된 라벨을 쓰고, 비어 있으면 기본 문구로 떨어진다', () => {
    expect(resolvePriorWaveLabel('2025년 조사')).toBe('2025년 조사');
    expect(resolvePriorWaveLabel('  2025년 조사  ')).toBe('2025년 조사');
    expect(resolvePriorWaveLabel('')).toBe(DEFAULT_PRIOR_WAVE_LABEL);
    expect(resolvePriorWaveLabel('   ')).toBe(DEFAULT_PRIOR_WAVE_LABEL);
    expect(resolvePriorWaveLabel(null)).toBe(DEFAULT_PRIOR_WAVE_LABEL);
    expect(resolvePriorWaveLabel(undefined)).toBe(DEFAULT_PRIOR_WAVE_LABEL);
  });
});
