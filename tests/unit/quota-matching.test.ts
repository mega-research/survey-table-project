import { describe, expect, it } from 'vitest';

import type { QuotaConfig, QuotaDimension } from '@/db/schema/schema-types';
import {
  cellKeyOf,
  countCell,
  deriveCategoryIds,
  findTarget,
  normalizeAnswerValues,
  resolveCategoryId,
  tallyAll,
} from '@/lib/quota/matching';

const genderDim: QuotaDimension = {
  id: 'd-gender',
  questionId: 'q-gender',
  label: '성별',
  kind: 'choice',
  categories: [
    { id: 'c-m', label: '남성', values: ['male'] },
    { id: 'c-f', label: '여성', values: ['female'] },
  ],
};

const ageDim: QuotaDimension = {
  id: 'd-age',
  questionId: 'q-age',
  label: '연령',
  kind: 'numeric',
  categories: [
    { id: 'c-20', label: '20대', min: 20, max: 30 },
    { id: 'c-60', label: '60대 이상', min: 60, max: null },
  ],
};

const config: QuotaConfig = {
  enabled: true,
  dimensions: [genderDim, ageDim],
  cells: [
    { categoryIds: ['c-f', 'c-60'], target: 3 },
    { categoryIds: ['c-m', 'c-20'], target: 5 },
  ],
  closedMessage: null,
};

describe('normalizeAnswerValues', () => {
  it('문자열은 단일 배열로', () => {
    expect(normalizeAnswerValues('male')).toEqual(['male']);
  });
  it('{selectedValue} 래퍼를 언랩', () => {
    expect(normalizeAnswerValues({ selectedValue: 'female' })).toEqual(['female']);
  });
  it('{optionId} 래퍼를 언랩', () => {
    expect(normalizeAnswerValues({ optionId: 'male' })).toEqual(['male']);
  });
  it('배열(체크박스)은 각 원소를 언랩', () => {
    expect(normalizeAnswerValues(['a', { selectedValue: 'b' }])).toEqual(['a', 'b']);
  });
  it('null/undefined/숫자는 빈 배열 아님 처리 — 숫자는 문자열화', () => {
    expect(normalizeAnswerValues(null)).toEqual([]);
    expect(normalizeAnswerValues(undefined)).toEqual([]);
    expect(normalizeAnswerValues(63)).toEqual(['63']);
  });
});

describe('resolveCategoryId — choice', () => {
  it('보기값이 카테고리 values에 있으면 그 id', () => {
    expect(resolveCategoryId(genderDim, 'female')).toBe('c-f');
  });
  it('래퍼 응답도 매칭', () => {
    expect(resolveCategoryId(genderDim, { selectedValue: 'male' })).toBe('c-m');
  });
  it('어느 카테고리에도 없으면 null', () => {
    expect(resolveCategoryId(genderDim, 'other')).toBeNull();
  });
  it('checkbox 배열 응답 — 원소 중 하나가 values에 있으면 매칭', () => {
    expect(resolveCategoryId(genderDim, ['other', 'female'])).toBe('c-f');
  });
  it('checkbox 복수 선택이 여러 카테고리에 걸치면 정의 순서상 첫 카테고리', () => {
    expect(resolveCategoryId(genderDim, ['female', 'male'])).toBe('c-m');
  });
  it('checkbox 빈 배열은 null', () => {
    expect(resolveCategoryId(genderDim, [])).toBeNull();
  });
});

describe('resolveCategoryId — numeric (min ≤ 값 < max, 반열림)', () => {
  it('구간 안이면 매칭', () => {
    expect(resolveCategoryId(ageDim, '25')).toBe('c-20');
  });
  it('하한 포함', () => {
    expect(resolveCategoryId(ageDim, '20')).toBe('c-20');
  });
  it('상한 배타 — 30은 20대 아님', () => {
    expect(resolveCategoryId(ageDim, '30')).toBeNull();
  });
  it('max=null은 상한 무한 — 63은 60대 이상', () => {
    expect(resolveCategoryId(ageDim, '63')).toBe('c-60');
  });
  it('숫자 파싱 실패면 null', () => {
    expect(resolveCategoryId(ageDim, 'abc')).toBeNull();
    expect(resolveCategoryId(ageDim, '')).toBeNull();
  });
});

describe('deriveCategoryIds', () => {
  it('모든 차원 매칭 시 차원 순서대로 categoryId 배열', () => {
    expect(deriveCategoryIds(config, { 'q-gender': 'female', 'q-age': '63' })).toEqual(['c-f', 'c-60']);
  });
  it('한 차원이라도 미매칭이면 null (미분류)', () => {
    expect(deriveCategoryIds(config, { 'q-gender': 'female', 'q-age': '45' })).toBeNull();
    expect(deriveCategoryIds(config, { 'q-gender': 'other', 'q-age': '63' })).toBeNull();
  });
  it('차원 답 누락도 null', () => {
    expect(deriveCategoryIds(config, { 'q-gender': 'female' })).toBeNull();
  });
});

describe('findTarget', () => {
  it('셀이 있으면 목표', () => {
    expect(findTarget(config, ['c-f', 'c-60'])).toBe(3);
  });
  it('sparse 미등록 셀이면 null', () => {
    expect(findTarget(config, ['c-m', 'c-60'])).toBeNull();
  });
  it('순서 정확히 일치해야 함', () => {
    expect(findTarget(config, ['c-60', 'c-f'])).toBeNull();
  });
});

describe('countCell / tallyAll', () => {
  const answersList = [
    { 'q-gender': 'female', 'q-age': '63' }, // c-f,c-60
    { 'q-gender': 'female', 'q-age': '65' }, // c-f,c-60
    { 'q-gender': 'male', 'q-age': '25' }, // c-m,c-20
    { 'q-gender': 'other', 'q-age': '25' }, // 미분류
  ];
  it('countCell은 해당 셀에 속하는 응답 수', () => {
    expect(countCell(config, ['c-f', 'c-60'], answersList)).toBe(2);
    expect(countCell(config, ['c-m', 'c-20'], answersList)).toBe(1);
  });
  it('tallyAll은 셀키별 카운트 맵 (미분류 제외)', () => {
    const map = tallyAll(config, answersList);
    expect(map.get(cellKeyOf(['c-f', 'c-60']))).toBe(2);
    expect(map.get(cellKeyOf(['c-m', 'c-20']))).toBe(1);
    expect([...map.values()].reduce((a, b) => a + b, 0)).toBe(3); // 미분류 1건 제외
  });
});

describe('resolveCategoryId — numeric: 빈/공백은 0으로 오인 금지 (0 포함 구간)', () => {
  const zeroBinDim: QuotaDimension = {
    id: 'd-hh',
    questionId: 'q-hh',
    label: '가구원수',
    kind: 'numeric',
    categories: [{ id: 'c-0-2', label: '0-2', min: 0, max: 3 }],
  };
  it('빈 문자열은 0 구간에 매칭되지 않음', () => {
    expect(resolveCategoryId(zeroBinDim, '')).toBeNull();
  });
  it('공백 문자열도 매칭되지 않음', () => {
    expect(resolveCategoryId(zeroBinDim, '   ')).toBeNull();
  });
  it('실제 0은 매칭됨', () => {
    expect(resolveCategoryId(zeroBinDim, '0')).toBe('c-0-2');
  });
});
