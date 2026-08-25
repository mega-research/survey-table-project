import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * ADR 0016 — server/ 트리 파일명 무접미사 규약의 강제 시임.
 *
 * server/ 트리 안에서 .service.ts / .server.ts 접미사는 금지다 — 폴더 경로가
 * 이미 계층을 말하므로 접미사는 정보가 아니라 드리프트 표면이다. `.server.ts` 는
 * lib 등 공유 트리에서만 "서버 전용" 표시로 쓴다 (내용물 기준 마킹).
 *
 * 이 테스트는 문서가 아니라 스위트가 규약을 지키게 하는 유일한 신설 시임이다
 * (2026-08-25 grilling 합의) — lib 쪽 마킹의 내용물 검증 등으로 확장하지 않는다.
 */

const SERVER_ROOT = join(process.cwd(), 'src/server');
const FORBIDDEN = /\.(service|server)\./;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() ? [full] : [];
  });
}

describe('server 트리 파일명 규약 (ADR 0016)', () => {
  it('src/server 아래에 .service.ts / .server.ts 접미사 파일이 없다', () => {
    const offenders = walk(SERVER_ROOT)
      .filter((p) => FORBIDDEN.test(p.slice(SERVER_ROOT.length)))
      .map((p) => p.slice(process.cwd().length + 1));

    expect(offenders, `금지 접미사 파일 발견 — ADR 0016 위반:\n${offenders.join('\n')}`).toEqual([]);
  });
});
