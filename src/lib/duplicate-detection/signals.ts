import { createHash } from 'node:crypto';

import { getTrustedClientIp } from '@/lib/rate-limit/client-ip';

import type { ClientSignals, ServerSignals } from './types';

// Module-level fail-fast: server boot 또는 첫 import 시 즉시 검증
// salt 누락 시 silent fallthrough 로 중복 차단이 무력화되는 보안 risk 차단
// 한 번 정한 salt 는 절대 회전하지 말 것 — 회전 시 기존 hash 무용지물
const SALT = process.env['DUPLICATE_DETECTION_SALT'];
if (!SALT) {
  throw new Error(
    'DUPLICATE_DETECTION_SALT not set. Add to .env.local (dev) and deploy env (prod/CI).',
  );
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * 헤더에서 IP 를 추출한다. rate limit 과 동일한 신뢰 추출 경로(getTrustedClientIp)를 공유한다.
 * 추출 불가('unknown')면 null 을 반환해 ipHash 를 만들지 않는다(IP 신호 부재).
 */
export function extractIp(h: Headers): string | null {
  const ip = getTrustedClientIp(h);
  return ip === 'unknown' ? null : ip;
}

export function computeSignals(h: Headers, client: ClientSignals): ServerSignals {
  const ip = extractIp(h);
  const ua = h.get('user-agent') ?? '';

  // deviceId/UA/screen 등 클라이언트 핑거프린트는 soft anti-abuse 신호일 뿐이다.
  // 클라이언트가 위조/초기화할 수 있으므로(시크릿 모드, storage 차단, UA 스푸핑)
  // 하드 차단의 근거로 삼지 않고, 서버 신호(ipHash)와 병행하는 보조 지표로만 쓴다.

  const fpInput = [
    ua,
    client.screen,
    client.tz,
    client.lang,
    client.platform,
  ].join('|');

  return {
    ipHash: ip ? sha256(ip + SALT) : null,
    fpHash: sha256(fpInput + SALT),
    deviceId: client.deviceId,
  };
}
