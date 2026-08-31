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

/**
 * 영역 색. 대상 종류(그룹/문항) × 활성 여부 넷을 한 곳에 모은다 —
 * 테두리와 라벨에서 중첩 삼항을 두 번 반복하면 한쪽만 어긋나도 눈에 띄지 않는다.
 */
const REGION_TONE = {
  'group:active': { border: 'border-blue-500', badge: 'bg-blue-500' },
  'group:idle': { border: 'border-blue-400/60', badge: 'bg-blue-500/70' },
  'question:active': { border: 'border-amber-500', badge: 'bg-amber-500' },
  'question:idle': { border: 'border-amber-400/60', badge: 'bg-amber-500/70' },
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

  function pointAt(e: React.MouseEvent<HTMLDivElement>) {
    const origin = e.currentTarget.getBoundingClientRect();
    return locate(pageBoxes, e.clientX - origin.left, e.clientY - origin.top);
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
              isGroup ? 'border-2' : 'border',
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
                'absolute -top-[9px] max-w-[95%] truncate rounded px-1 text-[10px] leading-4 font-semibold text-white',
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
