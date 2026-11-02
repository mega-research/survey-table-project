import { describe, expect, it } from 'vitest';

import { dropWordsMatching, matchOwnerSuggestions } from './search-suggest';

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
