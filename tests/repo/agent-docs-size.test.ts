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
 * 영역 문서(`src/**\/AGENTS.md` · `supabase/AGENTS.md`)는 그 폴더의 파일을 읽을 때 실리므로 상한이 따로다. 넘으면
 * 문장을 줄이기 전에 **더 깊은 폴더로 내릴 수 있는지**를 먼저 본다.
 */

const ROOT = process.cwd();
const ROOT_LIMIT = 45_000;
const AREA_LIMIT = 30_000;
const CAUTION_ITEM_LIMIT = 1_500;
// 용어집(CONTEXT.md)은 상한이 없어, 상한이 걸린 문서들에서 밀려난 구현 사실이 여기로 쌓였다 —
// 2026-11-13 에 122,754자 중 「구현 메모」 22덩이가 28,070자(23%)였고, 전부 그 모듈의 문서 주석으로 옮겼다.
const GLOSSARY_LIMIT = 100_000;

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

// 영역 문서가 사는 뿌리 — src 아래와, 마이그레이션·드리프트 문서가 있는 supabase.
const AREA_DOCS = [...areaDocs(), ...areaDocs(path.join(ROOT, 'supabase'))];

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

  it(`루트 주의사항 항목은 하나에 ${CAUTION_ITEM_LIMIT.toLocaleString()}자를 넘지 않는다`, () => {
    // 전체 상한만 있으면 기능 커밋이 한 문장씩 덧붙여 한 항목이 영역 문서 분량이 된다 —
    // 2026-11-03 분리 직후에도 주의사항 4(행 반복)가 11번 덧붙어 2,300자, 14(문항 가시성)가 4,100자였다.
    const root = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
    const section = root.split(/\n## 주의사항\n/)[1]?.split(/\n## /)[0] ?? '';
    const items = section.split(/\n(?=\d+\. \*\*)/).filter((s) => /^\d+\. \*\*/.test(s));
    expect(
      items.length,
      '주의사항 항목을 하나도 못 찾았다 — 제목·번호 모양이 바뀌었나',
    ).toBeGreaterThan(10);
    const over = items
      .map((s) => ({
        head: s.slice(0, s.indexOf('**', s.indexOf('**') + 2) + 2),
        size: [...s].length,
      }))
      .filter((it) => it.size > CAUTION_ITEM_LIMIT);
    expect(
      over,
      '상세를 그 코드 옆 영역 문서(src/**/AGENTS.md)로 옮기고 루트에는 규칙 한두 문장과 문서 위치만 둘 것',
    ).toEqual([]);
  });

  it.each(AREA_DOCS)(`%s 는 ${AREA_LIMIT.toLocaleString()}자를 넘지 않는다`, (rel) => {
    const size = charCount(rel);
    expect(
      size,
      `${rel} 이 ${size}자다. 절을 더 깊은 폴더의 AGENTS.md 로 내리거나, 정본이 따로 있는 문장을 줄일 것`,
    ).toBeLessThanOrEqual(AREA_LIMIT);
  });
});

describe('용어집은 뜻만 적는다', () => {
  const glossary = readFileSync(path.join(ROOT, 'CONTEXT.md'), 'utf8');

  it(`CONTEXT.md 는 ${GLOSSARY_LIMIT.toLocaleString()}자를 넘지 않는다`, () => {
    const size = [...glossary].length;
    expect(
      size,
      `CONTEXT.md 가 ${size}자다. 용어 정의에 섞인 구현 사실(파일·함수·배선)을 그 모듈의 문서 주석으로 옮길 것`,
    ).toBeLessThanOrEqual(GLOSSARY_LIMIT);
  });

  it('「구현 메모」를 적지 않는다', () => {
    // 용어집의 한 덩이는 한 줄짜리 문단이라 grep 한 번에 수천 자가 돌아오고, 같은 사실이 모듈 주석·영역 문서와
    // 세 곳에 적힌다(2026-11-12 따라 선택). 구현 사실의 정본은 코드 옆이다.
    const memos = glossary
      .split('\n')
      .map((line, i) => ({ line, no: i + 1 }))
      .filter(({ line }) => line.includes('**구현 메모**'))
      .map(({ line, no }) => `${no}: ${line.slice(0, 60)}`);
    expect(
      memos,
      'CONTEXT.md 에 「구현 메모」를 적었다. 용어집에는 뜻·경계·피할 말만 적는다 — 파일·함수·배선은 그 모듈의 문서 주석(「배선과 규칙」)에, 여러 모듈에 걸친 규칙은 영역 AGENTS.md 에 적을 것',
    ).toEqual([]);
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
    const listed = new Set(
      [...root.matchAll(/`((?:src\/[^`]+\/|supabase\/)AGENTS\.md)`/g)].map((m) => m[1]),
    );
    const missing = AREA_DOCS.filter((rel) => !listed.has(rel));
    expect(missing, '문서 지도 표에 없는 영역 문서 — 다른 도구는 이 표로 문서를 찾는다').toEqual(
      [],
    );
  });
});
