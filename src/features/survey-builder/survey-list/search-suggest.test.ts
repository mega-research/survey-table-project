import { describe, expect, it } from 'vitest';

import { dropWordsMatching, matchOwnerSuggestions, matchTagSuggestions } from './search-suggest';

const OWNERS = [
  { id: 'u1', name: '김은철' },
  { id: 'u2', name: '방휘연' },
  { id: 'u3', name: '이수진' },
  { id: 'u4', name: 'Kim Jay' },
];

describe('matchOwnerSuggestions — 자동완성 「소유자」 칸', () => {
  it('이름에 검색 단어가 들어 있는 소유자만, 받은 순서대로', () => {
    expect(matchOwnerSuggestions(OWNERS, '은철 2026').map((o) => o.id)).toEqual(['u1']);
    expect(matchOwnerSuggestions(OWNERS, '방휘 수진').map((o) => o.id)).toEqual(['u2', 'u3']);
  });

  it('대소문자를 가리지 않는다', () => {
    expect(matchOwnerSuggestions(OWNERS, 'jAY').map((o) => o.id)).toEqual(['u4']);
  });

  it('맞는 이름이 없으면 빈 칸 — 시안의 「a사 실」', () => {
    expect(matchOwnerSuggestions(OWNERS, 'a사 실')).toEqual([]);
  });

  it('빈 검색어는 아무도 맞지 않는다', () => {
    expect(matchOwnerSuggestions(OWNERS, '   ')).toEqual([]);
  });

  it('많아도 3명까지만', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, name: `김${i}` }));
    expect(matchOwnerSuggestions(many, '김').map((o) => o.id)).toEqual(['m0', 'm1', 'm2']);
  });
});

describe('dropWordsMatching — 후보를 고르면 그 후보에 맞던 단어를 지운다', () => {
  it('이름에 들어 있던 단어만 지우고 남은 단어는 한 칸씩 띄워 남긴다', () => {
    expect(dropWordsMatching('은철  2026 실태', '김은철')).toBe('2026 실태');
  });

  it('대소문자를 가리지 않는다 — 「a사 실」에서 A사 를 고르면 「실」', () => {
    expect(dropWordsMatching('a사 실', 'A사')).toBe('실');
  });

  it('다 맞으면 빈 검색어', () => {
    expect(dropWordsMatching('김 은철', '김은철')).toBe('');
  });
});

const TAGS = [
  { id: 't1', name: 'A사', color: 'blue' as const, linkCount: 6 },
  { id: 't2', name: 'A사 협력사', color: 'green' as const, linkCount: 2 },
  { id: 't3', name: '실태조사', color: 'amber' as const, linkCount: 17 },
  { id: 't4', name: 'Maestro', color: 'pink' as const, linkCount: 3 },
];

describe('matchTagSuggestions — 자동완성 「내 태그」 칸', () => {
  it('검색 단어 하나라도 이름에 든 태그를 받은 순서대로 — 시안의 「a사 실」', () => {
    expect(matchTagSuggestions(TAGS, 'a사', []).map((t) => t.id)).toEqual(['t1', 't2']);
    // 「실」은 실태조사에도 든다 — 단어별로 따로 맞춘다.
    expect(matchTagSuggestions(TAGS, 'a사 실', []).map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('대소문자를 가리지 않는다', () => {
    expect(matchTagSuggestions(TAGS, 'mAES', []).map((t) => t.id)).toEqual(['t4']);
  });

  it('이미 칩으로 걸린 태그는 후보에서 뺀다', () => {
    expect(matchTagSuggestions(TAGS, 'a사', ['t1']).map((t) => t.id)).toEqual(['t2']);
  });

  it('칩이 상한(10개)이면 더할 수 없으니 후보도 없다', () => {
    const full = Array.from({ length: 10 }, (_, i) => `x${i}`);
    expect(matchTagSuggestions(TAGS, 'a사', full)).toEqual([]);
  });

  it('빈 검색어는 아무 태그도 맞지 않는다', () => {
    expect(matchTagSuggestions(TAGS, '  ', [])).toEqual([]);
  });

  it('많아도 5개까지만', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i}`,
      name: `태그${i}`,
      color: 'gray' as const,
      linkCount: 0,
    }));
    expect(matchTagSuggestions(many, '태그', []).map((t) => t.id)).toEqual([
      'm0',
      'm1',
      'm2',
      'm3',
      'm4',
    ]);
  });
});

describe('dropWordsMatching — 태그를 고를 때 맞던 단어 지우기', () => {
  it('여러 단어 중 하나만 맞으면 그 단어만 지우고 나머지는 검색어로 남는다', () => {
    expect(dropWordsMatching('a사 실', 'A사')).toBe('실');
    expect(dropWordsMatching('2026 a사 고객', 'A사 협력사')).toBe('2026 고객');
  });

  it('둘 다 맞으면 검색어가 빈다', () => {
    expect(dropWordsMatching('a사 협력', 'A사 협력사')).toBe('');
  });
});
