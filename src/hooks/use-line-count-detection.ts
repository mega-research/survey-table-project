'use client';

import { useMemo } from 'react';

import { prepare, layout } from '@chenglou/pretext';

// 모바일 title 폰트: text-xl = 20px, leading-relaxed = 1.625
// pretext canvas 엔진은 실제 로드된 폰트명과 일치해야 정확 (globals.css --font-sans = "Wanted Sans Variable").
// 'Pretendard'는 미로드 폰트라 브라우저 폴백 대체 → 줄 수 측정이 어긋남.
export const TITLE_FONT = '600 20px "Wanted Sans Variable"';
const TITLE_LINE_HEIGHT = 20 * 1.625; // 32.5px

// 모바일 카드 콘텐츠 영역 폭 추정
// max-w-4xl(896px) - px-6(48px) - Card padding(48px) - 번호뱃지(0, hidden on mobile) ≈ 800px
// 모바일에서는 화면폭 - px-6(48px) - Card padding(48px) ≈ 화면폭 - 96px
// 375px 기준: 약 279px (min-w-0 flex-1이므로 실제 사용 가능 폭)
const MOBILE_CONTENT_WIDTH = 280;

/**
 * pretext 기반 텍스트 줄 수 사전 감지
 *
 * DOM 접근 없이 순수 산술로 2줄 이상 여부를 계산.
 * useMemo로 동기 계산 → useState/useEffect 불필요 → 리렌더 0회.
 */
export function useMultiLineDetection(
  isMobile: boolean,
  content?: string,
): boolean {
  return useMemo(() => {
    if (!isMobile || !content) return false;

    const prepared = prepare(content, TITLE_FONT);
    const { height } = layout(prepared, MOBILE_CONTENT_WIDTH, TITLE_LINE_HEIGHT);

    // 1줄 높이(= TITLE_LINE_HEIGHT)보다 크면 2줄 이상
    return height > TITLE_LINE_HEIGHT * 1.1; // 10% 여유
  }, [isMobile, content]);
}
