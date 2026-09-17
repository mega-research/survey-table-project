'use client';

import { useEffect, useState } from 'react';
import type { ClientSignals } from '@/lib/duplicate-detection/types';

const STORAGE_KEY = '__sd_device_id';

function readOrCreateDeviceId(): string | null {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // 시크릿 모드 일부 / storage 차단 시
    return null;
  }
}

function collectSignals(): ClientSignals {
  return {
    deviceId: readOrCreateDeviceId(),
    screen: `${window.screen.width}x${window.screen.height}`,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang: navigator.language,
    platform: navigator.platform,
  };
}

/**
 * 마운트 시 한 번 신호를 수집해 state로 보관한다.
 *
 * 반환값:
 * - `null`: 아직 수집 전 (mount 직후 첫 렌더)
 * - `ClientSignals`: 수집 완료 (deviceId 는 storage 차단 시 null 가능)
 *
 * state 기반이라 신호가 채워지는 시점에 의존하는 useEffect 가 자동 재실행된다.
 */
export function useClientSignals(): ClientSignals | null {
  const [signals, setSignals] = useState<ClientSignals | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    queueMicrotask(() => setSignals(collectSignals()));
  }, []);
  return signals;
}
