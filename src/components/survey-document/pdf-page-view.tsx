'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ChevronLeft, ChevronRight, Rows2 } from 'lucide-react';

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
  /**
   * 렌더가 끝날 때마다 **그려진 쪽 전부**의 실측 배치를 올려보낸다.
   * 이어보기에서는 둘 이상이 온다 — 좌표 모듈은 원래 여러 쪽을 받는 모양이다.
   */
  onPageBoxes?: (boxes: RenderedPageBox[]) => void;
  /** 현재 쪽에 이어 붙여 볼 다음 쪽 수. 0 이면 한 쪽만. */
  span?: number;
  onSpanChange?: ((span: number) => void) | undefined;
  /** 페이지 위에 겹쳐 그릴 것 (영역 사각형 등). */
  overlay?: React.ReactNode;
  /**
   * 쪽 안에서 보여줄 구간. 좌표는 이 컴포넌트가 올려보낸 실측 배치(onPageBoxes)와
   * 같은 원점이라, 스크롤 좌표로 옮기는 안쪽 여백은 여기서 더한다.
   *
   * **nonce 로 가드하지 않는다.** "이미 보이면 움직이지 않는다"는 판정은
   * `scrollTarget` 이 이미 한다. 가드를 걸면 초점이 바뀐 직후(아직 새 쪽이 그려지기
   * 전) 한 번 소진돼, 정작 새 쪽이 그려진 뒤에는 맞추지 못하고 엉뚱한 자리에 남는다.
   */
  scrollBand?: ScrollBand | null;
  /**
   * 쪽을 감싼 상자에 붙일 마우스 핸들러 — 영역 드래그용.
   * overlay 와 **같은 좌표 원점**을 갖는 요소에 붙는다(그래서 캔버스가 아니라 감싼 상자다) —
   * 드래그로 만든 사각형과 그려진 사각형이 어긋나지 않는 것이 여기에 걸려 있다.
   *
   * `className` 은 덮어쓰지 않고 **합쳐진다**. 이 상자의 `relative mx-auto w-fit` 은
   * 좌표계 그 자체다 — `relative` 가 빠지면 실측 원점(offsetParent)이 스크롤 상자로
   * 옮겨가고, `mx-auto w-fit` 이 빠지면 상자가 전폭이 되어 왼쪽 끝이 쪽의 왼쪽 끝과
   * 달라진다. 둘 다 드래그 좌표를 조용히 어긋나게 한다.
   */
  surfaceProps?: React.HTMLAttributes<HTMLDivElement>;
  className?: string;
}

// 프로토타입과 같은 여백 — 편집 화면과 응답 화면이 같은 자를 써야 같은 영역이 같게 보인다.
const PAD = 24;
/** 이어 붙인 쪽 사이의 간격. */
const PAGE_GAP = 12;
/**
 * 한 번에 이어 붙일 다음 쪽 수의 상한. 블록이 아무리 넓게 걸쳐도 여기서 끊는다 —
 * 스무 쪽을 한 줄로 이으면 "지금 몇 쪽인가"를 다시 잃는다.
 */
export const MAX_PAGE_SPAN = 3;

export function PdfPageView({
  url,
  pageCount,
  page,
  onPageChange,
  onPageBoxes,
  span = 0,
  onSpanChange,
  overlay,
  scrollBand = null,
  surfaceProps,
  className,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const renderToken = useRef(0);

  // className 은 합치고 나머지 핸들러만 펼친다 — 통째로 펼치면 좌표계를 만드는
  // 레이아웃 클래스가 사라진다 (JSX 는 뒤에 온 prop 이 이긴다).
  const { className: surfaceClassName, ...surfaceHandlers } = surfaceProps ?? {};

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
        setFailure({ url, message: describeOpenFailure(e) });
      });
    return () => {
      alive = false;
      void opening?.cleanup();
    };
  }, [url]);

  const renderPage = useCallback(async () => {
    const stack = holderRef.current;
    const scroller = scrollRef.current;
    if (!doc || !stack || !scroller) return;

    // 이어보기: 현재 쪽에 다음 쪽들을 붙여 함께 그린다. 쪽 경계에 걸친 블록을
    // 두 번 넘겨 가며 확인하지 않아도 된다.
    const first = Math.min(Math.max(1, page), doc.numPages);
    const targets = Array.from({ length: span + 1 }, (_, i) => first + i).filter(
      (n) => n >= 1 && n <= doc.numPages,
    );
    const token = ++renderToken.current;
    setRendering(true);
    try {
      const holders: HTMLDivElement[] = [];
      const drawn: { page: number; width: number; height: number }[] = [];

      for (const target of targets) {
        const pdfPage = await doc.getPage(target);
        if (token !== renderToken.current) return;

        const base = pdfPage.getViewport({ scale: 1 });
        // 폭을 재는 시점이 그리기 **전**이라, 세로 스크롤바가 자리를 차지하는 환경
        // (윈도우·리눅스의 고전 스크롤바)에서는 렌더 뒤에 clientWidth 가 줄어든다.
        // 스크롤바 자리를 늘 비워두는 것(scrollbarGutter: stable)으로 그쪽을 막는다.
        const avail = Math.floor(Math.max(320, scroller.clientWidth - PAD * 2) * zoom);
        const viewport = pdfPage.getViewport({ scale: avail / base.width });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        // CSS 폭은 **내림한 정수**를 쓴다. viewport.width 는 base.width * (avail/base.width)
        // 라 부동소수점 오차로 avail 보다 아주 조금 클 수 있고, 그 0.0000001px 이
        // 그대로 가로 스크롤바를 만든다 (맥의 오버레이 스크롤바에서도 뜬다).
        const cssWidth = Math.floor(viewport.width);
        const cssHeight = Math.floor(viewport.height);

        const pageBox = document.createElement('div');
        pageBox.style.cssText = [
          'position:relative',
          `width:${cssWidth}px`,
          `height:${cssHeight}px`,
          `margin:0 auto ${targets.length > 1 ? PAGE_GAP : 0}px`,
          'background:#fff',
          'box-shadow:0 4px 18px rgba(0,0,0,.35)',
        ].join(';');

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        canvas.style.display = 'block';
        pageBox.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.scale(dpr, dpr);
          await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise;
        }
        if (token !== renderToken.current) return;

        holders.push(pageBox);
        drawn.push({ page: target, width: cssWidth, height: cssHeight });
      }

      stack.replaceChildren(...holders);
      // 화면 좌표는 계산하지 않고 잰다 — 계산이 데모에서 버그의 원천이었다.
      // 쌓아 넣은 **뒤라야** 각 쪽의 실제 자리가 나온다.
      onPageBoxes?.(
        drawn.map((box, index) => {
          const el = holders[index];
          return {
            ...box,
            left: el?.offsetLeft ?? 0,
            top: el?.offsetTop ?? 0,
          };
        }),
      );
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
  }, [doc, page, span, zoom, url, onPageBoxes]);

  useEffect(() => {
    void renderPage();
  }, [renderPage]);

  // 쪽만 넘기고 끝내면 확대했거나 긴 쪽에서 영역이 화면 밖에 남는다.
  // 이미 보이는 동안은 움직이지 않는 판정은 anchor-geometry(scrollTarget) 소관이라
  // 여기서 따로 가드하지 않는다 — 그래서 응답자가 직접 스크롤한 위치를 빼앗지 않는다.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !scrollBand || rendering) return;
    const want = scrollTarget({
      // 실측 배치는 쪽을 감싼 상자 기준이고 scrollTop 은 스크롤 상자 기준이라,
      // 그 사이의 안쪽 여백만큼 옮겨 놓아야 같은 자를 쓴다.
      contextTop: scrollBand.contextTop + PAD,
      contextBottom: scrollBand.contextBottom + PAD,
      focusTop: scrollBand.focusTop + PAD,
      focusBottom: scrollBand.focusBottom + PAD,
      viewTop: scroller.scrollTop,
      viewHeight: scroller.clientHeight,
      // 맥락 상단에 맞출 때의 숨 쉴 자리 — 프로토타입과 같은 값
      pad: 80,
    });
    if (want !== null) scroller.scrollTo({ top: want, behavior: 'smooth' });
  }, [scrollBand, rendering]);

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
          {onSpanChange && (
            <button
              type="button"
              title={
                span > 0
                  ? '이어보기 끄기'
                  : '다음 쪽을 이어 붙여 본다 — 쪽 경계에 걸친 문항을 확인할 때'
              }
              onClick={() => onSpanChange(span > 0 ? 0 : 1)}
              disabled={page >= total}
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-30',
                span > 0 ? 'bg-white/25 text-white' : 'hover:bg-white/10',
              )}
            >
              <Rows2 size={13} />
              {span > 0 ? `${page}–${Math.min(page + span, total)}쪽` : '이어보기'}
            </button>
          )}
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

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto"
        style={{ padding: PAD, scrollbarGutter: 'stable' }}
      >
        <div
          {...surfaceHandlers}
          className={cn('relative mx-auto w-fit', surfaceClassName)}
        >
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

/**
 * 문서를 여는 데 실패한 이유를 사람이 읽을 문장으로.
 *
 * 이 뷰어는 앱에서 **JS 로 R2 객체를 fetch 하는 첫 표면**이다. 기존 R2 사용처는
 * 전부 `<img>` 라 CORS 가 필요 없었고, 그래서 버킷에 CORS 정책이 없어도 아무도
 * 몰랐다. 그 상태에서 브라우저가 내는 것은 `Failed to fetch` 한 줄뿐이라 원인이
 * 파일 문제처럼 보인다 — 새 환경(프로덕션·프리뷰)에서 같은 함정을 다시 밟았을 때
 * 어디를 봐야 하는지 화면이 말하게 한다.
 */
function describeOpenFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return '조사표를 불러오지 못했습니다. 파일 저장소가 이 주소에서의 읽기를 허용하지 않는 상태일 수 있습니다 (저장소 CORS 설정).';
  }
  return raw || '조사표를 불러오지 못했습니다.';
}

async function openDoc(url: string) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  return pdfjs.getDocument({ url }).promise;
}
