'use client';

import { useState, type PointerEvent as ReactPointerEvent } from 'react';

import type { Editor } from '@tiptap/react';

import { Button } from '@/components/ui/button';
import { DEFAULT_LINK_HREF, parseLinkRect, type LinkRect } from '@/lib/mail/image-link-area';

import type { VariableDef } from './types';

const IMAGE_NODE = 'imageResize';
/** 링크 대상 select 의 "직접 입력" 항목 값 */
const CUSTOM_TARGET = '__custom__';
const TOKEN_ONLY_RE = /^\{\{([^{}]+)\}\}$/;
/** 드래그 최소 크기 (상대값) — 이보다 작으면 오클릭으로 보고 무시 */
const MIN_RECT_SIZE = 0.02;

interface Props {
  editor: Editor;
  /** 링크 대상으로 고를 수 있는 변수 (attrs 컬럼). 기본값 응답 페이지 링크는 항상 포함. */
  variableCatalog: VariableDef[];
  onClose: () => void;
}

/** 저장된 href 를 select 값 + 직접 입력값으로 분해 */
function splitHref(href: string | null | undefined): { target: string; custom: string } {
  const v = (href ?? '').trim();
  if (!v || v === DEFAULT_LINK_HREF) return { target: DEFAULT_LINK_HREF, custom: '' };
  if (TOKEN_ONLY_RE.test(v)) return { target: v, custom: '' };
  return { target: CUSTOM_TARGET, custom: v };
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

export function ImageLinkAreaModal({ editor, variableCatalog, onClose }: Props) {
  const attrs = editor.getAttributes(IMAGE_NODE);
  const src = (attrs['src'] ?? '') as string;

  const initialHref = splitHref(attrs['linkHref'] as string | null | undefined);
  const [target, setTarget] = useState(initialHref.target);
  const [custom, setCustom] = useState(initialHref.custom);
  const attrVars = variableCatalog.filter((v) => v.category === 'attrs');
  // 저장된 토큰이 현재 카탈로그에 없어도(컬럼 삭제 등) 선택지에 남겨 값을 잃지 않게 한다.
  const orphanToken =
    target !== CUSTOM_TARGET &&
    target !== DEFAULT_LINK_HREF &&
    !attrVars.some((v) => `{{${v.key}}}` === target)
      ? target
      : null;
  const resolvedHref = target === CUSTOM_TARGET ? custom.trim() : target;
  // 기본값은 속성을 비워 기존 템플릿과 같은 형태로 저장
  const linkHrefAttr = resolvedHref && resolvedHref !== DEFAULT_LINK_HREF ? resolvedHref : null;
  const hrefValid = target !== CUSTOM_TARGET || /^https?:\/\/\S+$/i.test(custom.trim());

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
        linkHref: linkHrefAttr,
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
      .updateAttributes(IMAGE_NODE, { linkRect: null, linkNatural: null, linkHref: null })
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
            누르면 아래에서 고른 링크로 이동합니다. 저장 시 이미지가 가로 밴드로 분할되어
            지정한 높이 구간 전체가 클릭 가능해집니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3">
          <label htmlFor="image-link-target" className="text-xs font-medium text-gray-700">
            링크 대상
          </label>
          <select
            id="image-link-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-900"
          >
            <option value={DEFAULT_LINK_HREF}>응답 페이지 링크 (개인별 초대링크)</option>
            {attrVars.map((v) => (
              <option key={v.key} value={`{{${v.key}}}`}>
                {v.label} {`{{${v.key}}}`}
              </option>
            ))}
            {orphanToken && <option value={orphanToken}>{orphanToken} (카탈로그에 없음)</option>}
            <option value={CUSTOM_TARGET}>직접 입력 (URL)</option>
          </select>
          {target === CUSTOM_TARGET && (
            <input
              type="url"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="https://"
              className="h-8 min-w-[16rem] flex-1 rounded-md border border-gray-300 px-2 text-xs text-gray-900"
            />
          )}
          {!hrefValid && (
            <span className="text-xs text-red-600">http(s):// 로 시작하는 URL 을 입력하세요</span>
          )}
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
            <Button size="sm" onClick={save} disabled={!rect || !natural || !hrefValid}>
              저장
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
