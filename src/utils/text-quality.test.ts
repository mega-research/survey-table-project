import { describe, expect, it } from 'vitest';

import {
  countAnswerChars,
  isMeaninglessText,
  isPlainTextInput,
  normalizeTextValidation,
  textQualityViolation,
} from './text-quality';

describe('countAnswerChars — 공백을 뺀 글자 수', () => {
  it('앞뒤·사이 공백과 줄바꿈을 세지 않는다', () => {
    expect(countAnswerChars('  가나 다\n라  ')).toBe(4);
    expect(countAnswerChars('')).toBe(0);
    expect(countAnswerChars('   ')).toBe(0);
  });

  it('코드 포인트 단위로 센다 — 이모지 하나는 1자', () => {
    expect(countAnswerChars('좋아요\u{1F44D}')).toBe(4);
  });
});

describe('isMeaninglessText — 자음·모음·숫자만인 입력', () => {
  it.each([
    'ㅋㅋㅋ',
    'ㅎㅎㅎㅎ',
    'ㅇㅇ',
    'ㅏㅏㅏ',
    '123124',
    '1 2 3',
    'ㅋㅋ 123',
    '...',
    '---',
    '!!!',
  ])('%j 는 의미 없는 입력이다', (value) => {
    expect(isMeaninglessText(value)).toBe(true);
  });

  it.each(['aaaaa', '하하하하', '네네네', 'abab', 'ㅋ하ㅋ하', '하 하 하', 'AAAA'])(
    '%j 는 한두 글자만 되풀이한 값이라 의미 없는 입력이다',
    (value) => {
      expect(isMeaninglessText(value)).toBe(true);
    },
  );

  it.each([
    '없음',
    '아 진짜 ㅋㅋㅋ',
    'ok',
    'N/A',
    '10명',
    '漢字',
    '2024년 도입 예정',
    '하하 진짜 웃김',
    '가나가',
  ])('%j 는 내용이 있는 입력이다', (value) => {
    expect(isMeaninglessText(value)).toBe(false);
  });

  it('빈 값은 판정 대상이 아니다 — 미입력 차단은 필수 판정 소관', () => {
    expect(isMeaninglessText('')).toBe(false);
    expect(isMeaninglessText('   ')).toBe(false);
  });
});

describe('textQualityViolation — 문항 설정에 비춘 위반', () => {
  it('설정이 없으면 어떤 값도 막지 않는다', () => {
    expect(textQualityViolation(undefined, 'ㅋㅋ')).toBeNull();
    expect(textQualityViolation(null, '1')).toBeNull();
    expect(textQualityViolation({}, 'ㅋㅋ')).toBeNull();
  });

  it('최소 글자 수 미달이면 현재 글자 수와 함께 알린다', () => {
    expect(textQualityViolation({ minLength: 10 }, '짧은 답변')).toEqual({
      reason: 'min_length',
      message: '10자 이상 입력해 주세요. (현재 4자, 공백 제외)',
    });
    expect(textQualityViolation({ minLength: 10 }, '열 글자를 채운 답변입니다')).toBeNull();
  });

  it('의미 없는 입력 거부가 켜져 있으면 자음·모음·숫자만인 값을 막는다', () => {
    expect(textQualityViolation({ rejectMeaningless: true }, 'ㅋㅋㅋ')).toEqual({
      reason: 'meaningless',
      message: '자음·모음이나 숫자만으로는 답할 수 없습니다. 내용을 입력해 주세요.',
    });
    expect(textQualityViolation({ rejectMeaningless: true }, '특별히 없음')).toBeNull();
    expect(textQualityViolation({ rejectMeaningless: false }, 'ㅋㅋㅋ')).toBeNull();
  });

  it('입력 상한을 넘으면 공백 포함 길이로 알린다 — 입력칸의 maxLength 와 같은 단위', () => {
    expect(textQualityViolation({ maxLength: 5 }, '여섯 글자야')).toEqual({
      reason: 'max_length',
      message: '5자 이하로 입력해 주세요. (현재 6자)',
    });
    expect(textQualityViolation({ maxLength: 5 }, '다섯글자')).toBeNull();
  });

  it('둘 다 걸리면 의미 없는 입력을 먼저 알린다 — 글자 수를 채워도 통과하지 못하는 값이라서', () => {
    expect(textQualityViolation({ minLength: 10, rejectMeaningless: true }, 'ㅋㅋ')?.reason).toBe(
      'meaningless',
    );
  });

  it('빈 값·문자열이 아닌 값은 막지 않는다', () => {
    expect(textQualityViolation({ minLength: 10, rejectMeaningless: true }, '')).toBeNull();
    expect(textQualityViolation({ minLength: 10 }, undefined)).toBeNull();
    expect(textQualityViolation({ minLength: 10 }, 42)).toBeNull();
  });

  it('최소 글자 수가 0 이하·정수가 아니면 없는 것으로 본다', () => {
    expect(textQualityViolation({ minLength: 0 }, '가')).toBeNull();
    expect(textQualityViolation({ minLength: -3 }, '가')).toBeNull();
    expect(textQualityViolation({ minLength: 2.5 }, '가')).toBeNull();
  });
});

describe('isPlainTextInput — 품질 검사가 붙는 입력', () => {
  it('장문형과 평문 단답형만 대상이고 숫자·형식 단답형은 배타', () => {
    expect(isPlainTextInput({ type: 'textarea' })).toBe(true);
    expect(isPlainTextInput({ type: 'text' })).toBe(true);
    expect(isPlainTextInput({ type: 'text', inputType: 'text' })).toBe(true);
    expect(isPlainTextInput({ type: 'text', inputType: 'number' })).toBe(false);
    expect(isPlainTextInput({ type: 'text', inputType: 'email' })).toBe(false);
    expect(isPlainTextInput({ type: 'radio' })).toBe(false);
  });
});

describe('normalizeTextValidation — 빌더 저장 정리', () => {
  it('양의 정수 최소 글자 수와 켜진 토글만 남긴다', () => {
    expect(normalizeTextValidation({ minLength: 10, rejectMeaningless: true })).toEqual({
      minLength: 10,
      rejectMeaningless: true,
    });
    expect(normalizeTextValidation({ minLength: 0, rejectMeaningless: false })).toBeNull();
    expect(normalizeTextValidation({ maxLength: 200 })).toEqual({ maxLength: 200 });
    expect(normalizeTextValidation({ maxLength: 0 })).toBeNull();
    expect(normalizeTextValidation({ minLength: -1 })).toBeNull();
    expect(normalizeTextValidation({ rejectMeaningless: true })).toEqual({
      rejectMeaningless: true,
    });
  });

  it('둘 다 없으면 null — 패치에서 undefined 는 손대지 않음이라 지우려면 null 이어야 한다', () => {
    expect(normalizeTextValidation({})).toBeNull();
    expect(normalizeTextValidation(null)).toBeNull();
    expect(normalizeTextValidation(undefined)).toBeNull();
  });
});
