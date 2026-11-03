import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 회귀 가드: 에이전트 문서가 다시 한 파일로 불어나지 않는다.
 *
 * 루트 `AGENTS.md`(= `CLAUDE.md`)는 매 세션 통째로 실린다. 16.5만 자까지 불어 Claude Code 의
 * 15만 자 경고를 넘었고, 영역 문서로 나눈 직후(4.1만)에도 병합 한 번에 5만 자로 돌아갔다 —
 * update-docs 스킬의 「4만 자 안팎」 규칙만으로는 막지 못했다. 그래서 상한을 테스트로 건다.
 *
 * 영역 문서(`src/**\/AGENTS.md`)는 그 폴더의 파일을 읽을 때 실리므로 상한이 따로다. 넘으면
 * 문장을 줄이기 전에 **더 깊은 폴더로 내릴 수 있는지**를 먼저 본다.
 */

const ROOT = process.cwd();
const ROOT_LIMIT = 45_000;
const AREA_LIMIT = 30_000;

function areaDocs(dir = path.join(ROOT, 'src')): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...areaDocs(full));
    else if (entry.name === 'AGENTS.md') found.push(path.relative(ROOT, full));
  }
  return found.sort();
}

const charCount = (rel: string) => [...readFileSync(path.join(ROOT, rel), 'utf8')].length;

const AREA_DOCS = areaDocs();

describe('에이전트 문서 크기', () => {
  it('열거가 죽지 않았다 — 영역 문서를 실제로 찾는다', () => {
    expect(AREA_DOCS.length).toBeGreaterThan(5);
  });

  it(`루트 AGENTS.md 는 ${ROOT_LIMIT.toLocaleString()}자를 넘지 않는다`, () => {
    const size = charCount('AGENTS.md');
    expect(
      size,
      `루트 AGENTS.md 가 ${size}자다. 새 상세 절은 그 코드 옆 영역 문서(src/**/AGENTS.md)로 옮기고 루트 "문서 지도"에 한 줄만 둘 것`,
    ).toBeLessThanOrEqual(ROOT_LIMIT);
  });

  it.each(AREA_DOCS)(`%s 는 ${AREA_LIMIT.toLocaleString()}자를 넘지 않는다`, (rel) => {
    const size = charCount(rel);
    expect(
      size,
      `${rel} 이 ${size}자다. 절을 더 깊은 폴더의 AGENTS.md 로 내리거나, 정본이 따로 있는 문장을 줄일 것`,
    ).toBeLessThanOrEqual(AREA_LIMIT);
  });
});

describe('영역 문서 배선', () => {
  it.each(['AGENTS.md', ...AREA_DOCS])('%s 옆에 CLAUDE.md 심볼릭 링크가 있다', (rel) => {
    // Claude Code 는 CLAUDE.md 를 찾는다 — 링크가 없으면 그 폴더를 만질 때 문서가 실리지 않는다.
    const link = path.join(ROOT, path.dirname(rel), 'CLAUDE.md');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe('AGENTS.md');
  });

  it('루트 "문서 지도"가 영역 문서를 빠짐없이 가리킨다', () => {
    const root = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
    const listed = new Set([...root.matchAll(/`(src\/[^`]+\/AGENTS\.md)`/g)].map((m) => m[1]));
    const missing = AREA_DOCS.filter((rel) => !listed.has(rel));
    expect(missing, '문서 지도 표에 없는 영역 문서 — 다른 도구는 이 표로 문서를 찾는다').toEqual(
      [],
    );
  });
});
