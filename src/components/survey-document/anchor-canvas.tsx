'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import {
  locate,
  locateOnPage,
  normalizeDrag,
  place,
  type NormRect,
  type PageBox,
} from '@/lib/survey-document/anchor-geometry';

import { PdfPageView, type RenderedPageBox } from './pdf-page-view';

/** 화면에 그릴 사각형 하나. 한 대상에 여럿이 붙으므로 id 와 ownerId 를 나눠 갖는다. */
export interface CanvasRegion extends NormRect {
  id: string;
  ownerId: string;
  label: string;
  kind: 'group' | 'question';
}

interface Props {
  url: string;
  pageCount: number;
  page: number;
  onPageChange: (page: number) => void;
  regions: CanvasRegion[];
  /** 지금 강조할 대상. 활성 영역만 진하게 그린다 — 전부 진하면 어디를 보는지 모른다. */
  activeOwnerId?: string | null;
  /**
   * 영역 지정 모드. null 이면 평소 모드라 **드래그가 아무것도 만들지 않는다** —
   * 오조작으로 항목이 생기던 데모 첫판을 뒤집은 결정이다.
   */
  drawingFor?: { label: string } | null;
  onDraw?: (rect: NormRect) => void;
  onCancelDraw?: () => void;
  onRegionClick?: (region: CanvasRegion) => void;
}

/**
 * 영역 색. 대상 종류(그룹/문항) × 활성 여부 넷을 한 곳에 모은다 —
 * 테두리와 라벨에서 중첩 삼항을 두 번 반복하면 한쪽만 어긋나도 눈에 띄지 않는다.
 */
const REGION_TONE = {
  // 액센트는 파랑 하나 - 그룹(담는 상자)은 가는 선, 문항은 굵은 선으로 가른다.
  'group:active': { border: 'border-blue-500', badge: 'bg-blue-100 text-blue-800' },
  'group:idle': { border: 'border-blue-300', badge: 'bg-blue-50 text-blue-700' },
  'question:active': { border: 'border-blue-600', badge: 'bg-blue-600 text-white' },
  'question:idle': { border: 'border-blue-400/70', badge: 'bg-blue-500/80 text-white' },
} as const;

type Drag = {
  start: { page: number; x: number; y: number };
  end: { page: number; x: number; y: number };
};

/**
 * 조사표 위에 영역을 그리고 보여주는 판.
 * 좌표 계산은 전부 anchor-geometry 소관이고, 이 컴포넌트는 DOM 만 다룬다.
 */
export function AnchorCanvas({
  url,
  pageCount,
  page,
  onPageChange,
  regions,
  activeOwnerId = null,
  drawingFor = null,
  onDraw,
  onCancelDraw,
  onRegionClick,
}: Props) {
  // 이어보기를 켜면 실측 상자가 여럿 온다. 좌표 모듈은 원래 목록을 받는다.
  const [boxes, setBoxes] = useState<RenderedPageBox[]>([]);
  const [span, setSpan] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);

  const pageBoxes: PageBox[] = boxes;
  const drawable = Boolean(drawingFor);

  /** 드래그가 시작된 감싼 상자. 진행 중에는 여기서 원점을 다시 잰다(스크롤돼도 맞다). */
  const surfaceRef = useRef<HTMLElement | null>(null);

  /**
   * 시작한 뒤에는 창 전체에서 받는다 — 감싼 상자를 벗어났다고 드래그를 버리면
   * 쪽 아래 끝까지 끌 수 없다.
   *
   * 끝점은 **시작 쪽에 고정**해 읽는다. 커서가 다음 쪽이나 쪽 사이 여백으로 내려가면
   * `locate` 는 다른 쪽을 가리키거나 null 을 내고, 그러면 만들던 사각형이 사라진다.
   * 쪽 밖으로 나간 값은 normalizeDrag 가 잘라 그 쪽 아래 끝까지 그린 것으로 만든다.
   * 쪽을 넘는 구간은 사각형 두 개로 나눠 잡는 것이 이 좌표 모델의 규칙이다.
   */
  useEffect(() => {
    if (!drag) return;
    const endPoint = (clientX: number, clientY: number) => {
      const surface = surfaceRef.current;
      if (!surface) return null;
      const origin = surface.getBoundingClientRect();
      return locateOnPage(
        pageBoxes,
        drag.start.page,
        clientX - origin.left,
        clientY - origin.top,
      );
    };
    const move = (e: MouseEvent) => {
      const hit = endPoint(e.clientX, e.clientY);
      if (hit) setDrag((prev) => (prev ? { ...prev, end: hit } : prev));
    };
    const up = (e: MouseEvent) => {
      const hit = endPoint(e.clientX, e.clientY) ?? drag.end;
      setDrag(null);
      const rect = normalizeDrag(drag.start, hit);
      if (rect) onDraw?.(rect);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [drag, pageBoxes, onDraw]);

  const surfaceProps = {
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => {
      if (!drawable) return;
      const origin = e.currentTarget.getBoundingClientRect();
      const hit = locate(pageBoxes, e.clientX - origin.left, e.clientY - origin.top);
      if (!hit || hit.x < 0 || hit.x > 1) return;
      e.preventDefault();
      surfaceRef.current = e.currentTarget;
      setDrag({ start: hit, end: hit });
    },
    className: drawable ? 'cursor-crosshair select-none' : undefined,
  };

  const dragRect = drag ? normalizeDrag(drag.start, drag.end) : null;
  const dragPlaced = dragRect ? place(dragRect, pageBoxes) : null;

  const overlay = (
    <>
      {regions.map((region) => {
        // 그려지지 않은 쪽의 사각형은 place 가 null 을 낸다 — 그 자리에서 걸러진다.
        const placed = place(region, pageBoxes);
        if (!placed) return null;
        const isGroup = region.kind === 'group';
        const tone =
          REGION_TONE[
            `${isGroup ? 'group' : 'question'}:${region.ownerId === activeOwnerId ? 'active' : 'idle'}`
          ];
        return (
          <div
            key={region.id}
            onClick={() => !drawable && onRegionClick?.(region)}
            className={cn(
              'absolute rounded-[3px] transition-colors',
              // 그룹은 담는 상자라 가는 선, 문항은 굵은 선 - 색이 하나라 굵기가 위계다
              isGroup ? 'border' : 'border-2',
              // 지정 중에는 기존 영역이 드래그를 가로막지 않는다
              drawable && 'pointer-events-none opacity-40',
              // 채움 없이 테두리만 — 채우면 조사표 글씨를 덮는다
              tone.border,
              !drawable && (onRegionClick ? 'cursor-pointer' : 'pointer-events-none'),
            )}
            style={{
              left: placed.left,
              top: placed.top,
              width: placed.width,
              height: placed.height,
            }}
          >
            <span
              className={cn(
                'absolute -top-[9px] max-w-[95%] truncate rounded px-1 text-[10px] leading-4 font-semibold',
                isGroup ? 'left-1' : 'right-1',
                tone.badge,
              )}
            >
              {region.label}
            </span>
          </div>
        );
      })}

      {dragPlaced && (
        <div
          className="pointer-events-none absolute rounded-[3px] border-2 border-dashed border-blue-300 bg-blue-300/20"
          style={{
            left: dragPlaced.left,
            top: dragPlaced.top,
            width: dragPlaced.width,
            height: dragPlaced.height,
          }}
        />
      )}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {drawingFor && (
        <div className="flex shrink-0 items-center justify-between gap-3 bg-blue-600 px-4 py-2 text-[12px] text-white">
          <span className="truncate">
            <b>{drawingFor.label}</b> 의 영역을 드래그하세요
          </span>
          <button
            type="button"
            className="shrink-0 rounded px-2 py-0.5 hover:bg-white/20"
            onClick={onCancelDraw}
          >
            취소
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <PdfPageView
          url={url}
          pageCount={pageCount}
          page={page}
          onPageChange={onPageChange}
          onPageBoxes={setBoxes}
          span={span}
          onSpanChange={setSpan}
          surfaceProps={surfaceProps}
          overlay={overlay}
        />
      </div>
    </div>
  );
}
