import { describe, expect, it } from 'vitest';

import { LINK_URL_MAX_LENGTH, classifyClickedLink, parseResendClick } from './link-click';

const APP = 'https://survey.example.co.kr';

describe('classifyClickedLink', () => {
  it.each([
    ['공개 링크(한글 슬러그)', `${APP}/survey/2025년-만족도-조사`],
    ['공개 링크(퍼센트 인코딩)', `${APP}/survey/%EB%A7%8C%EC%A1%B1%EB%8F%84`],
    ['초대 링크', `${APP}/survey/abc?invite=3f0c6c1e-0000-4000-8000-000000000000`],
    ['짧은 초대 링크', `${APP}/i/AbCdEf1234`],
    ['호스트 대소문자', 'https://SURVEY.example.co.kr/survey/x'],
  ])('%s 는 설문 링크이고 주소를 남기지 않는다', (_name, link) => {
    expect(classifyClickedLink(link, APP)).toEqual({ kind: 'survey', url: null });
  });

  it('수신거부 링크는 주소를 남기지 않는다', () => {
    expect(classifyClickedLink(`${APP}/unsubscribe/3f0c6c1e-token`, APP)).toEqual({
      kind: 'unsubscribe',
      url: null,
    });
  });

  it.each([
    ['다른 호스트', 'https://spri.kr/posts?code=stat_sw_ai_reports'],
    ['우리 호스트의 다른 경로', `${APP}/admin/login`],
    ['경로 앞머리만 닮은 것', `${APP}/surveys-list`],
    ['경로 앞머리만 닮은 것(짧은 링크)', `${APP}/index`],
    ['주소로 읽히지 않는 글자', 'mailto:someone'],
  ])('%s 는 그 밖의 링크이고 주소를 남긴다', (_name, link) => {
    expect(classifyClickedLink(link, APP)).toEqual({ kind: 'other', url: link });
  });

  it('앱 주소를 모르면 판정하지 않는다 — 토큰이 든 주소를 그 밖의 링크로 저장하지 않게', () => {
    expect(classifyClickedLink(`${APP}/i/AbCdEf1234`, null)).toBeNull();
    expect(classifyClickedLink(`${APP}/survey/x`, undefined)).toBeNull();
    expect(classifyClickedLink('https://spri.kr/posts', 'not a url')).toBeNull();
  });

  it.each([
    ['짧은 초대 링크', 'https://old.example.co.kr/i/AbCdEf1234', 'https://old.example.co.kr'],
    [
      '초대 링크',
      'https://old.example.co.kr/survey/abc?invite=3f0c6c1e-0000-4000-8000-000000000000',
      'https://old.example.co.kr',
    ],
    [
      '수신거부 링크',
      'https://old.example.co.kr/unsubscribe/3f0c6c1e-token',
      'https://old.example.co.kr',
    ],
  ])(
    '다른 호스트라도 우리 주소 모양(%s)이면 경로와 매개변수를 버리고 사이트 주소만 남긴다',
    (_name, link, origin) => {
      // 발송한 뒤 앱 주소가 바뀌면 옛 메일의 링크가 다른 호스트로 온다 — 그 사람 전용 토큰이 남으면 안 된다.
      expect(classifyClickedLink(link, APP)).toEqual({ kind: 'other', url: origin });
    },
  );

  it('우리 호스트의 다른 경로에 초대 매개변수가 붙어 와도 그 값은 남기지 않는다', () => {
    const stored = classifyClickedLink(
      `${APP}/admin/login?invite=3f0c6c1e-0000-4000-8000-000000000000&from=mail`,
      APP,
    );
    expect(stored?.kind).toBe('other');
    expect(stored?.url).not.toContain('3f0c6c1e');
    expect(stored?.url).toContain('from=mail');
  });

  it('그 밖의 링크 주소는 상한에서 자른다', () => {
    const long = `https://spri.kr/${'a'.repeat(LINK_URL_MAX_LENGTH + 50)}`;
    expect(classifyClickedLink(long, APP)?.url).toHaveLength(LINK_URL_MAX_LENGTH);
  });
});

describe('parseResendClick', () => {
  it('클릭 정보를 읽는다', () => {
    expect(
      parseResendClick({
        ipAddress: '203.0.113.7',
        link: 'https://spri.kr/posts',
        timestamp: '2026-11-20T05:03:10.000Z',
        userAgent: 'Mozilla/5.0',
      }),
    ).toEqual({
      link: 'https://spri.kr/posts',
      timestamp: '2026-11-20T05:03:10.000Z',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('주소가 없으면 null 이다', () => {
    expect(parseResendClick(undefined)).toBeNull();
    expect(parseResendClick({ ipAddress: '203.0.113.7' })).toBeNull();
    expect(parseResendClick({ link: '  ' })).toBeNull();
  });

  it('빠진 칸은 null 로 둔다', () => {
    expect(parseResendClick({ link: 'https://spri.kr' })).toEqual({
      link: 'https://spri.kr',
      timestamp: null,
      ipAddress: null,
      userAgent: null,
    });
  });
});
