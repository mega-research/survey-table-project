'use client';

import { useEffect, useRef } from 'react';
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
    dpr: window.devicePixelRatio,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang: navigator.language,
    platform: navigator.platform,
  };
}

/**
 * 마운트 시 한 번 신호를 수집해 ref에 보관한다.
 * 서버 측에서 hash 계산 → 첫 답변 시 같은 신호를 다시 전달.
 */
export function useClientSignals(): React.MutableRefObject<ClientSignals | null> {
  const ref = useRef<ClientSignals | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    ref.current = collectSignals();
  }, []);
  return ref;
}
