'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { scrollTarget, type ScrollBand } from '@/lib/survey-document/anchor-geometry';
import { cn } from '@/lib/utils';

/**
 * 조사표 PDF 뷰어 — **한 번에 한 페이지**만 그린다.
 *
 * 연속 스크롤을 쓰지 않는 것은 데모가 실물로 뒤집은 결정이다. 20쪽을 한 줄로
 * 이어 스크롤하면 "지금 몇 쪽인가"를 잃는다.
 *
 * pdf.js 워커는 번들러에 맡기지 않고 `public/pdf.worker.min.mjs` 정적 자산으로
 * 고정한다 — 번들러가 워커를 옮길 때마다 경로가 깨졌던 것이 데모의 실측이다.
 * 워커 파일은 `pnpm pdfjs:worker` 로 pdfjs-dist 버전과 맞춰 다시 복사한다.
 *
 * 좌표·영역은 이 컴포넌트가 모른다 — 렌더된 페이지의 실측 크기를
 * `onPageBox` 로 올려보내고, 그 위에 무엇을 그릴지는 호출자가 정한다.
 */

/** 렌더된 페이지의 실측 배치. 화면 좌표는 계산하지 않고 잰다. */
export interface RenderedPageBox {
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Props {
  url: string;
  /** 총 쪽 수 — DB 에 저장된 값. 문서를 열면 실제 값으로 정정된다. */
  pageCount: number;
  page: number;
  onPageChange: (page: number) => void;
  /** 렌더가 끝날 때마다 실측 배치를 올려보낸다. */
  onPageBox?: (box: RenderedPageBox | null) => void;
  /** 페이지 위에 겹쳐 그릴 것 (영역 사각형 등). */
  overlay?: React.ReactNode;
  /**
   * 쪽 안에서 보여줄 구간. `nonce` 가 바뀔 때만 스크롤을 맞춘다 — 상태를 감시하면
   * 응답자가 직접 스크롤한 위치를 곧바로 되돌린다. 좌표는 이 컴포넌트가 올려보낸
   * 실측 배치(onPageBox)와 같은 원점이다.
   */
  scrollBand?: (ScrollBand & { nonce: number }) | null;
  /**
   * 쪽을 감싼 상자에 붙일 마우스 핸들러 — 영역 드래그용.
   * overlay 와 **같은 좌표 원점**을 갖는 요소에 붙는다(그래서 캔버스가 아니라 감싼 상자다) —
   * 드래그로 만든 사각형과 그려진 사각형이 어긋나지 않는 것이 여기에 걸려 있다.
   */
  surfaceProps?: React.HTMLAttributes<HTMLDivElement>;
  className?: string;
}

const PAD = 16;

export function PdfPageView({
  url,
  pageCount,
  page,
  onPageChange,
  onPageBox,
  overlay,
  scrollBand = null,
  surfaceProps,
  className,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const renderToken = useRef(0);

  // 문서는 ref 가 아니라 상태로 든다 — 렌더 콜백이 "문서가 열렸다"를
  // 의존성으로 알아야 하는데, ref 로 두면 그 신호를 가짜 의존성으로 흉내내게 된다.
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [openedUrl, setOpenedUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ url: string; message: string } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [zoom, setZoom] = useState(1);

  const settled = openedUrl === url || failure?.url === url;
  const loading = !settled || rendering;
  const error = failure?.url === url ? failure.message : null;
  const total = openedUrl === url && doc ? doc.numPages : pageCount;

  useEffect(() => {
    let alive = true;
    let opening: PdfDocument | null = null;
    void openDoc(url)
      .then((opened) => {
        opening = opened;
        if (!alive) return;
        setDoc(opened);
        setOpenedUrl(url);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setFailure({
          url,
          message: e instanceof Error ? e.message : '조사표를 불러오지 못했습니다.',
        });
      });
    return () => {
      alive = false;
      void opening?.cleanup();
    };
  }, [url]);

  const renderPage = useCallback(async () => {
    const holder = holderRef.current;
    const scroller = scrollRef.current;
    if (!doc || !holder || !scroller) return;

    const target = Math.min(Math.max(1, page), doc.numPages);
    const token = ++renderToken.current;
    setRendering(true);
    try {
      const pdfPage = await doc.getPage(target);
      if (token !== renderToken.current) return;

      const base = pdfPage.getViewport({ scale: 1 });
      const avail = Math.max(280, scroller.clientWidth - PAD * 2) * zoom;
      const viewport = pdfPage.getViewport({ scale: avail / base.width });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.style.display = 'block';

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise;
      }
      if (token !== renderToken.current) return;

      holder.replaceChildren(canvas);
      holder.style.width = `${viewport.width}px`;
      holder.style.height = `${viewport.height}px`;
      // 화면 좌표는 계산하지 않고 잰다 — 계산이 데모에서 버그의 원천이었다
      onPageBox?.({
        page: target,
        left: holder.offsetLeft,
        top: holder.offsetTop,
        width: viewport.width,
        height: viewport.height,
      });
    } catch (e) {
      if (token === renderToken.current) {
        setFailure({
          url,
          message: e instanceof Error ? e.message : '페이지를 그리지 못했습니다.',
        });
      }
    } finally {
      if (token === renderToken.current) setRendering(false);
    }
  }, [doc, page, zoom, url, onPageBox]);

  useEffect(() => {
    void renderPage();
  }, [renderPage]);

  // 쪽만 넘기고 끝내면 확대했거나 긴 쪽에서 영역이 화면 밖에 남는다.
  // 이미 보이는 동안은 움직이지 않는 판정은 anchor-geometry 소관이다.
  const [scrolledNonce, setScrolledNonce] = useState<number | null>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !scrollBand || scrollBand.nonce === scrolledNonce || rendering) return;
    setScrolledNonce(scrollBand.nonce);
    const want = scrollTarget({
      contextTop: scrollBand.contextTop,
      contextBottom: scrollBand.contextBottom,
      focusTop: scrollBand.focusTop,
      focusBottom: scrollBand.focusBottom,
      viewTop: scroller.scrollTop,
      viewHeight: scroller.clientHeight,
      pad: PAD,
    });
    if (want !== null) scroller.scrollTo({ top: want, behavior: 'smooth' });
  }, [scrollBand, scrolledNonce, rendering]);

  const go = (n: number) => onPageChange(Math.min(Math.max(1, n), Math.max(1, total)));

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-[#3a3a3e]', className)}>
      <div className="flex shrink-0 items-center justify-between border-b border-black/30 bg-[#2c2c30] px-3 py-1.5 text-[12px] text-[#c8c8ce]">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="rounded p-0.5 hover:bg-white/10 disabled:opacity-30"
            disabled={page <= 1}
            onClick={() => go(page - 1)}
            aria-label="이전 쪽"
          >
            <ChevronLeft size={15} />
          </button>
          <input
            type="number"
            value={page}
            min={1}
            max={total || 1}
            onChange={(e) => go(Number(e.target.value))}
            className="w-11 rounded bg-white/10 px-1.5 py-0.5 text-center tabular-nums outline-none focus:bg-white/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            aria-label="쪽 번호"
          />
          <span className="tabular-nums">/ {total || '…'}</span>
          <button
            type="button"
            className="rounded p-0.5 hover:bg-white/10 disabled:opacity-30"
            disabled={page >= total}
            onClick={() => go(page + 1)}
            aria-label="다음 쪽"
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="text-[11px] text-[#9a9aa2]">그리는 중…</span>}
          <button
            type="button"
            className="px-1 hover:text-white"
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}
            aria-label="축소"
          >
            −
          </button>
          <span className="w-11 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="px-1 hover:text-white"
            onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))}
            aria-label="확대"
          >
            ＋
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto" style={{ padding: PAD }}>
        <div className="relative mx-auto w-fit" {...surfaceProps}>
          <div
            ref={holderRef}
            className="relative bg-white shadow-[0_4px_18px_rgba(0,0,0,.35)]"
          />
          {overlay}
        </div>
        {error && (
          <div className="absolute inset-0 grid place-items-center bg-black/50 p-6 text-center text-sm text-white">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

type PdfDocument = Awaited<ReturnType<typeof openDoc>>;

async function openDoc(url: string) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  return pdfjs.getDocument({ url }).promise;
}
