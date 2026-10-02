'use client';

import React from 'react';

import { CellText } from '@/features/question-renderer/cell-text';
import { cn } from '@/lib/utils';
import type { TableCell } from '@/types/survey';

interface CellContentLayoutProps {
  content: string | undefined;
  /** 본문 서식본(토큰 치환까지 끝낸 것). 있으면 content 대신 그린다. resolveCellTextHtml 참조. */
  contentHtml?: string | undefined;
  position?: TableCell['textPosition'];
  children: React.ReactNode;
  /** 텍스트 라벨 div 에 추가로 적용할 className (예: 빌더 미리보기 톤 변경) */
  /** 셀 콘텐츠 라벨만 굵게 표시한다. */
  bold?: boolean | undefined;
  /** 라벨의 첫 줄만 굵게. `bold`(라벨 전체)와 배타. */
  boldFirstLine?: boolean | undefined;
  /** 라벨 글자색. DEFAULT_LABEL_CLASS 의 text-gray-700 을 이겨야 하므로 inline style 로 얹는다. */
  textColor?: string | undefined;
  /**
   * left/right 배치에서 자식(입력칸)이 남는 폭을 채우는가. 기본 true. 입력칸 너비를 고정한 셀은
   * false 로 두어 단위 글자가 입력칸 바로 뒤에 붙게 한다(채우면 글자가 셀 끝으로 밀린다).
   */
  fillWidth?: boolean | undefined;
  /**
   * 셀 가로 정렬 — fillWidth=false 인 left/right 배치에서 [입력칸+라벨] 묶음을 어디에 둘지.
   * 셀 컨테이너의 items-* 는 w-full 인 이 행에 닿지 않아 여기서 justify-* 로 옮긴다.
   */
  horizontalAlign?: TableCell['horizontalAlign'];
  /**
   * 입력칸 아래에 붙는 보조 줄(단위 읽기 「1백만원」·글자 수·흐름 속 위반 안내).
   * left/right 배치에서 children 과 한 덩어리로 두면 라벨이 [입력칸+보조 줄] 전체의 세로
   * 가운데로 내려가 입력칸과 어긋난다 — 따로 받아 라벨은 입력칸 하나와만 맞추고 보조 줄은
   * 입력칸 열 아래에 둔다.
   * 내용이 생겼다 사라지는 보조 줄은 **늘 같은 요소를 넘기고 비었을 때 숨길 것**(empty:hidden) —
   * 있을 때만 넘기면 트리 모양이 바뀌어 입력칸이 다시 마운트되고 포커스를 잃는다.
   */
  below?: React.ReactNode;
}

const ROW_JUSTIFY = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
} as const;

const DEFAULT_LABEL_CLASS =
  'text-base font-medium whitespace-pre-wrap [overflow-wrap:anywhere] text-gray-700 shrink-0';

/**
 * 인터랙티브 셀의 텍스트(content) 위치 레이아웃.
 * - top(기본): 텍스트 위, 입력 아래
 * - bottom: 입력 위, 텍스트 아래
 * - left: 텍스트 왼쪽, 입력 오른쪽 (세로 가운데 정렬)
 * - right: 입력 왼쪽, 텍스트 오른쪽 (세로 가운데 정렬)
 *
 * content 가 비어있으면 wrapper 없이 children 만 반환한다.
 */
export function CellContentLayout({
  content,
  contentHtml,
  position = 'top',
  children,
  bold = false,
  boldFirstLine = false,
  textColor,
  fillWidth = true,
  horizontalAlign,
  below,
}: CellContentLayoutProps) {
  const childCls = fillWidth ? 'min-w-0 flex-1' : 'min-w-0 shrink-0';
  const rowCls = cn(
    'flex w-full items-center gap-2',
    !fillWidth && ROW_JUSTIFY[horizontalAlign ?? 'left'],
  );
  const hasContent = (!!content && content.trim().length > 0) || !!contentHtml;
  const stacked = below ? (
    // gap 인 이유 — 호출측이 빈 보조 줄을 숨긴 채(empty:hidden) 늘 넘겨도 간격이 생기지 않는다
    <div className="flex w-full flex-col gap-1.5">
      {children}
      {below}
    </div>
  ) : (
    children
  );
  if (!hasContent) {
    return <>{stacked}</>;
  }

  const label = (
    <div
      className={cn(DEFAULT_LABEL_CLASS, bold && 'font-bold')}
      style={textColor ? { color: textColor } : undefined}
    >
      <CellText text={content ?? ''} html={contentHtml} boldFirstLine={boldFirstLine} />
    </div>
  );

  // 보조 줄이 있는 left/right — 2열 격자. 1행에서 입력칸과 라벨을 세로 가운데로 맞추고,
  // 보조 줄은 2행의 입력칸 열에 둔다.
  if (below && (position === 'left' || position === 'right')) {
    const inputFirst = position === 'right';
    const inputTrack = fillWidth ? 'minmax(0,1fr)' : 'auto';
    return (
      <div
        className={cn(
          'grid w-full items-center gap-x-2 gap-y-1.5',
          !fillWidth && ROW_JUSTIFY[horizontalAlign ?? 'left'],
        )}
        style={{
          gridTemplateColumns: inputFirst ? `${inputTrack} auto` : `auto ${inputTrack}`,
        }}
      >
        {!inputFirst && label}
        <div className="min-w-0">{children}</div>
        {inputFirst && label}
        {/* 보조 줄이 비어 숨겨졌으면 이 칸도 접는다 — 남기면 빈 2행과 행 간격이 생긴다 */}
        <div className={cn('min-w-0 has-[>:empty]:hidden', !inputFirst && 'col-start-2')}>
          {below}
        </div>
      </div>
    );
  }

  switch (position) {
    case 'bottom':
      return (
        <div className="flex w-full flex-col gap-2">
          {stacked}
          {label}
        </div>
      );
    case 'left':
      return (
        <div className={rowCls}>
          {label}
          <div className={childCls}>{children}</div>
        </div>
      );
    case 'right':
      return (
        <div className={rowCls}>
          <div className={childCls}>{children}</div>
          {label}
        </div>
      );
    case 'top':
    default:
      return (
        <div className="flex w-full flex-col gap-2">
          {label}
          {stacked}
        </div>
      );
  }
}
