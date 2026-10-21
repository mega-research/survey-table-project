import { describe, expect, it } from 'vitest';

import {
  appendEntryParams,
  isEndRedirectUrl,
  normalizeEndRedirects,
  normalizePassParamNames,
  parsePassParamNames,
  pickEntryParams,
  readEntryParams,
  resolveEndRedirectUrl,
} from './end-redirect';

describe('isEndRedirectUrl', () => {
  it('http(s) 절대 주소만 받는다', () => {
    expect(isEndRedirectUrl('https://tally.so/r/rDyxNl')).toBe(true);
    expect(isEndRedirectUrl('http://example.com/done?x=1')).toBe(true);
    expect(isEndRedirectUrl('javascript:alert(1)')).toBe(false);
    expect(isEndRedirectUrl('data:text/html,hi')).toBe(false);
    expect(isEndRedirectUrl('tally.so/r/rDyxNl')).toBe(false);
    expect(isEndRedirectUrl('/relative')).toBe(false);
    expect(isEndRedirectUrl('')).toBe(false);
  });
});

describe('normalizeEndRedirects', () => {
  it('공백을 걷고 유효한 주소만 남긴다', () => {
    expect(
      normalizeEndRedirects({
        completed: '  https://tally.so/r/rDyxNl ',
        screenedOut: 'javascript:alert(1)',
        quotaClosed: '',
      }),
    ).toEqual({ completed: 'https://tally.so/r/rDyxNl' });
  });

  it('남는 주소가 없으면 null', () => {
    expect(normalizeEndRedirects({ completed: ' ', screenedOut: 'nope' })).toBeNull();
    expect(normalizeEndRedirects(null)).toBeNull();
    expect(normalizeEndRedirects(undefined)).toBeNull();
    expect(normalizeEndRedirects('https://a.com')).toBeNull();
  });

  it('모르는 키와 문자열이 아닌 값은 버린다', () => {
    expect(
      normalizeEndRedirects({ completed: 3, extra: 'https://a.com', quotaClosed: 'https://q.com' }),
    ).toEqual({ quotaClosed: 'https://q.com' });
  });
});

describe('resolveEndRedirectUrl', () => {
  const redirects = {
    completed: 'https://tally.so/r/rDyxNl',
    screenedOut: 'https://tally.so/r/4aXgWk',
    quotaClosed: 'https://tally.so/r/jeDOdx',
  };

  it('결과별 주소를 고른다', () => {
    expect(resolveEndRedirectUrl(redirects, 'completed')).toBe('https://tally.so/r/rDyxNl');
    expect(resolveEndRedirectUrl(redirects, 'screened_out')).toBe('https://tally.so/r/4aXgWk');
    expect(resolveEndRedirectUrl(redirects, 'quota_closed')).toBe('https://tally.so/r/jeDOdx');
  });

  it('자격미달 주소가 없으면 완료 주소로 폴백하지 않는다', () => {
    expect(resolveEndRedirectUrl({ completed: redirects.completed }, 'screened_out')).toBeNull();
  });

  it('설정이 없거나 저장된 값이 깨졌으면 null', () => {
    expect(resolveEndRedirectUrl(null, 'completed')).toBeNull();
    expect(resolveEndRedirectUrl({ completed: 'javascript:alert(1)' }, 'completed')).toBeNull();
  });
});

describe('normalizePassParamNames', () => {
  it('이름 규칙에 맞는 것만 순서대로 남기고 중복을 뺀다', () => {
    expect(normalizePassParamNames([' euid ', 'pid', 'euid', 'bad name', '1abc', 3])).toEqual([
      'euid',
      'pid',
    ]);
  });

  it('우리 토큰 이름(invite·test)은 바깥으로 넘기지 않는다', () => {
    expect(normalizePassParamNames(['invite', 'test', 'euid'])).toEqual(['euid']);
  });

  it('다섯 개까지만 받는다', () => {
    expect(normalizePassParamNames(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('배열이 아니면 빈 배열', () => {
    expect(normalizePassParamNames(undefined)).toEqual([]);
    expect(normalizePassParamNames('euid')).toEqual([]);
  });
});

describe('parsePassParamNames', () => {
  it('쉼표·공백으로 나누고 받을 수 없는 이름을 따로 돌려준다', () => {
    expect(parsePassParamNames(' euid, pid  invite,가나 ')).toEqual({
      names: ['euid', 'pid'],
      invalid: ['invite', '가나'],
    });
    expect(parsePassParamNames('   ')).toEqual({ names: [], invalid: [] });
  });
});

describe('normalizeEndRedirects — 이어 넘길 값', () => {
  it('주소와 함께 이름 목록을 정규화해 남긴다', () => {
    expect(
      normalizeEndRedirects({ completed: 'https://tally.so/r/rDyxNl', passParams: ['euid', 'test'] }),
    ).toEqual({ completed: 'https://tally.so/r/rDyxNl', passParams: ['euid'] });
  });

  it('주소가 없어도 이름만 있으면 남긴다(주소를 나중에 적어도 기록은 시작된다)', () => {
    expect(normalizeEndRedirects({ passParams: ['euid'] })).toEqual({ passParams: ['euid'] });
  });

  it('남는 이름이 없으면 키를 만들지 않는다', () => {
    expect(normalizeEndRedirects({ completed: 'https://a.com', passParams: ['invite'] })).toEqual({
      completed: 'https://a.com',
    });
  });
});

describe('pickEntryParams', () => {
  it('설정된 이름의 값만 고른다', () => {
    const query = new URLSearchParams('euid=12345&invite=abc&utm=x');
    expect(pickEntryParams(['euid'], query)).toEqual({ euid: '12345' });
  });

  it('값이 비었거나 너무 길면 버린다 — 잘린 ID 는 다른 사람의 ID 다', () => {
    expect(pickEntryParams(['euid', 'pid'], new URLSearchParams('euid=%20%20&pid=1'))).toEqual({
      pid: '1',
    });
    expect(pickEntryParams(['euid'], { euid: 'x'.repeat(201) })).toEqual({});
    expect(pickEntryParams(['euid'], { euid: 'x'.repeat(200) })).toEqual({ euid: 'x'.repeat(200) });
  });

  it('객체 입력은 문자열 값만 받는다', () => {
    expect(pickEntryParams(['euid', 'pid'], { euid: 12345, pid: ' 7 ' })).toEqual({ pid: '7' });
  });

  it('설정이나 입력이 없으면 빈 객체', () => {
    expect(pickEntryParams([], new URLSearchParams('euid=1'))).toEqual({});
    expect(pickEntryParams(['euid'], null)).toEqual({});
  });
});

describe('appendEntryParams', () => {
  it('쿼리가 없는 주소에 붙인다', () => {
    expect(appendEntryParams('https://tally.so/r/rDyxNl', { euid: '12345' })).toBe(
      'https://tally.so/r/rDyxNl?euid=12345',
    );
  });

  it('이미 쿼리가 있으면 이어 붙이고 값은 인코딩한다', () => {
    expect(appendEntryParams('https://p.example/done?src=a', { euid: 'a&b=c 한' })).toBe(
      'https://p.example/done?src=a&euid=a%26b%3Dc+%ED%95%9C',
    );
  });

  it('같은 이름이 주소에 있으면 들어온 값으로 바꾼다', () => {
    expect(appendEntryParams('https://p.example/done?euid=', { euid: '9' })).toBe(
      'https://p.example/done?euid=9',
    );
  });

  it('넘길 값이 없으면 주소를 그대로 둔다', () => {
    expect(appendEntryParams('https://tally.so/r/rDyxNl', {})).toBe('https://tally.so/r/rDyxNl');
  });
});

describe('resolveEndRedirectUrl — 이어 넘길 값', () => {
  it('고른 주소에 들어온 값을 붙인다', () => {
    expect(
      resolveEndRedirectUrl({ screenedOut: 'https://tally.so/r/4aXgWk' }, 'screened_out', {
        euid: '12345',
      }),
    ).toBe('https://tally.so/r/4aXgWk?euid=12345');
  });

  it('주소가 없으면 값이 있어도 null', () => {
    expect(resolveEndRedirectUrl({ passParams: ['euid'] }, 'completed', { euid: '1' })).toBeNull();
  });
});

describe('readEntryParams', () => {
  it('응답 행 metadata 에서 문자열 값만 읽는다', () => {
    expect(readEntryParams({ draftSeq: 3, entryParams: { euid: '12345', bad: 1 } })).toEqual({
      euid: '12345',
    });
  });

  it('없거나 모양이 깨졌으면 undefined', () => {
    expect(readEntryParams(null)).toBeUndefined();
    expect(readEntryParams({ draftSeq: 3 })).toBeUndefined();
    expect(readEntryParams({ entryParams: 'euid=1' })).toBeUndefined();
    expect(readEntryParams({ entryParams: { bad: 1 } })).toBeUndefined();
  });
});
