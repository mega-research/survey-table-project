import { describe, expect, it } from 'vitest';

import {
  fieldworkLinkCookieName,
  isAccessLinkToken,
  readFieldworkLinkSessions,
  signAccessLinkSession,
  verifyAccessLinkSession,
  type AccessLinkSessionClaim,
} from './access-link-session';

const CLAIM: AccessLinkSessionClaim = {
  linkId: '11111111-1111-4111-8111-111111111111',
  surveyId: '22222222-2222-4222-8222-222222222222',
  passwordUpdatedAt: '2026-09-29T04:05:06.007Z',
};

const TOKEN = 'abcDEF0123456789';
const OTHER_TOKEN = 'zyxWVU9876543210';

function cookieHeader(...pairs: Array<[string, string]>): Headers {
  return new Headers({ cookie: pairs.map(([k, v]) => `${k}=${v}`).join('; ') });
}

describe('링크 토큰 모양', () => {
  it('nanoid URL-safe 16자 이상만 받는다', () => {
    expect(isAccessLinkToken(TOKEN)).toBe(true);
    expect(isAccessLinkToken('short')).toBe(false);
  });

  it('쿠키 헤더를 쪼갤 수 있는 글자를 거부한다 — 이름에 붙는 값이다', () => {
    for (const bad of ['abcDEF0123456789; x=1', 'abcDEF012345 6789', 'abcDEF0123456789=']) {
      expect(isAccessLinkToken(bad), bad).toBe(false);
      expect(() => fieldworkLinkCookieName(bad)).toThrow();
    }
  });
});

describe('세션 쿠키 서명', () => {
  it('서명한 것을 그대로 되읽는다', () => {
    expect(verifyAccessLinkSession(signAccessLinkSession(CLAIM))).toEqual(CLAIM);
  });

  it('payload 를 손대면 거부한다 — 설문 id 를 갈아끼운 쿠키가 통과하면 안 된다', () => {
    const signed = signAccessLinkSession(CLAIM);
    const forged = Buffer.from(
      JSON.stringify({ ...CLAIM, surveyId: '33333333-3333-4333-8333-333333333333' }),
    ).toString('base64url');
    expect(verifyAccessLinkSession(`${forged}.${signed.split('.')[1]}`)).toBeNull();
  });

  it('서명 없는 값·빈 값·쓰레기를 거부한다', () => {
    for (const bad of ['', '.', 'payloadonly', 'a.b', `${signAccessLinkSession(CLAIM)}x`]) {
      expect(verifyAccessLinkSession(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('필드가 빠진 payload 는 서명이 맞아도 거부한다', () => {
    // 우리가 서명한 값이라도 모양이 계약과 다르면 판정 재료가 되지 못한다.
    const payload = Buffer.from(JSON.stringify({ linkId: CLAIM.linkId })).toString('base64url');
    const signed = signAccessLinkSession(CLAIM);
    expect(verifyAccessLinkSession(`${payload}.${signed.split('.')[1]}`)).toBeNull();
  });
});

describe('요청 헤더에서 링크 세션 읽기', () => {
  it('여러 설문의 링크 세션이 서로 섞이지 않는다', () => {
    const other: AccessLinkSessionClaim = {
      ...CLAIM,
      linkId: '44444444-4444-4444-8444-444444444444',
      surveyId: '55555555-5555-4555-8555-555555555555',
    };
    const sessions = readFieldworkLinkSessions(
      cookieHeader(
        ['better-auth.session_token', 'irrelevant'],
        [fieldworkLinkCookieName(TOKEN), signAccessLinkSession(CLAIM)],
        [fieldworkLinkCookieName(OTHER_TOKEN), signAccessLinkSession(other)],
      ),
    );
    expect(sessions).toEqual([
      { token: TOKEN, claim: CLAIM },
      { token: OTHER_TOKEN, claim: other },
    ]);
  });

  it('쿠키가 없으면 빈 목록이다 — 응답자 요청이 이 경로를 그냥 지난다', () => {
    expect(readFieldworkLinkSessions(new Headers())).toEqual([]);
  });

  it('위조된 쿠키는 목록에 서지 않는다', () => {
    expect(
      readFieldworkLinkSessions(cookieHeader([fieldworkLinkCookieName(TOKEN), 'forged.value'])),
    ).toEqual([]);
  });

  it('접두가 맞아도 토큰 모양이 아니면 건너뛴다', () => {
    expect(readFieldworkLinkSessions(cookieHeader(['fw_short', 'anything']))).toEqual([]);
  });

  it('퍼센트 디코딩이 불가능한 값에도 던지지 않는다', () => {
    // `decodeURIComponent('%')` 는 URIError 를 던진다. 이 함수는 createContext 에서 **모든**
    // 요청에 돌므로, 브라우저에 망가진 fw_ 쿠키 한 줄이 남으면 그 브라우저의 RPC 전체가 500 이
    // 된다 — 링크와 무관한 사람까지 끊는 사고다.
    for (const bad of ['%', '%E0%A4%A', `${signAccessLinkSession(CLAIM)}%`]) {
      expect(() =>
        readFieldworkLinkSessions(cookieHeader([fieldworkLinkCookieName(TOKEN), bad])),
      ).not.toThrow();
    }
    expect(
      readFieldworkLinkSessions(cookieHeader([fieldworkLinkCookieName(TOKEN), '%'])),
    ).toEqual([]);
  });

  it('퍼센트 인코딩된 정상 쿠키는 그대로 되읽는다', () => {
    const signed = signAccessLinkSession(CLAIM);
    expect(
      readFieldworkLinkSessions(
        cookieHeader([fieldworkLinkCookieName(TOKEN), encodeURIComponent(signed)]),
      ),
    ).toEqual([{ token: TOKEN, claim: CLAIM }]);
  });
});
