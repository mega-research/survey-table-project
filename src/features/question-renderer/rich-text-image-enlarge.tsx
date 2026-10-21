'use client';

import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useState,
} from 'react';

import { ImageEnlargeOverlay } from './enlargeable-image';
import { type ImageSize, canEnlargeImage } from './utils/image-enlarge';

/**
 * 본문(안내문 · 설명) 이미지의 「이미지 크게 보기」(CONTEXT.md). 본문은 HTML 을 그대로 넣어 그리므로
 * 이미지마다 부품을 끼울 수 없다 — 본문 상자 한 곳에서 이미지를 재고, 누르기·키 입력을 받는다.
 *
 * 줄어 보이는 이미지에만 버튼 역할(`role`·`tabindex`·이름)과 표식 `data-enlargeable` 을 붙인다. 링크
 * 안의 이미지는 링크가 먼저라 건너뛴다. 머리 줄은 글자 없이 닫기 버튼만이다.
 *
 * 이미지를 감싸는 요소를 끼우지 않는다 — 에디터가 이미지 크기를 % 로 적어 감싸는 상자가 생기면 크기가
 * 바뀐다. 그래서 확대 배지 없이 마우스 기기의 확대 커서·어두워짐(`RICH_TEXT_ENLARGE_CLASS`)만 보인다.
 */

const ENLARGE_MARK = 'data-enlargeable';

/** 본문 상자에 더하는 표시 — 크게 볼 수 있는 이미지에 확대 커서, 마우스를 올리면 살짝 어둡게 */
export const RICH_TEXT_ENLARGE_CLASS =
  '[&_img[data-enlargeable]]:cursor-zoom-in [@media(hover:hover)]:[&_img[data-enlargeable]:hover]:brightness-90';

interface OpenImage {
  src: string;
  alt: string;
  natural: ImageSize;
}

function markImage(img: HTMLImageElement): void {
  const enlargeable =
    img.closest('a') === null &&
    canEnlargeImage({
      natural: { width: img.naturalWidth, height: img.naturalHeight },
      rendered: { width: img.clientWidth, height: img.clientHeight },
      fit: 'contain',
    });
  if (enlargeable) {
    img.setAttribute(ENLARGE_MARK, '');
    img.setAttribute('role', 'button');
    img.setAttribute('tabindex', '0');
    img.setAttribute('aria-label', `${img.alt.trim() || '이미지'} 크게 보기`);
  } else {
    for (const name of [ENLARGE_MARK, 'role', 'tabindex', 'aria-label']) img.removeAttribute(name);
  }
}

/**
 * `ref` 는 본문 상자(dangerouslySetInnerHTML 을 단 요소)다. 부르는 쪽이 만들어 넘긴다 — 훅이 ref 를
 * 돌려주면 돌려받은 값 전체가 렌더 중 ref 접근으로 읽힌다(react-hooks/refs).
 */
export function useRichTextImageEnlarge<T extends HTMLElement>(
  ref: RefObject<T | null>,
  html: string,
): {
  enlargeProps: {
    onClick: (event: MouseEvent<T>) => void;
    onKeyDown: (event: KeyboardEvent<T>) => void;
  };
  overlay: ReactNode;
} {
  const [opened, setOpened] = useState<OpenImage | null>(null);

  // 본문이 바뀌면 이미지를 다시 찾는다. 로드가 끝나야 원본 크기를 알고, 상자 폭이 바뀌면 다시 잰다
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const images = Array.from(container.querySelectorAll('img'));
    const measure = (img: HTMLImageElement) => {
      if (img.complete && img.naturalWidth > 0) markImage(img);
    };
    const onLoad = (event: Event) => markImage(event.currentTarget as HTMLImageElement);
    for (const img of images) {
      measure(img);
      img.addEventListener('load', onLoad);
    }
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => images.forEach(measure));
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      for (const img of images) img.removeEventListener('load', onLoad);
    };
  }, [ref, html]);

  const enlargeTarget = (target: EventTarget): HTMLImageElement | null =>
    target instanceof HTMLImageElement && target.hasAttribute(ENLARGE_MARK) ? target : null;

  const open = (img: HTMLImageElement) =>
    setOpened({
      src: img.currentSrc || img.src,
      alt: img.alt,
      natural: { width: img.naturalWidth, height: img.naturalHeight },
    });

  return {
    enlargeProps: {
      onClick: (event) => {
        const img = enlargeTarget(event.target);
        if (img) open(img);
      },
      onKeyDown: (event) => {
        const img = enlargeTarget(event.target);
        if (!img || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        open(img);
      },
    },
    overlay: opened ? <ImageEnlargeOverlay {...opened} onClose={() => setOpened(null)} /> : null,
  };
}
