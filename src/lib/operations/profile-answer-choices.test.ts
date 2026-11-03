import { describe, expect, it } from 'vitest';

import {
  collectAnswerStrings,
  formatChoiceAnswer,
  matchChoiceValues,
} from '@/lib/operations/profile-answer-choices';

const GENDER = [
  { id: 'o1', value: '1', label: '① 남성' },
  { id: 'o2', value: '2', label: '② 여성' },
  { id: 'o9', value: '9', label: '⑨ 기타' },
];

describe('collectAnswerStrings — 저장 모양과 무관하게 고른 값을 편다', () => {
  it('문자열·배열·보기 그룹 맵', () => {
    expect(collectAnswerStrings('1')).toEqual(['1']);
    expect(collectAnswerStrings(['1', '2'])).toEqual(['1', '2']);
    expect(collectAnswerStrings({ default: 'cell-a' })).toEqual(['cell-a']);
    expect(collectAnswerStrings({ g1: ['a', 'b'], g2: 'c' })).toEqual(['a', 'b', 'c']);
    expect(collectAnswerStrings(null)).toEqual([]);
    expect(collectAnswerStrings(['', ' '])).toEqual([]);
  });
});

describe('formatChoiceAnswer — 보기 글자로 보인다', () => {
  it('단일은 보기 글자, 복수는 「, 」로 잇는다', () => {
    expect(formatChoiceAnswer('2', GENDER)).toBe('② 여성');
    expect(formatChoiceAnswer(['1', '2'], GENDER)).toBe('① 남성, ② 여성');
  });

  it('상세 기재가 있으면 괄호로 붙인다 — __optTexts__ 는 보기 id 가 키', () => {
    expect(formatChoiceAnswer('9', GENDER, { o9: '무응답 희망' })).toBe('⑨ 기타(무응답 희망)');
    expect(formatChoiceAnswer('9', GENDER, { o9: '  ' })).toBe('⑨ 기타');
  });

  it('지금 구조에 없는 저장값은 그대로 보인다', () => {
    expect(formatChoiceAnswer(['1', '7'], GENDER)).toBe('① 남성, 7');
    expect(formatChoiceAnswer(undefined, GENDER)).toBe('');
  });
});

describe('matchChoiceValues — 검색어가 든 보기의 저장값', () => {
  it('보기 글자로 맞고 대소문자·앞뒤 공백을 무시한다', () => {
    expect(matchChoiceValues(GENDER, ' 여성 ')).toEqual(['2']);
    expect(matchChoiceValues(GENDER, '성')).toEqual(['1', '2']);
    expect(matchChoiceValues([{ id: 'a', value: 'a', label: 'AI 분야' }], 'ai')).toEqual(['a']);
  });

  it('저장값(번호)으로는 맞지 않는다 — 글자에 없는 「1」은 아무 보기도 아니다', () => {
    expect(matchChoiceValues(GENDER, '1')).toEqual([]);
  });
});
