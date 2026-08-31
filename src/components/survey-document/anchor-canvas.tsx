'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';
import {
  locate,
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
  // 쪽 단위 뷰어라 실측 상자는 언제나 한 개다. 좌표 모듈은 목록을 받으므로 감싸 넘긴다.
  const [pageBox, setPageBox] = useState<RenderedPageBox | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const boxes: PageBox[] = pageBox ? [pageBox] : [];
  const drawable = Boolean(drawingFor);

  function pointAt(e: React.MouseEvent<HTMLDivElement>) {
    const origin = e.currentTarget.getBoundingClientRect();
    return locate(boxes, e.clientX - origin.left, e.clientY - origin.top);
  }

  const surfaceProps = {
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => {
      if (!drawable) return;
      const hit = pointAt(e);
      if (!hit || hit.x < 0 || hit.x > 1) return;
      e.preventDefault();
      setDrag({ start: hit, end: hit });
    },
    onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => {
      if (!drag) return;
      const hit = pointAt(e);
      if (hit) setDrag({ ...drag, end: hit });
    },
    onMouseUp: () => {
      if (!drag) return;
      const rect = normalizeDrag(drag.start, drag.end);
      setDrag(null);
      if (rect) onDraw?.(rect);
    },
    onMouseLeave: () => setDrag(null),
    className: drawable ? 'cursor-crosshair select-none' : undefined,
  };

  const dragRect = drag ? normalizeDrag(drag.start, drag.end) : null;
  const dragPlaced = dragRect ? place(dragRect, boxes) : null;
  const onThisPage = regions.filter((r) => r.page === page);

  const overlay = (
    <>
      {onThisPage.map((region) => {
        const placed = place(region, boxes);
        if (!placed) return null;
        const active = region.ownerId === activeOwnerId;
        const isGroup = region.kind === 'group';
        return (
          <div
            key={region.id}
            onClick={() => !drawable && onRegionClick?.(region)}
            className={cn(
              'absolute rounded-[3px] transition-colors',
              isGroup ? 'border-2' : 'border',
              // 지정 중에는 기존 영역이 드래그를 가로막지 않는다
              drawable && 'pointer-events-none opacity-40',
              // 채움 없이 테두리만 — 채우면 조사표 글씨를 덮는다
              active
                ? isGroup
                  ? 'border-blue-500'
                  : 'border-amber-500'
                : isGroup
                  ? 'border-blue-400/60'
                  : 'border-amber-400/60',
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
                'absolute -top-[9px] max-w-[95%] truncate rounded px-1 text-[10px] leading-4 font-semibold text-white',
                isGroup ? 'left-1' : 'right-1',
                active
                  ? isGroup
                    ? 'bg-blue-500'
                    : 'bg-amber-500'
                  : isGroup
                    ? 'bg-blue-500/70'
                    : 'bg-amber-500/70',
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
          onPageBox={setPageBox}
          surfaceProps={surfaceProps}
          overlay={overlay}
        />
      </div>
    </div>
  );
}
