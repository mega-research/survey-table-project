import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 담당 범위 표(`fieldwork_link_shares`)를 만지는 자리의 인벤토리 (ADR-0035).
 *
 * 외주 링크가 **볼 수 있는 대상**을 정하는 표다. 규칙은 둘이다(`src/server/contacts/AGENTS.md`
 * 「외주 담당 범위」):
 *  - 범위로 거르는 술어는 `server/fieldwork-share-scope` 하나다. 표면마다 새로 쓰지 않는다.
 *  - 범위 표에 쓰는 트랜잭션의 잠금 순서·세기는 `server/fieldwork-share-write` 한 벌이다.
 *
 * 이 규칙은 조용히 깨진다. 2026-11-09 구현에서 서비스 세 곳이 범위 표를 날 SQL 로 다시 읽었고,
 * 링크 종료가 표를 따로 지웠다 — 문서는 「하나다」라고 적고 있었고 tsc·테스트는 전부 초록이었다.
 * 사본이 생기면 한쪽만 고쳐지고, 그 틈으로 다른 업체의 대상이 보인다.
 *
 * 그래서 이 표를 참조하는 파일을 목록으로 못 박는다. **새 자리가 생기면 이 파일이 빨개지고,**
 * 그때 답은 대개 「`fieldwork-share-scope` 의 술어·조각을 부른다」다. 정말 새 자리가 필요하면
 * 사유와 함께 등재한다.
 */

const REPO_ROOT = join(import.meta.dirname, '../..');

/** 스키마 심볼(`fieldworkLinkShares`)이나 표 이름을 코드에서 참조해도 되는 자리. */
const KNOWN_REFERENCES: Record<string, string> = {
  'src/db/schema/workspace.ts': '표 정의',
  'src/server/fieldwork-share-scope.ts': '술어 정본 — 범위로 거르는 조건과 링크 하나의 범위 조각',
  'src/server/fieldwork-share-write.ts':
    '쓰기 공용 조각 — 잠금 순서·세기·해제(나누기와 링크 종료가 부른다)',
  'src/server/contacts/services/fieldwork-shares.ts': '나누기 서비스 — 적용·없애기·겹침 조회',
  'src/server/contacts/services/fieldwork-share-release.ts':
    '명단 교체 업로드가 풀 범위의 링크별 인원 — 읽기 전용',
};

/**
 * 표 이름을 **날 문자열**로 쓰는 자리는 표 정의뿐이다. 날 SQL 안에서도 `${fieldworkLinkShares}` 로 쓴다 —
 * 스키마 심볼을 거치지 않으면 개명이 따라오지 않는다.
 */
const KNOWN_RAW_NAME = ['src/db/schema/workspace.ts'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [path];
  });
}

/** 주석 줄은 뺀다 — 이 표를 설명하는 문장은 참조가 아니다. */
function codeLines(source: string): string[] {
  return source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

describe('담당 범위 표를 참조하는 자리', () => {
  const sources = sourceFiles(join(REPO_ROOT, 'src')).map((file) => ({
    file: relative(REPO_ROOT, file),
    lines: codeLines(readFileSync(file, 'utf8')),
  }));
  const filesMatching = (pattern: RegExp) =>
    sources
      .filter(({ lines }) => lines.some((line) => pattern.test(line)))
      .map(({ file }) => file)
      .sort();

  it('목록에 적힌 자리뿐이다 — 새 자리는 술어 정본을 부르거나 사유와 함께 등재한다', () => {
    expect(filesMatching(/\bfieldworkLinkShares\b|\bfieldwork_link_shares\b/)).toEqual(
      Object.keys(KNOWN_REFERENCES).sort(),
    );
  });

  it('표 이름을 날 문자열로 쓴 자리는 표 정의뿐이다', () => {
    expect(filesMatching(/\bfieldwork_link_shares\b/)).toEqual([...KNOWN_RAW_NAME].sort());
  });
});
