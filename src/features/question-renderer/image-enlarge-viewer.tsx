'use client';

import { useEffect, useEffectEvent, useRef } from 'react';

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

/** 크게 보기가 방문 기록에 쌓는 칸의 표식 */
const HISTORY_MARK = 'imageEnlarge';

function isEnlargeEntry(state: unknown): boolean {
  return typeof state === 'object' && state !== null && HISTORY_MARK in state;
}

/**
 * 휴대폰·브라우저 뒤로 가기로 닫는다 — 열 때 방문 기록에 칸을 하나 쌓고 그 칸이 걷히면(popstate) 닫는다.
 * 지금 칸을 그대로 이어 쌓으므로(응답 흐름의 `stepIndex` 포함) 걷혀도 같은 페이지 칸으로 돌아온다 —
 * 응답 흐름은 그 뒤로 가기에서 페이지를 넘기지 않는다. X·Esc·배경 클릭으로 닫을 때는 쌓은 칸을 스스로
 * 걷어(`history.back`) 같은 길로 닫는다. 그래야 닫은 뒤의 뒤로 가기가 헛돌지 않는다.
 *
 * 이미 표식 칸 위면 다시 쌓지 않는다 — StrictMode 이중 실행이 칸 두 개를 쌓지 않게.
 *
 * 닫히지 않은 채 화면에서 빠지면(화면 회전으로 모바일 카드가 데스크톱 표로 바뀌는 등) 쌓은 칸을
 * 걷는다 — 남으면 그 아래 페이지 칸과 스텝이 같아 나중의 뒤로 가기 한 번이 헛돈다. 걷기는 한 박자
 * 미룬다: StrictMode 는 정리 직후 다시 마운트하므로 그때는 걷지 않는다.
 */
function useHistoryBackedClose(onClose: () => void): () => void {
  const handlePopState = useEffectEvent(() => onClose());
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const state: unknown = window.history.state;
    if (!isEnlargeEntry(state)) {
      window.history.pushState({ ...(state as object | null), [HISTORY_MARK]: true }, '');
    }
    const listener = () => handlePopState();
    window.addEventListener('popstate', listener);
    return () => {
      mounted.current = false;
      window.removeEventListener('popstate', listener);
      setTimeout(() => {
        if (!mounted.current && isEnlargeEntry(window.history.state)) window.history.back();
      }, 0);
    };
  }, []);
  return () => {
    if (isEnlargeEntry(window.history.state)) window.history.back();
    else onClose();
  };
}

export default function ImageEnlargeViewer({
  src,
  alt,
  natural,
  title,
  subtitle,
  onClose,
}: ImageEnlargeViewerProps) {
  const requestClose = useHistoryBackedClose(onClose);
  return (
    <Lightbox
      open
      close={requestClose}
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
