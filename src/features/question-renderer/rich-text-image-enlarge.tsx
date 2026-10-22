'use client';

import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useState,
} from 'react';

import { Maximize2 } from 'lucide-react';

import { ImageEnlargeOverlay } from './enlargeable-image';
import {
  type ImageBox,
  type ImageSize,
  canEnlargeImage,
  enlargeTriggerLabel,
  placeEnlargeBadge,
} from './utils/image-enlarge';

/**
 * 본문(안내문 · 설명) 이미지의 「이미지 크게 보기」(CONTEXT.md). 본문은 HTML 을 그대로 넣어 그리므로
 * 이미지마다 부품을 끼울 수 없다 — 본문 상자 한 곳에서 이미지를 재고, 누르기·키 입력을 받는다.
 *
 * 줄어 보이는 이미지에만 버튼 역할(`role`·`tabindex`·이름)과 표식 `data-enlargeable` 을 붙인다. 링크
 * 안의 이미지는 링크가 먼저라 건너뛴다. 머리 줄은 글자 없이 닫기 버튼만이다.
 *
 * 이미지를 감싸는 요소를 끼우지 않는다 — 에디터가 이미지 크기를 % 로 적어 감싸는 상자가 생기면 크기가
 * 바뀐다. 마우스 기기는 확대 커서·어두워짐(`RICH_TEXT_ENLARGE_CLASS`)으로 알리고, 터치 기기는 hover 가
 * 없어 돋보기(`badges`)를 본문 상자 위에 따로 띄운다 — 자리는 `placeEnlargeBadge`(늘 사진의 오른쪽 위 — 오른쪽에
 * 자리가 있으면 바깥, 없으면 안). 돋보기는 본문 상자의 형제라 부르는 쪽이 둘을 `relative` 상자로 감싼다.
 */

const ENLARGE_MARK = 'data-enlargeable';

/** 본문 상자에 더하는 표시 — 크게 볼 수 있는 이미지에 확대 커서, 마우스를 올리면 살짝 어둡게 */
export const RICH_TEXT_ENLARGE_CLASS =
  '[&_img[data-enlargeable]]:cursor-zoom-in [@media(hover:hover)]:[&_img[data-enlargeable]:hover]:brightness-90';

/** 띄운 돋보기 하나 — 좌표는 돋보기를 띄우는 상자(본문 상자의 offsetParent) 기준 */
interface EnlargeBadge {
  img: HTMLImageElement;
  left: number;
  top: number;
}

const toBox = (rect: DOMRect): ImageBox => ({
  left: rect.left,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
});

function measureBadges(container: HTMLElement): EnlargeBadge[] {
  const containerRect = container.getBoundingClientRect();
  // 돋보기를 띄우는 상자의 원점 — 본문 상자가 그 안에서 offsetLeft·offsetTop 만큼 떨어져 있다
  const originLeft = containerRect.left - container.offsetLeft;
  const originTop = containerRect.top - container.offsetTop;
  return Array.from(container.querySelectorAll<HTMLImageElement>(`img[${ENLARGE_MARK}]`)).map(
    (img) => {
      const place = placeEnlargeBadge(toBox(img.getBoundingClientRect()), toBox(containerRect));
      return { img, left: place.left - originLeft, top: place.top - originTop };
    },
  );
}

const sameBadges = (a: EnlargeBadge[], b: EnlargeBadge[]) =>
  a.length === b.length &&
  a.every((x, i) => x.img === b[i]!.img && x.left === b[i]!.left && x.top === b[i]!.top);

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
    img.setAttribute('aria-label', enlargeTriggerLabel(img.alt));
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
  /** 터치 기기용 돋보기 — 본문 상자와 함께 `relative` 상자 안에 둔다 */
  badges: ReactNode;
  overlay: ReactNode;
} {
  const [opened, setOpened] = useState<OpenImage | null>(null);
  const [badgeList, setBadgeList] = useState<EnlargeBadge[]>([]);

  // 본문이 바뀌면 이미지를 다시 찾는다. 로드가 끝나야 원본 크기를 알고, 상자 폭이 바뀌면 다시 잰다.
  // 다른 이미지의 로드·글 줄바꿈으로 사진 자리가 바뀌므로 돋보기 자리는 매번 전부 다시 잰다
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const images = Array.from(container.querySelectorAll('img'));
    const refresh = (loaded?: HTMLImageElement) => {
      for (const img of images) {
        if (img === loaded || (img.complete && img.naturalWidth > 0)) markImage(img);
      }
      const next = measureBadges(container);
      setBadgeList((prev) => (sameBadges(prev, next) ? prev : next));
    };
    const onLoad = (event: Event) => refresh(event.currentTarget as HTMLImageElement);
    const onScroll = () => refresh();
    const frame = requestAnimationFrame(() => refresh());
    for (const img of images) img.addEventListener('load', onLoad);
    container.addEventListener('scroll', onScroll, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => refresh());
    observer?.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      container.removeEventListener('scroll', onScroll);
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
    badges: badgeList.map((badge, index) => (
      <button
        key={index}
        type="button"
        // 이미지가 이미 이름 있는 버튼이라 돋보기는 보조 기술·탭 순서에 한 번 더 나오지 않는다
        aria-hidden
        tabIndex={-1}
        data-enlarge-badge
        onClick={() => open(badge.img)}
        style={{ left: badge.left, top: badge.top }}
        className="absolute flex size-7 items-center justify-center rounded-full bg-black/65 text-white [@media(hover:hover)]:hidden"
      >
        <Maximize2 className="size-3.5" />
      </button>
    )),
    overlay: opened ? <ImageEnlargeOverlay {...opened} onClose={() => setOpened(null)} /> : null,
  };
}
