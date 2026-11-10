'use client';

import { useSyncExternalStore } from 'react';

// 펼쳐 둔 묶음 이름 — 브라우저마다 기억한다. 계정을 여럿이 같이 써도 실사 담당자는 펼쳐 두고
// 다른 사람은 접어 둘 수 있다. 임시 장치다(`lib/survey-list-groups.server.ts`).
const STORAGE_KEY = 'survey-list-open-groups';
const EMPTY = '[]';

const listeners = new Set<() => void>();
// 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)에서도 이 탭 안에서는 펼침이 유지되게 하는 사본.
let memory = EMPTY;

function readRaw(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memory;
  } catch {
    return memory;
  }
}

function writeNames(names: string[]): void {
  memory = JSON.stringify(names);
  try {
    window.localStorage.setItem(STORAGE_KEY, memory);
  } catch {
    // 저장 실패는 조용히 넘긴다 — 새로고침하면 접힌 상태로 돌아갈 뿐이다.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export function parseOpenGroupNames(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function useOpenSurveyListGroups(): {
  openGroups: string[];
  toggleGroup: (name: string) => void;
} {
  const raw = useSyncExternalStore(subscribe, readRaw, () => EMPTY);
  const openGroups = parseOpenGroupNames(raw);
  const toggleGroup = (name: string) => {
    writeNames(
      openGroups.includes(name) ? openGroups.filter((n) => n !== name) : [...openGroups, name],
    );
  };
  return { openGroups, toggleGroup };
}
