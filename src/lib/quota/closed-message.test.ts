import { describe, expect, it } from 'vitest';

import { isMidSurveyCloseActive, resolveMidSurveyClosedMessage } from './closed-message';

describe('resolveMidSurveyClosedMessage', () => {
  it('진행 중 마감 문구가 있으면 그것을 쓴다', () => {
    expect(
      resolveMidSurveyClosedMessage({ closedMessage: '마감', midSurveyClosedMessage: '죄송합니다' }),
    ).toBe('죄송합니다');
  });
  it('비어 있으면(null·공백) 기존 마감 문구로 폴백한다', () => {
    expect(resolveMidSurveyClosedMessage({ closedMessage: '마감', midSurveyClosedMessage: null })).toBe(
      '마감',
    );
    expect(resolveMidSurveyClosedMessage({ closedMessage: '마감', midSurveyClosedMessage: '  ' })).toBe(
      '마감',
    );
    expect(resolveMidSurveyClosedMessage({ closedMessage: '마감' })).toBe('마감');
  });
  it('둘 다 비면 null — 기본 문구는 응답 화면이 정한다', () => {
    expect(resolveMidSurveyClosedMessage({ closedMessage: null })).toBeNull();
  });
});

describe('isMidSurveyCloseActive', () => {
  it('집행 중 + 옵션 켜짐일 때만 참', () => {
    expect(isMidSurveyCloseActive({ enabled: true, midSurveyClose: true })).toBe(true);
    expect(isMidSurveyCloseActive({ enabled: false, midSurveyClose: true })).toBe(false);
    expect(isMidSurveyCloseActive({ enabled: true })).toBe(false);
    expect(isMidSurveyCloseActive(null)).toBe(false);
  });
});
