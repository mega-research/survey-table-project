import { describe, expect, it } from 'vitest';

import { MAX_RECIPIENTS_PER_MAIL, mailToList, splitEmailAddresses } from './split-email-addresses';

describe('splitEmailAddresses', () => {
  it('주소 하나는 그대로다', () => {
    expect(splitEmailAddresses('kim@example.com')).toEqual(['kim@example.com']);
    expect(splitEmailAddresses('  kim@example.com \n')).toEqual(['kim@example.com']);
  });

  it('/ , ; 로 적은 여러 주소를 나눈다', () => {
    expect(splitEmailAddresses('a@x.com / b@y.co.kr')).toEqual(['a@x.com', 'b@y.co.kr']);
    expect(splitEmailAddresses('a@x.com/ b@y.com')).toEqual(['a@x.com', 'b@y.com']);
    expect(splitEmailAddresses('a@x.com, b@y.com')).toEqual(['a@x.com', 'b@y.com']);
    expect(splitEmailAddresses('a@x.com; b@y.com')).toEqual(['a@x.com', 'b@y.com']);
    expect(splitEmailAddresses('a@x.com / b@y.com / c@z.io')).toEqual(['a@x.com', 'b@y.com', 'c@z.io']);
  });

  it('줄바꿈으로 두 줄 적은 주소를 나눈다', () => {
    expect(splitEmailAddresses('a@x.com\nb@y.com')).toEqual(['a@x.com', 'b@y.com']);
    expect(splitEmailAddresses('a@x.com\r\n b@y.com')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('주소 가운데서 줄이 바뀐 값은 한 주소로 붙인다', () => {
    expect(splitEmailAddresses('abcd@\nexample.kr')).toEqual(['abcd@example.kr']);
    expect(splitEmailAddresses('abcdef@\nexample.co.kr')).toEqual(['abcdef@example.co.kr']);
  });

  it('대소문자만 다른 같은 주소는 한 번만', () => {
    expect(splitEmailAddresses('A@X.com / a@x.com')).toEqual(['A@X.com']);
  });

  it('주소 모양이 아닌 조각은 버리고, 하나도 없으면 빈 배열', () => {
    expect(splitEmailAddresses('a@x.com / 담당자 부재')).toEqual(['a@x.com']);
    expect(splitEmailAddresses('kim@naver')).toEqual([]);
    expect(splitEmailAddresses('')).toEqual([]);
  });

  it('한 통에 보낼 수 있는 상한까지만', () => {
    const many = Array.from({ length: 60 }, (_, i) => `u${i}@x.com`).join(', ');
    expect(splitEmailAddresses(many)).toHaveLength(MAX_RECIPIENTS_PER_MAIL);
  });
});

describe('mailToList', () => {
  it('나눌 수 있으면 나눈 목록, 못 건지면 원래 값 하나', () => {
    expect(mailToList('a@x.com / b@y.com')).toEqual(['a@x.com', 'b@y.com']);
    expect(mailToList('kim@naver')).toEqual(['kim@naver']);
  });
});
