'use client';

import { useState, type MouseEvent as ReactMouseEvent } from 'react';

import type { Editor } from '@tiptap/react';
import { AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  IMAGE_LINK_AREA_MAX_WIDTH,
  parseLinkRect,
  type LinkRect,
} from '@/lib/mail/image-link-area';

const IMAGE_NODE = 'imageResize';
// image-context-toolbar.tsx 의 WRAPPER_BASE 와 동일 값 — %width 제거된 기본 wrapper
const WRAPPER_BASE = 'display: inline-block; vertical-align: top; box-sizing: border-box;';
/** 드래그 최소 크기 (상대값) — 이보다 작으면 오클릭으로 보고 무시 */
const MIN_RECT_SIZE = 0.02;

interface Props {
  editor: Editor;
  onClose: () => void;
}

interface Point {
  x: number;
  y: number;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function toRelativePoint(e: ReactMouseEvent, el: HTMLElement): Point {
  const r = el.getBoundingClientRect();
  return {
    x: clamp01((e.clientX - r.left) / r.width),
    y: clamp01((e.clientY - r.top) / r.height),
  };
}

function normalizeRect(a: Point, b: Point): LinkRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function ImageLinkAreaModal({ editor, onClose }: Props) {
  const attrs = editor.getAttributes(IMAGE_NODE);
  const src = (attrs['src'] ?? '') as string;

  // 폭 고정 버튼을 누르면 editor attrs 는 바뀌지만 이 컴포넌트는 구독하지 않으므로
  // 로컬 override 로 즉시 반영한다.
  const [widthOverride, setWidthOverride] = useState<number | null>(null);
  const rawWidth = Number(attrs['width']);
  const pxWidth = widthOverride ?? (Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : null);
  const widthOk = pxWidth !== null && pxWidth <= IMAGE_LINK_AREA_MAX_WIDTH;

  const [rect, setRect] = useState<LinkRect | null>(
    parseLinkRect(attrs['linkRect'] as string | null),
  );
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  const hadRect = attrs['linkRect'] != null;

  const fixWidth = () => {
    editor
      .chain()
      .focus()
      .updateAttributes(IMAGE_NODE, {
        width: IMAGE_LINK_AREA_MAX_WIDTH,
        height: null,
        wrapperStyle: WRAPPER_BASE,
        containerStyle: 'width: 100%; height: auto;',
      })
      .run();
    setWidthOverride(IMAGE_LINK_AREA_MAX_WIDTH);
  };

  const save = () => {
    if (!rect || !natural || !widthOk) return;
    editor
      .chain()
      .focus()
      .updateAttributes(IMAGE_NODE, {
        linkRect: [rect.x, rect.y, rect.w, rect.h].map((n) => n.toFixed(4)).join(','),
        linkNatural: `${natural.width},${natural.height}`,
      })
      .run();
    onClose();
  };

  const remove = () => {
    editor
      .chain()
      .focus()
      .updateAttributes(IMAGE_NODE, { linkRect: null, linkNatural: null })
      .run();
    onClose();
  };

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!widthOk) return;
    e.preventDefault();
    setRect(null);
    setDragStart(toRelativePoint(e, e.currentTarget));
  };

  const onMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    setRect(normalizeRect(dragStart, toRelativePoint(e, e.currentTarget)));
  };

  const endDrag = () => {
    if (!dragStart) return;
    setDragStart(null);
    setRect((r) => (r && r.w >= MIN_RECT_SIZE && r.h >= MIN_RECT_SIZE ? r : null));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        <div className="border-b border-gray-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-900">클릭 영역 지정</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            이미지 위를 드래그해 설문 참여 버튼 영역을 지정하세요. 수신자가 이 영역을
            누르면 개인별 초대링크로 이동합니다.
          </p>
        </div>

        {!widthOk && (
          <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="flex-1 text-xs text-amber-800">
              클릭 영역은 폭 {IMAGE_LINK_AREA_MAX_WIDTH}px 이하의 고정폭 이미지에만
              지정할 수 있습니다. 퍼센트 크기나 더 큰 폭에서는 모바일에서 클릭 위치가
              어긋납니다.
            </div>
            <Button size="sm" variant="outline" onClick={fixWidth}>
              폭을 {IMAGE_LINK_AREA_MAX_WIDTH}px로 고정
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-5">
          <div
            className={widthOk ? 'relative inline-block cursor-crosshair select-none' : 'relative inline-block select-none opacity-50'}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt="클릭 영역 지정 대상"
              className="block max-w-full"
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  setNatural({ width: img.naturalWidth, height: img.naturalHeight });
                }
              }}
            />
            {rect && (
              <div
                className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/20"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                }}
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
          <div>
            {hadRect && (
              <Button size="sm" variant="ghost" className="text-red-600" onClick={remove}>
                영역 삭제
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button size="sm" onClick={save} disabled={!widthOk || !rect || !natural}>
              저장
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
