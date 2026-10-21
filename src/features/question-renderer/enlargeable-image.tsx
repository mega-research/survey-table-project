'use client';

import {
  type CSSProperties,
  type KeyboardEvent,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Maximize2, ZoomIn } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { ImageEnlargeViewerProps } from './image-enlarge-viewer';
import { type ImageFit, type ImageSize, canEnlargeImage } from './utils/image-enlarge';

// 응답자 경로 번들에서 라이트박스를 떼어 낸다 — 누를 때 처음 불러온다
const ImageEnlargeViewer = lazy(() => import('./image-enlarge-viewer'));

export interface EnlargeableImageProps {
  src: string;
  alt: string;
  /** false 면 크게 보기 없이 평범한 이미지로 그린다(빌더 편집 화면의 표 등). 기본 true */
  enabled?: boolean | undefined;
  /** 이미지를 상자에 맞추는 방식 — 그려진 크기와 원본을 비교하는 기준 */
  fit: ImageFit;
  /**
   * 여는 방식 — 이미지 누르기(기본) / 이미지 위 돋보기 버튼만. 이미지 누르기에 이미 뜻이 있는 자리
   * (순위형 보기: 누르면 순위가 매겨진다)는 돋보기 버튼으로 비켜 간다.
   */
  trigger?: 'image' | 'button' | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** 이미지와 배지를 감싸는 상자 — 기본은 이미지 크기에 맞춘다 */
  wrapperClassName?: string | undefined;
  /** 크게 보기 머리 줄 */
  title?: string | undefined;
  subtitle?: string | undefined;
  onError?: (() => void) | undefined;
}

/** 로드 전 — 원본 크기를 아직 모른다 */
const UNKNOWN_SIZE: ImageSize = { width: 0, height: 0 };

/**
 * 「이미지 크게 보기」(CONTEXT.md)를 붙인 이미지 — 원본 전체가 화면에 다 보이지 않으면(줄었거나 잘림)
 * 눌러서 크게 본다. 다 보이면 평범한 이미지와 같다(배지·포커스·커서 없음).
 *
 * 크게 볼 수 있다는 표시는 마우스 유무로 가른다(화면 폭이 아니다 — 넓은 태블릿도 마우스가 없다):
 * 마우스 있는 기기는 올렸을 때만 배지·어두운 막·확대 커서, 터치 기기는 배지가 늘 보인다.
 */
export function EnlargeableImage({
  src,
  alt,
  enabled = true,
  fit,
  trigger = 'image',
  className,
  style,
  wrapperClassName,
  title,
  subtitle,
  onError,
}: EnlargeableImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<ImageSize>(UNKNOWN_SIZE);
  const [enlargeable, setEnlargeable] = useState(false);
  const [open, setOpen] = useState(false);
  const canOpen = enabled && enlargeable;
  const opensFromImage = canOpen && trigger === 'image';
  // 버튼 이름이 대체 텍스트를 덮으므로 원래 설명을 앞에 남긴다
  const triggerLabel = `${alt.trim() || '이미지'} 크게 보기`;

  const measure = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const size = { width: img.naturalWidth, height: img.naturalHeight };
    setNatural(size);
    setEnlargeable(
      canEnlargeImage({
        natural: size,
        rendered: { width: img.clientWidth, height: img.clientHeight },
        fit,
      }),
    );
  }, [fit]);

  // 같은 이미지라도 창 폭이 바뀌면 줄었다 다 보였다 한다 — 그려진 크기가 바뀔 때마다 다시 잰다
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    // 서버에서 그린 이미지는 하이드레이션 전에 이미 로드돼 onLoad 를 놓칠 수 있다
    if (img.complete && img.naturalWidth > 0) measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (img.complete && img.naturalWidth > 0) measure();
    });
    observer.observe(img);
    return () => observer.disconnect();
  }, [measure]);

  const handleError = () => {
    setEnlargeable(false);
    onError?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLImageElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setOpen(true);
  };

  return (
    <div className={cn('group/enlarge relative w-fit max-w-full', wrapperClassName)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- R2 사용자 업로드 이미지(크기 미상), next/image 최적화 비용 회피 */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={cn(className, opensFromImage && 'cursor-zoom-in')}
        style={style}
        onLoad={measure}
        onError={handleError}
        {...(opensFromImage
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-label': triggerLabel,
              onClick: () => setOpen(true),
              onKeyDown: handleKeyDown,
            }
          : {})}
      />
      {canOpen && trigger === 'button' && (
        <button
          type="button"
          aria-label={triggerLabel}
          // 바깥 보기 버튼(순위 지정)으로 번지지 않게 — 키보드로 눌러도 버튼은 click 으로 온다
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
          className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full bg-black/65 text-white transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/enlarge:opacity-100"
        >
          <ZoomIn className="size-3.5" />
        </button>
      )}
      {opensFromImage && (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] transition-colors [@media(hover:hover)]:group-hover/enlarge:bg-black/20"
          />
          <span
            aria-hidden
            data-enlarge-badge
            className="pointer-events-none absolute right-1.5 bottom-1.5 flex size-7 items-center justify-center rounded-full bg-black/65 text-white transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/enlarge:opacity-100 [@media(hover:hover)]:group-hover/enlarge:opacity-100"
          >
            <Maximize2 className="size-3.5" />
          </span>
        </>
      )}
      {open && (
        <ImageEnlargeOverlay
          src={src}
          alt={alt}
          natural={natural}
          title={title}
          subtitle={subtitle}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * 크게 보기 창을 띄우는 자리 — 표 이미지 셀과 본문 이미지가 같이 쓴다. 창은 누를 때 처음 불러온다.
 *
 * 창은 포털이지만 React 이벤트는 이 자리로 거슬러 오른다 — 창 안의 누르기·키 입력이 바깥 보기 버튼·
 * 셀로 번지지 않게 여기서 끊는다.
 */
export function ImageEnlargeOverlay(props: ImageEnlargeViewerProps) {
  return (
    <span
      className="contents"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Suspense fallback={null}>
        <ImageEnlargeViewer {...props} />
      </Suspense>
    </span>
  );
}
