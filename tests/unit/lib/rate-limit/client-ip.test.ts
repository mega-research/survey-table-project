import { describe, expect, it } from 'vitest';

import {
  getTrustedClientIp,
  getTrustedClientIpOrNull,
  UNKNOWN_CLIENT_IP,
} from '@/lib/rate-limit/client-ip';

/**
 * 신뢰 클라이언트 IP 추출. 위조 불가한 단일 값 헤더(x-vercel-forwarded-for/x-real-ip)를
 * 위조 가능한 leftmost x-forwarded-for 보다 우선한다. 추출 불가 시 null/'unknown'.
 */
describe('getTrustedClientIpOrNull', () => {
  it('x-vercel-forwarded-for 가 있으면 최우선으로 신뢰한다', () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': '203.0.113.7',
      // 공격자가 위조 주입한 x-forwarded-for 좌측 토큰은 무시되어야 한다.
      'x-forwarded-for': '1.2.3.4, 203.0.113.7',
      'x-real-ip': '9.9.9.9',
    });
    expect(getTrustedClientIpOrNull(headers)).toBe('203.0.113.7');
  });

  it('x-vercel-forwarded-for 부재 시 x-real-ip 를 x-forwarded-for 보다 우선한다', () => {
    const headers = new Headers({
      'x-forwarded-for': '1.2.3.4, 198.51.100.42',
      'x-real-ip': '198.51.100.42',
    });
    expect(getTrustedClientIpOrNull(headers)).toBe('198.51.100.42');
  });

  it('단일 값 신뢰 헤더가 모두 없으면 x-forwarded-for 최좌측 토큰으로 폴백한다', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178',
    });
    expect(getTrustedClientIpOrNull(headers)).toBe('203.0.113.7');
  });

  it('x-forwarded-for 폴백 시 최좌측 토큰의 공백을 트림한다', () => {
    const headers = new Headers({
      'x-forwarded-for': '   198.51.100.42  , 10.0.0.1',
    });
    expect(getTrustedClientIpOrNull(headers)).toBe('198.51.100.42');
  });

  it('단일 값 x-forwarded-for 도 폴백으로 추출한다', () => {
    const headers = new Headers({ 'x-forwarded-for': '192.0.2.1' });
    expect(getTrustedClientIpOrNull(headers)).toBe('192.0.2.1');
  });

  it('x-vercel-forwarded-for 공백을 트림한다', () => {
    const headers = new Headers({ 'x-vercel-forwarded-for': '  203.0.113.250  ' });
    expect(getTrustedClientIpOrNull(headers)).toBe('203.0.113.250');
  });

  it('x-forwarded-for 가 빈/공백 토큰만 있고 신뢰 헤더가 없으면 null 을 반환한다', () => {
    const headers = new Headers({ 'x-forwarded-for': '   ,  ' });
    expect(getTrustedClientIpOrNull(headers)).toBeNull();
  });

  it('모든 헤더 부재 시 null 을 반환한다', () => {
    expect(getTrustedClientIpOrNull(new Headers())).toBeNull();
  });

  it('x-real-ip 가 공백뿐이면 x-forwarded-for 폴백 후 null', () => {
    const headers = new Headers({ 'x-real-ip': '   ' });
    expect(getTrustedClientIpOrNull(headers)).toBeNull();
  });
});

describe('getTrustedClientIp', () => {
  it('추출 성공 시 IP 문자열을 반환한다', () => {
    const headers = new Headers({ 'x-real-ip': '198.51.100.99' });
    expect(getTrustedClientIp(headers)).toBe('198.51.100.99');
  });

  it('추출 불가 시 UNKNOWN_CLIENT_IP 센티넬을 반환한다', () => {
    expect(getTrustedClientIp(new Headers())).toBe(UNKNOWN_CLIENT_IP);
    expect(UNKNOWN_CLIENT_IP).toBe('unknown');
  });
});
