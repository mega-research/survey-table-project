'use client';

import { useMemo, useState } from 'react';

import type { SurveyAnchorSnapshot } from '@/db/schema/schema-types';
import { place, type PageBox, type ScrollBand } from '@/lib/survey-document/anchor-geometry';
import type { AnchorFocus } from '@/lib/survey-document/anchor-outline';
import { cn } from '@/lib/utils';

import { PdfPageView, type RenderedPageBox } from './pdf-page-view';

/**
 * 응답 화면 왼쪽의 조사표 판.
 *
 * 지금 고른 것의 영역과 그 **맥락(소속 그룹)** 영역만 그린다. 사각형을 전부
 * 그려두면 어디를 보는지 모른다 — 데모가 실물로 확인한 결론이다.
 *
 * 이동은 `focus.nonce` 가 바뀔 때만 일어난다. 선택은 상태고 쪽 이동은 행동이라,
 * 상태를 감시하면 응답자가 직접 넘긴 쪽을 곧바로 되돌린다.
 *
 * 분할이 시작된 뒤로는 언마운트되지 않는다. 셸의 같은 자리에 계속 놓이므로
 * 페이지를 넘겨도 pdf.js 문서가 다시 열리지 않는다.
 */
interface Props {
  url: string;
  pageCount: number;
  /** 발행 스냅샷에서 온 얼린 좌표 전량 (ADR 0020). */
  anchors: readonly SurveyAnchorSnapshot[];
  /** 지금 켤 초점. null 이면 사각형을 하나도 그리지 않는다. */
  focus: (AnchorFocus & { nonce: number }) | null;
  /** 사각형을 누르면 오른쪽 문항 목록으로 대응된다 (양방향). */
  onOwnerSelect?: (ownerId: string) => void;
}

export function ResponseDocumentPane({ url, pageCount, anchors, focus, onOwnerSelect }: Props) {
  const [page, setPage] = useState(1);
  const [pageBox, setPageBox] = useState<RenderedPageBox | null>(null);
  const [followedNonce, setFollowedNonce] = useState<number | null>(null);

  // 렌더 중 조정 패턴 — 초점이 바뀐 그 렌더에서 쪽을 맞춘다. effect 로 미루면
  // 이전 초점의 쪽이 한 프레임 비쳤다가 튄다.
  if (focus && focus.nonce !== followedNonce) {
    setFollowedNonce(focus.nonce);
    if (focus.page !== page) setPage(focus.page);
  }

  /** 초점 사각형과 맥락 사각형. 맥락이 곧 초점이면 하나로 접는다. */
  const drawn = useMemo(() => {
    if (!focus) return [];
    return anchors
      .filter(
        (anchor) => anchor.ownerId === focus.ownerId || anchor.ownerId === focus.contextId,
      )
      .map((anchor) => ({ anchor, isFocus: anchor.ownerId === focus.ownerId }));
  }, [anchors, focus]);

  const boxes: PageBox[] = pageBox ? [pageBox] : [];

  /**
   * 쪽 안에서 어디를 보여줄지. 초점 사각형이 화면 밖일 때만 최소한으로 움직인다 —
   * 판정은 anchor-geometry 소관이고 여기서는 실측 배치를 재서 넘기기만 한다.
   */
  const scrollBand: (ScrollBand & { nonce: number }) | null = useMemo(() => {
    if (!focus || boxes.length === 0) return null;
    const bandOf = (predicate: (ownerId: string) => boolean) => {
      const placed = drawn
        .filter(({ anchor }) => anchor.page === page && predicate(anchor.ownerId))
        .map(({ anchor }) => place(anchor, boxes))
        .filter((rect): rect is NonNullable<typeof rect> => rect !== null);
      if (placed.length === 0) return null;
      return {
        top: Math.min(...placed.map((rect) => rect.top)),
        bottom: Math.max(...placed.map((rect) => rect.top + rect.height)),
      };
    };
    const context = bandOf((ownerId) => ownerId === (focus.contextId ?? focus.ownerId));
    const target = bandOf((ownerId) => ownerId === focus.ownerId) ?? context;
    if (!context || !target) return null;
    return {
      contextTop: context.top,
      contextBottom: context.bottom,
      focusTop: target.top,
      focusBottom: target.bottom,
      nonce: focus.nonce,
    };
    // boxes 는 pageBox 에서 매 렌더 새로 만들어지므로 pageBox 를 의존으로 둔다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, drawn, page, pageBox]);

  const overlay = (
    <>
      {drawn
        .filter(({ anchor }) => anchor.page === page)
        .map(({ anchor, isFocus }, index) => {
          const placed = place(anchor, boxes);
          if (!placed) return null;
          return (
            <button
              type="button"
              key={`${anchor.ownerId}-${anchor.page}-${index}`}
              onClick={() => onOwnerSelect?.(anchor.ownerId)}
              aria-label="이 영역의 문항으로 이동"
              className={cn(
                // 채움 없이 테두리만 — 채우면 조사표 글씨를 덮는다
                'absolute rounded-[3px] transition-colors',
                isFocus ? 'border-2 border-amber-500' : 'border-2 border-blue-400/60',
                onOwnerSelect ? 'cursor-pointer' : 'pointer-events-none',
              )}
              style={{
                left: placed.left,
                top: placed.top,
                width: placed.width,
                height: placed.height,
              }}
            />
          );
        })}
    </>
  );

  return (
    <PdfPageView
      url={url}
      pageCount={pageCount}
      page={page}
      onPageChange={setPage}
      onPageBox={setPageBox}
      overlay={overlay}
      scrollBand={scrollBand}
    />
  );
}
