import { createHash } from 'node:crypto';
import type { ClientSignals, ServerSignals } from './types';

function getSalt(): string {
  const salt = process.env.DUPLICATE_DETECTION_SALT;
  if (!salt) {
    throw new Error('DUPLICATE_DETECTION_SALT not set');
  }
  return salt;
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
  const salt = getSalt();
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
    ipHash: ip ? sha256(ip + salt) : null,
    fpHash: sha256(fpInput + salt),
    deviceId: client.deviceId,
  };
}
