import { describe, expect, it } from 'vitest';

import { getTrustedClientIp } from '@/lib/rate-limit/client-ip';

/**
 * 신뢰 클라이언트 IP 추출. x-forwarded-for 최좌측 토큰(실제 클라)을 신뢰하고,
 * 부재 시 x-real-ip 폴백, 최종 'unknown'.
 */
describe('getTrustedClientIp', () => {
  it('x-forwarded-for 최좌측 토큰을 추출한다', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178',
    });
    expect(getTrustedClientIp(headers)).toBe('203.0.113.7');
  });

  it('x-forwarded-for 토큰의 공백을 트림한다', () => {
    const headers = new Headers({
      'x-forwarded-for': '   198.51.100.42  , 10.0.0.1',
    });
    expect(getTrustedClientIp(headers)).toBe('198.51.100.42');
  });

  it('단일 값 x-forwarded-for 도 그대로 추출한다', () => {
    const headers = new Headers({ 'x-forwarded-for': '192.0.2.1' });
    expect(getTrustedClientIp(headers)).toBe('192.0.2.1');
  });

  it('x-forwarded-for 부재 시 x-real-ip 로 폴백한다', () => {
    const headers = new Headers({ 'x-real-ip': '198.51.100.99' });
    expect(getTrustedClientIp(headers)).toBe('198.51.100.99');
  });

  it('x-forwarded-for 가 빈/공백 토큰만 있으면 x-real-ip 로 폴백한다', () => {
    const headers = new Headers({
      'x-forwarded-for': '   ,  ',
      'x-real-ip': '203.0.113.250',
    });
    expect(getTrustedClientIp(headers)).toBe('203.0.113.250');
  });

  it('두 헤더 모두 부재 시 unknown 을 반환한다', () => {
    const headers = new Headers();
    expect(getTrustedClientIp(headers)).toBe('unknown');
  });

  it('x-real-ip 가 공백뿐이면 unknown 을 반환한다', () => {
    const headers = new Headers({ 'x-real-ip': '   ' });
    expect(getTrustedClientIp(headers)).toBe('unknown');
  });
});
