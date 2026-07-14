import type { CSSProperties } from 'react';

import type { OptionsAlign } from '@/types/survey';

/**
 * 옵션 리스트의 레이아웃 (`Question.optionsColumns`) 을 className + inline style 로 변환.
 * - undefined / 1: 세로 1열 (기본)
 * - 0: 가로 한 줄 (flex-wrap)
 * - N ≥ 2: N열 그리드 — 모바일(< sm=640px)에서는 자동 1열로 fallback
 *
 * align (`Question.optionsAlign`) 은 옵션 그룹의 블록 정렬 — 내부는 항상 좌측(체크박스 세로선 유지).
 * - 가로: justify-* 로 행 전체 이동
 * - 세로: w-fit + margin 으로 그룹째 이동
 * - 우측 정렬은 컨테이너 우측 모서리(표 등)와 딱 붙지 않게 pr-5 인셋 포함
 * - N열 그리드: 컬럼이 폭을 채우는 구조라 무시
 *
 * N열 그리드는 globals.css 의 `.options-grid` + CSS 변수로 반응형 처리.
 */
export function getOptionsLayout(
  columns: number | undefined,
  align?: OptionsAlign,
): {
  className: string;
  style?: CSSProperties;
} {
  if (columns === 0) {
    const justify = align === 'center' ? ' justify-center' : align === 'right' ? ' justify-end pr-5' : '';
    return { className: `flex flex-wrap gap-x-4 gap-y-2${justify}` };
  }
  if (!columns || columns === 1) {
    const shift = align === 'center' ? ' w-fit mx-auto' : align === 'right' ? ' w-fit ml-auto pr-5' : '';
    return { className: `flex flex-col gap-2${shift}` };
  }
  // N열 그리드 — sm 이상에서만 N열, 모바일은 1열. align 은 무시.
  return {
    className: 'options-grid',
    style: {
      ['--options-grid-cols' as string]: `repeat(${columns}, minmax(0, 1fr))`,
    } as CSSProperties,
  };
}
