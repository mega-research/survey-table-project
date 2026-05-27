import { describe, it, expect, beforeAll } from 'vitest';
import type { ClientSignals } from '@/lib/duplicate-detection/types';

beforeAll(() => {
  process.env.DUPLICATE_DETECTION_SALT = 'test-salt-do-not-use-in-prod';
});

describe('extractIp', () => {
  it('x-forwarded-for의 첫 번째 IP 우선', async () => {
    const { extractIp } = await import('@/lib/duplicate-detection/signals');
    const h = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(extractIp(h)).toBe('1.2.3.4');
  });

  it('x-forwarded-for 없으면 x-real-ip 사용', async () => {
    const { extractIp } = await import('@/lib/duplicate-detection/signals');
    const h = new Headers({ 'x-real-ip': '9.9.9.9' });
    expect(extractIp(h)).toBe('9.9.9.9');
  });

  it('둘 다 없으면 null', async () => {
    const { extractIp } = await import('@/lib/duplicate-detection/signals');
    expect(extractIp(new Headers())).toBeNull();
  });

  it('x-forwarded-for 공백 trim', async () => {
    const { extractIp } = await import('@/lib/duplicate-detection/signals');
    const h = new Headers({ 'x-forwarded-for': '  1.2.3.4  , 5.6.7.8' });
    expect(extractIp(h)).toBe('1.2.3.4');
  });
});

describe('computeSignals', () => {
  const sampleClient: ClientSignals = {
    deviceId: 'dev-uuid-1',
    screen: '1920x1080',
    dpr: 2,
    tz: 'Asia/Seoul',
    lang: 'ko-KR',
    platform: 'MacIntel',
  };

  it('같은 입력 → 같은 hash (결정성)', async () => {
    const { computeSignals } = await import('@/lib/duplicate-detection/signals');
    const h = new Headers({
      'x-forwarded-for': '1.2.3.4',
      'user-agent': 'Mozilla/5.0 Chrome/120',
    });
    const a = computeSignals(h, sampleClient);
    const b = computeSignals(h, sampleClient);
    expect(a).toEqual(b);
  });

  it('IP가 다르면 ipHash 다름', async () => {
    const { computeSignals } = await import('@/lib/duplicate-detection/signals');
    const h1 = new Headers({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'X' });
    const h2 = new Headers({ 'x-forwarded-for': '5.6.7.8', 'user-agent': 'X' });
    const a = computeSignals(h1, sampleClient);
    const b = computeSignals(h2, sampleClient);
    expect(a.ipHash).not.toBe(b.ipHash);
    expect(a.fpHash).toBe(b.fpHash);
  });

  it('UA만 다르면 fpHash 다름, ipHash 같음', async () => {
    const { computeSignals } = await import('@/lib/duplicate-detection/signals');
    const h1 = new Headers({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'Chrome' });
    const h2 = new Headers({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'Safari' });
    const a = computeSignals(h1, sampleClient);
    const b = computeSignals(h2, sampleClient);
    expect(a.ipHash).toBe(b.ipHash);
    expect(a.fpHash).not.toBe(b.fpHash);
  });

  it('deviceId는 그대로 통과 (hash X)', async () => {
    const { computeSignals } = await import('@/lib/duplicate-detection/signals');
    const h = new Headers({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'X' });
    const r = computeSignals(h, sampleClient);
    expect(r.deviceId).toBe('dev-uuid-1');
  });

  it('IP가 null이면 ipHash도 null', async () => {
    const { computeSignals } = await import('@/lib/duplicate-detection/signals');
    const h = new Headers({ 'user-agent': 'X' });
    const r = computeSignals(h, sampleClient);
    expect(r.ipHash).toBeNull();
  });

  it('client.deviceId가 null이면 결과 deviceId도 null', async () => {
    const { computeSignals } = await import('@/lib/duplicate-detection/signals');
    const h = new Headers({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'X' });
    const r = computeSignals(h, { ...sampleClient, deviceId: null });
    expect(r.deviceId).toBeNull();
  });
});
