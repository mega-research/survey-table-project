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

import { Maximize2 } from 'lucide-react';

import { cn } from '@/lib/utils';

import { type ImageFit, type ImageSize, canEnlargeImage } from './utils/image-enlarge';

// 응답자 경로 번들에서 라이트박스를 떼어 낸다 — 누를 때 처음 불러온다
const ImageEnlargeViewer = lazy(() => import('./image-enlarge-viewer'));

/**
 * 「이미지 크게 보기」(CONTEXT.md)를 붙인 이미지 — 원본 전체가 화면에 다 보이지 않으면(줄었거나 잘림)
 * 눌러서 크게 본다. 다 보이면 평범한 이미지와 같다(배지·포커스·커서 없음).
 *
 * 크게 볼 수 있다는 표시는 마우스 유무로 가른다(화면 폭이 아니다 — 넓은 태블릿도 마우스가 없다):
 * 마우스 있는 기기는 올렸을 때만 배지·어두운 막·확대 커서, 터치 기기는 배지가 늘 보인다.
 */
export interface EnlargeableImageProps {
  src: string;
  alt: string;
  /** 이미지를 상자에 맞추는 방식 — 그려진 크기와 원본을 비교하는 기준 */
  fit: ImageFit;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** 이미지와 배지를 감싸는 상자 — 기본은 이미지 크기에 맞춘다 */
  wrapperClassName?: string | undefined;
  /** 크게 보기 머리 줄 */
  title?: string | undefined;
  subtitle?: string | undefined;
  onError?: (() => void) | undefined;
}

const ZERO: ImageSize = { width: 0, height: 0 };

export function EnlargeableImage({
  src,
  alt,
  fit,
  className,
  style,
  wrapperClassName,
  title,
  subtitle,
  onError,
}: EnlargeableImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<ImageSize>(ZERO);
  const [enlargeable, setEnlargeable] = useState(false);
  const [open, setOpen] = useState(false);

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
        className={cn(className, enlargeable && 'cursor-zoom-in')}
        style={style}
        onLoad={measure}
        onError={handleError}
        {...(enlargeable
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-label': '이미지 크게 보기',
              onClick: () => setOpen(true),
              onKeyDown: handleKeyDown,
            }
          : {})}
      />
      {enlargeable && (
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
        <Suspense fallback={null}>
          <ImageEnlargeViewer
            src={src}
            alt={alt}
            natural={natural}
            title={title}
            subtitle={subtitle}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
