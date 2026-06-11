import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 회귀 테스트(M44): use-row-heights 의 pretext 측정 폰트 ↔ 실제 로드 폰트 동기화 보장
 *
 * pretext는 browser canvas 폰트 엔진을 ground truth로 사용하므로
 * prepare(text, font)의 font 문자열이 실제 로드된 폰트명과 정확히 일치해야
 * layout() 결과(행 높이)가 렌더 결과와 어긋나지 않는다.
 *
 * globals.css --font-sans = "Wanted Sans Variable" (layout.tsx에서 웹폰트 로드).
 * 과거 코드는 미로드 폰트 'Pretendard'를 넘겨 브라우저 폴백으로 대체되어
 * 측정 행 높이가 렌더 높이와 어긋났다(LazyMount placeholder 불일치 → 스크롤 밀림).
 *
 * canvas/jsdom으로는 실제 글리프 폭을 잴 수 없으므로 폰트 문자열 동기화를
 * 소스 수준에서 보증한다.
 * (use-line-count-detection 의 TITLE_FONT 는 M45 별도 테스트가 담당)
 */

const ROOT = resolve(__dirname, '..', '..');

function readSource(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

describe('pretext 폰트 문자열 동기화', () => {
  it('globals.css --font-sans는 "Wanted Sans Variable"을 우선 패밀리로 둔다', () => {
    const css = readSource('src/app/globals.css');
    const match = css.match(/--font-sans:\s*([^;]+);/);
    expect(match, '--font-sans 선언을 찾지 못함').not.toBeNull();
    const fontSans = match![1];
    expect(fontSans).toContain('"Wanted Sans Variable"');
    // 미로드 폰트가 SoT에 끼어들지 않았는지 확인
    expect(fontSans).not.toContain('Pretendard');
  });

  it('use-row-heights.ts TABLE_FONT은 로드된 폰트를 참조한다 (Pretendard 금지)', () => {
    const src = readSource('src/hooks/use-row-heights.ts');
    // 외곽 따옴표는 작은따옴표/백틱, 내부에 큰따옴표 패밀리명 허용
    const match = src.match(/TABLE_FONT\s*=\s*(['`])(.+?)\1/);
    expect(match, 'TABLE_FONT 선언을 찾지 못함').not.toBeNull();
    const fontValue = match![2];
    expect(fontValue).toContain('Wanted Sans Variable');
    expect(fontValue).not.toContain('Pretendard');
  });
});
