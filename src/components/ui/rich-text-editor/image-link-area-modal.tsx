'use client';

import { useState, type PointerEvent as ReactPointerEvent } from 'react';

import type { Editor } from '@tiptap/react';

import { Button } from '@/components/ui/button';
import { parseLinkRect, type LinkRect } from '@/lib/mail/image-link-area';

const IMAGE_NODE = 'imageResize';
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

function toRelativePoint(e: ReactPointerEvent, el: HTMLElement): Point {
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

  const [rect, setRect] = useState<LinkRect | null>(
    parseLinkRect(attrs['linkRect'] as string | null | undefined),
  );
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  const hadRect = attrs['linkRect'] != null;

  const save = () => {
    if (!rect || !natural) return;
    // 닫힌 뒤에도 이미지 컨텍스트 툴바(버튼 active 표시)가 유지되도록 선택 복원.
    // updateAttributes 로 NodeView 가 재생성되면 노드 선택이 풀려 imageActive
    // 조건부인 상위 ImageContextToolbar 가 언마운트되기 때문.
    const { from } = editor.state.selection;
    editor
      .chain()
      .focus()
      .updateAttributes(IMAGE_NODE, {
        linkRect: [rect.x, rect.y, rect.w, rect.h].map((n) => n.toFixed(4)).join(','),
        linkNatural: `${natural.width},${natural.height}`,
      })
      .setNodeSelection(from)
      .run();
    onClose();
  };

  const remove = () => {
    const { from } = editor.state.selection;
    editor
      .chain()
      .focus()
      .updateAttributes(IMAGE_NODE, { linkRect: null, linkNatural: null })
      .setNodeSelection(from)
      .run();
    onClose();
  };

  // 마우스 이벤트 대신 pointer capture 를 사용한다 — 드래그 중 포인터가 이미지
  // 밖으로 나가도 move/up 이 계속 이 요소로 전달되어 실사용 드래그가 끊기지 않는다.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setRect(null);
    setDragStart(toRelativePoint(e, e.currentTarget));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
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
            누르면 개인별 초대링크로 이동합니다. 저장 시 이미지가 가로 밴드로 분할되어
            지정한 높이 구간 전체가 클릭 가능해집니다.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          <div
            className="relative inline-block cursor-crosshair select-none touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDragStart={(e) => e.preventDefault()}
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
              <>
                {/* 실제 클릭 가능 범위(가로 밴드 전체)를 은은하게 표시 */}
                <div
                  className="pointer-events-none absolute inset-x-0 bg-blue-500/10"
                  style={{ top: `${rect.y * 100}%`, height: `${rect.h * 100}%` }}
                />
                <div
                  className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/20"
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.w * 100}%`,
                    height: `${rect.h * 100}%`,
                  }}
                />
              </>
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
            <Button size="sm" onClick={save} disabled={!rect || !natural}>
              저장
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
