import { createHash } from 'node:crypto';
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

export function extractIp(h: Headers): string | null {
  const xff = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (xff) return xff;
  return h.get('x-real-ip') ?? null;
}

export function computeSignals(h: Headers, client: ClientSignals): ServerSignals {
  const ip = extractIp(h);
  const ua = h.get('user-agent') ?? '';

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
