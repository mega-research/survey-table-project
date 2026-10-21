'use client';

import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';

import type { ImageSize } from './utils/image-enlarge';

/**
 * 「이미지 크게 보기」 창 — 원본 한 장을 화면에 맞춰 보이고(원본보다 키우지 않는다) 확대 모드에서 원본
 * 픽셀의 2배까지 키운다. 손가락 확대·두 번 탭·휠·끌기는 라이브러리 몫이다.
 *
 * 넘기기·쓸어내려 닫기는 없다 — 한 장만 보이고(다른 이미지로 넘어가 엉뚱한 행에 답하지 않게), 끌어
 * 옮기다 닫히지 않게 한다. 배경 클릭 닫기는 마우스 있는 기기만 — 터치 기기에서는 두 번 탭 확대가 바깥에
 * 닿아 창이 닫힌다.
 */

export interface ImageEnlargeViewerProps {
  src: string;
  alt: string;
  /** 원본 크기 — 확대 상한과 맞춤 보기 크기를 정한다 */
  natural: ImageSize;
  /** 머리 줄 첫 줄(표: 행 제목 · 열 제목). 없으면 글자 없이 닫기 버튼만 */
  title?: string | undefined;
  /** 머리 줄 둘째 줄(표 셀 캡션) */
  subtitle?: string | undefined;
  onClose: () => void;
}

/** 확대 상한 — 원본 픽셀의 2배. 그 이상은 픽셀이 뭉개질 뿐이다 */
const MAX_ZOOM_PIXEL_RATIO = 2;

function hasHover(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches;
}

export default function ImageEnlargeViewer({
  src,
  alt,
  natural,
  title,
  subtitle,
  onClose,
}: ImageEnlargeViewerProps) {
  return (
    <Lightbox
      open
      close={onClose}
      slides={[{ src, alt, width: natural.width, height: natural.height }]}
      plugins={[Zoom]}
      zoom={{ maxZoomPixelRatio: MAX_ZOOM_PIXEL_RATIO, scrollToZoom: true }}
      carousel={{ finite: true }}
      controller={{
        closeOnBackdropClick: hasHover(),
        closeOnPullDown: false,
        closeOnPullUp: false,
        disableSwipeNavigation: true,
      }}
      labels={{
        Lightbox: '이미지 크게 보기',
        Close: '닫기',
        'Zoom in': '확대',
        'Zoom out': '축소',
      }}
      render={{
        buttonPrev: () => null,
        buttonNext: () => null,
        controls: () =>
          title || subtitle ? (
            <div className="pointer-events-none absolute top-0 left-0 max-w-[calc(100%-9rem)] px-4 py-3 text-white">
              {title && <p className="truncate text-[15px] font-semibold">{title}</p>}
              {subtitle && <p className="truncate text-xs text-gray-300">{subtitle}</p>}
            </div>
          ) : null,
      }}
    />
  );
}
