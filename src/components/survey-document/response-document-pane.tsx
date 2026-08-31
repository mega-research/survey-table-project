'use client';

import { useMemo, useState } from 'react';

import type { SurveyAnchorSnapshot } from '@/db/schema/schema-types';
import { place, type PageBox } from '@/lib/survey-document/anchor-geometry';

import { PdfPageView, type RenderedPageBox } from './pdf-page-view';

/**
 * 응답 화면 왼쪽의 조사표 판.
 *
 * 지금 보고 있는 대상의 영역**만** 그린다. 사각형을 전부 그려두면 어디를 보는지
 * 모른다 — 데모가 실물로 확인한 결론이다.
 *
 * 분할이 시작된 뒤로는 언마운트되지 않는다. 셸의 같은 자리에 계속 놓이므로
 * 페이지를 넘겨도 pdf.js 문서가 다시 열리지 않는다.
 */
interface Props {
  url: string;
  pageCount: number;
  /** 발행 스냅샷에서 온 얼린 좌표 전량 (ADR 0020). */
  anchors: readonly SurveyAnchorSnapshot[];
  /** 지금 켤 대상. null 이면 사각형을 하나도 그리지 않는다. */
  activeOwnerId: string | null;
}

export function ResponseDocumentPane({ url, pageCount, anchors, activeOwnerId }: Props) {
  const [page, setPage] = useState(1);
  const [pageBox, setPageBox] = useState<RenderedPageBox | null>(null);
  // 대상이 바뀐 순간에만 따라간다. 대상을 감시해 매 렌더 맞추면 응답자가 직접 넘긴
  // 쪽을 곧바로 되돌린다 — 선택은 상태고 쪽 이동은 행동이다.
  const [followedOwnerId, setFollowedOwnerId] = useState<string | null>(null);

  const activeAnchors = useMemo(
    () => (activeOwnerId ? anchors.filter((anchor) => anchor.ownerId === activeOwnerId) : []),
    [anchors, activeOwnerId],
  );

  // 렌더 중 조정 패턴 — 대상이 바뀐 그 렌더에서 쪽을 맞춘다. effect 로 미루면
  // 이전 대상의 쪽이 한 프레임 비쳤다가 튄다.
  if (activeOwnerId !== followedOwnerId) {
    setFollowedOwnerId(activeOwnerId);
    const first = activeAnchors.reduce<number | null>(
      (min, anchor) => (min === null || anchor.page < min ? anchor.page : min),
      null,
    );
    if (first !== null && first !== page) setPage(first);
  }

  const boxes: PageBox[] = pageBox ? [pageBox] : [];
  const overlay = (
    <>
      {activeAnchors
        .filter((anchor) => anchor.page === page)
        .map((anchor, index) => {
          const placed = place(anchor, boxes);
          if (!placed) return null;
          return (
            <div
              key={`${anchor.ownerId}-${anchor.page}-${index}`}
              // 채움 없이 테두리만 — 채우면 조사표 글씨를 덮는다
              className="pointer-events-none absolute rounded-[3px] border-2 border-blue-500"
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
    />
  );
}
