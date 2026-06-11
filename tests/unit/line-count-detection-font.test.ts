import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TITLE_FONT } from '@/hooks/use-line-count-detection';

/**
 * use-line-count-detection 의 pretext 측정 폰트 회귀 테스트.
 *
 * pretext canvas measureText 는 전달된 font 문자열로 글리프 폭을 잰다.
 * 따라서 측정 폰트는 실제 렌더 폰트(globals.css --font-sans 의 첫 패밀리)와
 * 일치해야 줄 수 판정이 어긋나지 않는다.
 * 과거 'Pretendard' 를 썼으나 앱에 로드되지 않아 브라우저 폴백으로 측정되어
 * 2줄 감지 임계값이 뒤집히는 버그가 있었다 (review 2026-06-09 M45).
 */
describe('useMultiLineDetection 측정 폰트', () => {
  // globals.css 의 --font-sans 첫 패밀리를 source of truth 로 추출
  const globalsCss = readFileSync(
    path.resolve(__dirname, '../../src/app/globals.css'),
    'utf8',
  );
  const fontSansMatch = globalsCss.match(/--font-sans:\s*([^;]+);/);
  const firstFamilyRaw = fontSansMatch?.[1]?.split(',')[0]?.trim() ?? '';
  // 따옴표 제거한 패밀리명
  const firstFamily = firstFamilyRaw.replace(/^["']|["']$/g, '');

  it('globals.css --font-sans 첫 패밀리를 측정 폰트로 사용한다', () => {
    expect(firstFamily.length).toBeGreaterThan(0);
    expect(TITLE_FONT).toContain(firstFamily);
  });

  it('앱에 로드되지 않는 Pretendard 폰트를 사용하지 않는다', () => {
    expect(TITLE_FONT.toLowerCase()).not.toContain('pretendard');
  });

  it('CSS font shorthand 형식(weight size family)을 유지한다', () => {
    expect(TITLE_FONT).toMatch(/^\d+\s+\d+px\s+.+/);
  });
});
