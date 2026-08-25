import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * ADR 0017 — 단위 테스트의 집은 SUT 소스 옆(colocation)이다.
 *
 * tests/ 아래에서 .test 파일이 살 수 있는 곳은 계층·계약 스위트 셋뿐이다 —
 * integration(실DB 포함)·e2e·repo. 누군가 습관적으로 tests/unit 을 부활시키면
 * 문서가 아니라 이 테스트가 즉시 RED 로 알린다. server-tree-naming(ADR 0016)과
 * 같은 방식의 별파일 메타테스트로, 각자 자기 ADR 만 담당한다.
 */

const TESTS_ROOT = join(process.cwd(), 'tests');
const ALLOWED_TOP_DIRS = new Set(['integration', 'e2e', 'repo']);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() ? [full] : [];
  });
}

describe('테스트 트리 배치 규약 (ADR 0017)', () => {
  it('tests/ 아래 .test 파일은 integration·e2e·repo 에만 존재한다', () => {
    const offenders = walk(TESTS_ROOT)
      .filter((p) => /\.test\.[jt]sx?$/.test(p))
      .filter((p) => {
        const top = p.slice(TESTS_ROOT.length + 1).split('/')[0];
        return !ALLOWED_TOP_DIRS.has(top ?? '');
      })
      .map((p) => p.slice(process.cwd().length + 1));

    expect(
      offenders,
      `단위 테스트는 tests/ 가 아니라 SUT 소스 옆으로 — ADR 0017 위반:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
