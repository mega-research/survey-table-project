import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 한 테스트 파일이 같은 모듈에 `vi.mock` 을 두 번 걸지 않는다 (루트 AGENTS.md 주의사항 10).
 *
 * 같은 경로에 두 번 걸면 어느 팩토리가 이기는지 보장되지 않는다. `profiles-row-actions` 가 그래서
 * 14건 중 12건이 간헐적으로 무너졌고, 「전체 스위트에서만 깨지는 모킹 간섭」으로 오진돼 격리 실행
 * 구조까지 생겼었다(2026-08-19 수리).
 */

const ROOTS = ['src', 'tests', 'workers'];

function walkTests(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walkTests(full);
    return entry.isFile() && /\.test\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** 파일 본문에서 두 번 이상 `vi.mock` 된 모듈 경로. 주석 안의 예시는 세지 않는다. */
function duplicatedMocks(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const counts = new Map<string, number>();
  for (const m of code.matchAll(/\bvi\.mock\(\s*(['"`])([^'"`]+)\1/g)) {
    const path = m[2] ?? '';
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n > 1).map(([path]) => path);
}

describe('vi.mock 은 모듈마다 한 번', () => {
  it('검사기가 중복만 잡고 주석 속 예시는 넘긴다', () => {
    expect(
      duplicatedMocks(`
        vi.mock('@/db/schema', () => ({ a: 1 }));
        // vi.mock('@/db', ...) 처럼 쓰면 안 된다
        vi.mock('@/db', () => ({}));
        vi.mock("@/db/schema", () => ({ b: 2 }));
      `),
    ).toEqual(['@/db/schema']);
  });

  it('어느 테스트 파일도 같은 모듈을 두 번 mock 하지 않는다', () => {
    // 이 파일은 검사기 견본으로 중복을 일부러 품고 있다.
    const self = join(process.cwd(), 'tests/repo/vi-mock-once.test.ts');
    const offenders = ROOTS.flatMap((root) => walkTests(join(process.cwd(), root)))
      .filter((full) => full !== self)
      .flatMap((full) =>
        duplicatedMocks(readFileSync(full, 'utf8')).map(
          (path) => `${relative(process.cwd(), full)} — ${path}`,
        ),
    );
    expect(
      offenders,
      `같은 모듈에 vi.mock 이 두 번 걸렸다 — 팩토리 하나로 합친다:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
