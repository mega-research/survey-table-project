'use client';

import { useMemo, useState } from 'react';

import type { SurveyAnchorSnapshot } from '@/db/schema/schema-types';
import { place, type PageBox, type ScrollBand } from '@/lib/survey-document/anchor-geometry';
import type { AnchorFocus } from '@/lib/survey-document/anchor-outline';
import { cn } from '@/lib/utils';

import { MAX_PAGE_SPAN, PdfPageView, type RenderedPageBox } from './pdf-page-view';

/**
 * 응답 화면 왼쪽의 조사표 판.
 *
 * 지금 고른 것의 영역과 그 **맥락(소속 그룹)** 영역만 그린다. 사각형을 전부
 * 그려두면 어디를 보는지 모른다 — 데모가 실물로 확인한 결론이다.
 *
 * 이동은 `focus.nonce` 가 바뀔 때만 일어난다. 선택은 상태고 쪽 이동은 행동이라,
 * 상태를 감시하면 응답자가 직접 넘긴 쪽을 곧바로 되돌린다.
 *
 * 조사표에 등록되지 않은 페이지에서는 이 판이 언마운트된다. 그때마다 문서를 다시
 * 열지는 않는다 — 뷰어가 주소별로 열린 문서를 들고 있다.
 */
interface Props {
  url: string;
  pageCount: number;
  /** 발행 스냅샷에서 온 얼린 좌표 전량 (ADR 0020). */
  anchors: readonly SurveyAnchorSnapshot[];
  /** 지금 켤 초점. null 이면 사각형을 하나도 그리지 않는다. */
  focus: (AnchorFocus & { nonce: number }) | null;
  /** 대상 id → 사각형 위에 얹을 이름. 없으면 라벨을 그리지 않는다. */
  labelOf?: ((ownerId: string) => string | null) | undefined;
  /** 사각형을 누르면 오른쪽 문항 목록으로 대응된다 (양방향). */
  onOwnerSelect?: (ownerId: string) => void;
}

export function ResponseDocumentPane({
  url,
  pageCount,
  anchors,
  focus,
  labelOf,
  onOwnerSelect,
}: Props) {
  const [page, setPage] = useState(1);
  const [boxes, setBoxes] = useState<RenderedPageBox[]>([]);
  // 이어 붙여 볼 다음 쪽 수. 초점이 여러 쪽에 걸치면 그 범위만큼 저절로 열린다.
  const [span, setSpan] = useState(0);
  const [followedNonce, setFollowedNonce] = useState<number | null>(null);

  // 렌더 중 조정 패턴 — 초점이 바뀐 그 렌더에서 쪽을 맞춘다. effect 로 미루면
  // 이전 초점의 쪽이 한 프레임 비쳤다가 튄다.
  if (focus && focus.nonce !== followedNonce) {
    setFollowedNonce(focus.nonce);
    const first = focus.pages[0] ?? page;
    const last = focus.pages[focus.pages.length - 1] ?? first;
    if (first !== page) setPage(first);
    // 블록이 쪽 경계에 걸쳐 있으면 그 범위를 이어 붙인다. 한 쪽짜리를 고르면 도로 접힌다.
    const wanted = Math.min(last - first, MAX_PAGE_SPAN);
    if (wanted !== span) setSpan(wanted);
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

  const pageBoxes: PageBox[] = boxes;

  /**
   * 쪽 안에서 어디를 보여줄지. 초점 사각형이 화면 밖일 때만 최소한으로 움직인다 —
   * 판정은 anchor-geometry 소관이고 여기서는 실측 배치를 재서 넘기기만 한다.
   */
  const scrollBand: ScrollBand | null = useMemo(() => {
    if (!focus || pageBoxes.length === 0) return null;
    const bandOf = (predicate: (ownerId: string) => boolean) => {
      const placed = drawn
        .filter(({ anchor }) => predicate(anchor.ownerId))
        .map(({ anchor }) => place(anchor, pageBoxes))
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
    };
  }, [focus, drawn, pageBoxes]);

  const overlay = (
    <>
      {drawn
        .map(({ anchor, isFocus }, index) => {
          // 그려지지 않은 쪽의 사각형은 place 가 null 을 낸다 — 그 자리에서 걸러진다.
          const placed = place(anchor, pageBoxes);
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
            >
              {/* 테두리만으로는 무엇의 영역인지 모른다 — 이름을 위에 얹는다.
                  맥락(그룹)은 왼쪽, 초점은 오른쪽에 붙여 서로 가리지 않게 한다. */}
              {labelOf?.(anchor.ownerId) && (
                <span
                  className={cn(
                    'absolute -top-[9px] max-w-[95%] truncate rounded px-1 text-[10px] leading-4 font-semibold text-white',
                    isFocus ? 'right-1 bg-amber-500' : 'left-1 bg-blue-500/80',
                  )}
                >
                  {labelOf(anchor.ownerId)}
                </span>
              )}
            </button>
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
      onPageBoxes={setBoxes}
      span={span}
      onSpanChange={setSpan}
      overlay={overlay}
      scrollBand={scrollBand}
    />
  );
}
