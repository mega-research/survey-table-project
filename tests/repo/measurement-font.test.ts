import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TICK_FONT } from '@/features/operations/step-axis-tick';
import { TABLE_FONT } from '@/features/question-renderer/hooks/use-row-heights';

/**
 * pretext 측정 폰트 회귀 가드.
 *
 * pretext 의 canvas measureText 는 전달된 font 문자열로 글리프 폭을 잰다. 따라서 측정 폰트는
 * 실제 렌더 폰트(globals.css --font-sans 의 첫 패밀리)와 일치해야 계산이 어긋나지 않는다.
 * 과거 'Pretendard' 를 썼으나 앱에 로드되지 않아 브라우저 폴백으로 측정되어 2줄 감지
 * 임계값이 뒤집히는 버그가 있었다 (review 2026-06-09 M45).
 *
 * 그 가드는 use-line-count-detection 의 TITLE_FONT 를 겨누고 있었는데, 그 훅이 호출자 없는
 * 죽은 코드로 삭제되면서(51cc52a5) 테스트 파일도 함께 사라졌다. 훅은 죽었지만 **불변식은
 * 살아 있다** — 아래 두 상수가 같은 방식으로 측정한다. 이 파일이 그 자리를 대신한다.
 *
 * 새 측정 지점을 추가하면 여기 등재할 것. 등재를 빠뜨리면 아무도 막지 않는다.
 */
const MEASUREMENT_FONTS: ReadonlyArray<{ name: string; value: string; where: string }> = [
  {
    name: 'TABLE_FONT',
    value: TABLE_FONT,
    where: 'features/question-renderer/hooks/use-row-heights.ts — 표 행 높이 사전 계산',
  },
  {
    name: 'TICK_FONT',
    value: TICK_FONT,
    where: 'features/operations/step-axis-tick.tsx — 차트 X축 tick 말줄임 판정',
  },
];

// globals.css 의 --font-sans 첫 패밀리를 source of truth 로 추출
const globalsCss = readFileSync(path.resolve(__dirname, '../../src/app/globals.css'), 'utf8');
const fontSansMatch = globalsCss.match(/--font-sans:\s*([^;]+);/);
const firstFamilyRaw = fontSansMatch?.[1]?.split(',')[0]?.trim() ?? '';
/** 따옴표 제거한 패밀리명 */
const firstFamily = firstFamilyRaw.replace(/^["']|["']$/g, '');

describe('pretext 측정 폰트', () => {
  it('globals.css 에서 --font-sans 첫 패밀리를 읽을 수 있다', () => {
    expect(firstFamily.length).toBeGreaterThan(0);
  });

  it.each(MEASUREMENT_FONTS)(
    '$name 은 globals.css --font-sans 첫 패밀리를 쓴다 ($where)',
    ({ value }) => {
      expect(value).toContain(firstFamily);
    },
  );

  it.each(MEASUREMENT_FONTS)('$name 은 앱에 로드되지 않는 Pretendard 를 쓰지 않는다', ({ value }) => {
    expect(value.toLowerCase()).not.toContain('pretendard');
  });

  it.each(MEASUREMENT_FONTS)('$name 은 CSS font shorthand 형식이다', ({ value }) => {
    // canvas font 는 [weight] <size>px <family> 형태여야 파싱된다. weight 는 선택.
    expect(value).toMatch(/^(\d+\s+)?\d+px\s+.+/);
  });
});
