import { describe, expect, it } from 'vitest';

import type { QuotaDimension } from '@/shared/contracts/quota';
import {
  cellKeyOf,
  countCell,
  deriveCategoryIds,
  findTarget,
  normalizeAnswerValues,
  resolveCategoryId,
  resolveSubjectCategoryId,
  tallyAll,
} from '@/lib/quota/matching';
import { normalizeQuotaConfig } from '@/lib/quota/normalize';

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

// 프로덕션과 같은 입구를 거친다 — 정규화가 쿼터 플랜의 유일한 생산자다.
const config = normalizeQuotaConfig({
  enabled: true,
  dimensions: [genderDim, ageDim],
  cells: [
    { categoryIds: ['c-f', 'c-60'], target: 3 },
    { categoryIds: ['c-m', 'c-20'], target: 5 },
  ],
  closedMessage: null,
})!;

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
    expect(deriveCategoryIds(config, { answers: { 'q-gender': 'female', 'q-age': '63' }, attrs: null })).toEqual(['c-f', 'c-60']);
  });
  it('한 차원이라도 미매칭이면 null (미분류)', () => {
    expect(deriveCategoryIds(config, { answers: { 'q-gender': 'female', 'q-age': '45' }, attrs: null })).toBeNull();
    expect(deriveCategoryIds(config, { answers: { 'q-gender': 'other', 'q-age': '63' }, attrs: null })).toBeNull();
  });
  it('차원 답 누락도 null', () => {
    expect(deriveCategoryIds(config, { answers: { 'q-gender': 'female' }, attrs: null })).toBeNull();
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
  ].map((answers) => ({ answers, attrs: null }));
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

// ── 조사 대상 속성형 · 텍스트형 (팹리스 수요기업 조사의 표본 배분이 출처) ──

const fieldDim: QuotaDimension = {
  id: 'd-field',
  questionId: '',
  label: '산업 분야',
  kind: 'attr',
  attrKey: '산업 분야',
  categories: [
    { id: 'c-ai', label: '인공지능', values: ['인공지능 및 지능형 컴퓨팅'] },
    { id: 'c-bio', label: '바이오', values: ['바이오 및 의료기기'] },
  ],
};

const SIDO = 'cell-sido';
const SIGUNGU = 'cell-sigungu';
const regionDim: QuotaDimension = {
  id: 'd-region',
  questionId: 'q1',
  label: '지역',
  kind: 'text',
  cellIds: [SIDO, SIGUNGU],
  categories: [
    { id: 'c-sn', label: '성남시', keywords: ['성남', 'seongnam', ''] },
    { id: 'c-etc', label: '성남시 외', isElse: true },
  ],
};

function address(sido: string, sigungu: string) {
  return { answers: { q1: { [SIDO]: sido, [SIGUNGU]: sigungu, other: '성남' } }, attrs: null };
}

describe('resolveSubjectCategoryId — attr', () => {
  it('명단 값이 카테고리 values 와 완전 일치하면 그 id', () => {
    const subject = { answers: {}, attrs: { '산업 분야': '바이오 및 의료기기' } };
    expect(resolveSubjectCategoryId(fieldDim, subject)).toBe('c-bio');
  });
  it('앞뒤 공백은 정돈한다', () => {
    const subject = { answers: {}, attrs: { '산업 분야': ' 인공지능 및 지능형 컴퓨팅 ' } };
    expect(resolveSubjectCategoryId(fieldDim, subject)).toBe('c-ai');
  });
  it('부분 일치는 매칭이 아니다', () => {
    const subject = { answers: {}, attrs: { '산업 분야': '바이오' } };
    expect(resolveSubjectCategoryId(fieldDim, subject)).toBeNull();
  });
  it('조사 대상이 없거나 열이 비면 미분류', () => {
    expect(resolveSubjectCategoryId(fieldDim, { answers: {}, attrs: null })).toBeNull();
    expect(resolveSubjectCategoryId(fieldDim, { answers: {}, attrs: {} })).toBeNull();
    expect(resolveSubjectCategoryId(fieldDim, { answers: {}, attrs: { '산업 분야': ' ' } })).toBeNull();
  });
  it('응답값에 같은 키가 있어도 attrs 만 본다', () => {
    const subject = { answers: { '산업 분야': '바이오 및 의료기기' }, attrs: null };
    expect(resolveSubjectCategoryId(fieldDim, subject)).toBeNull();
  });
});

describe('resolveSubjectCategoryId — text (표 input 셀 여럿)', () => {
  it.each([
    ['경기', '성남시 분당구'],
    ['경기도', '성남'],
    ['경기도 성남시', '분당구'],
    ['성남', '성남'],
    ['', '경기도성남시중원구'],
    ['경기', '성 남 시'],
    ['Gyeonggi', 'SeongNam-si'],
  ])('「%s / %s」 는 성남시', (sido, sigungu) => {
    expect(resolveSubjectCategoryId(regionDim, address(sido, sigungu))).toBe('c-sn');
  });
  it('키워드에 안 걸리고 값이 있으면 그 외', () => {
    expect(resolveSubjectCategoryId(regionDim, address('서울', '강남구'))).toBe('c-etc');
    expect(resolveSubjectCategoryId(regionDim, address('', '수원시'))).toBe('c-etc');
  });
  it('대상 칸이 전부 비면 미분류 — 대상이 아닌 칸의 값은 보지 않는다', () => {
    expect(resolveSubjectCategoryId(regionDim, address('', '  '))).toBeNull();
    expect(resolveSubjectCategoryId(regionDim, { answers: {}, attrs: null })).toBeNull();
    expect(resolveSubjectCategoryId(regionDim, { answers: { q1: 'x' }, attrs: null })).toBeNull();
  });
  it('칸 경계를 가로지르는 글자는 매칭이 아니다', () => {
    expect(resolveSubjectCategoryId(regionDim, address('화성', '남양읍'))).toBe('c-etc');
  });
  it('그 외가 앞에 있어도 키워드 카테고리가 이긴다', () => {
    const reversed = { ...regionDim, categories: [...regionDim.categories].reverse() };
    expect(resolveSubjectCategoryId(reversed, address('경기', '성남시'))).toBe('c-sn');
  });
  it('빈 키워드만 있는 카테고리는 아무것도 받지 않는다', () => {
    const dim = { ...regionDim, categories: [{ id: 'c-x', label: 'x', keywords: ['', ' '] }] };
    expect(resolveSubjectCategoryId(dim, address('서울', '강남구'))).toBeNull();
  });
});

describe('resolveSubjectCategoryId — text (단답형 문항)', () => {
  const dim: QuotaDimension = {
    id: 'd-t',
    questionId: 'q-city',
    label: '도시',
    kind: 'text',
    categories: [
      { id: 'c-sn', label: '성남', keywords: ['성남'] },
      { id: 'c-etc', label: '그 외', isElse: true },
    ],
  };
  it('문자열 응답을 그대로 본다', () => {
    expect(resolveSubjectCategoryId(dim, { answers: { 'q-city': '경기도 성남시' }, attrs: null })).toBe('c-sn');
    expect(resolveSubjectCategoryId(dim, { answers: { 'q-city': '서울' }, attrs: null })).toBe('c-etc');
    expect(resolveSubjectCategoryId(dim, { answers: { 'q-city': '' }, attrs: null })).toBeNull();
  });
});

describe('deriveCategoryIds — 속성형 × 텍스트형 교차', () => {
  const crossed = normalizeQuotaConfig({
    enabled: true,
    dimensions: [fieldDim, regionDim],
    cells: [{ categoryIds: ['c-ai', 'c-sn'], target: 10 }],
    closedMessage: null,
  })!;
  it('차원 순서대로 카테고리를 잇는다', () => {
    const subject = { ...address('경기', '성남시'), attrs: { '산업 분야': '인공지능 및 지능형 컴퓨팅' } };
    expect(deriveCategoryIds(crossed, subject)).toEqual(['c-ai', 'c-sn']);
  });
  it('익명 응답은 주소가 있어도 미분류', () => {
    expect(deriveCategoryIds(crossed, address('경기', '성남시'))).toBeNull();
  });
});
