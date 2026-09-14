'use client';

import React from 'react';

import { CellText } from '@/components/survey/cell-text';
import { cn } from '@/lib/utils';
import type { TableCell } from '@/types/survey';

interface CellContentLayoutProps {
  content: string | undefined;
  /** 본문 서식본(토큰 치환까지 끝낸 것). 있으면 content 대신 그린다. resolveCellTextHtml 참조. */
  contentHtml?: string | undefined;
  position?: TableCell['textPosition'];
  children: React.ReactNode;
  /** 텍스트 라벨 div 에 추가로 적용할 className (예: 빌더 미리보기 톤 변경) */
  labelClassName?: string;
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
  labelClassName,
  bold = false,
  boldFirstLine = false,
  textColor,
  fillWidth = true,
  horizontalAlign,
}: CellContentLayoutProps) {
  const childCls = fillWidth ? 'min-w-0 flex-1' : 'min-w-0 shrink-0';
  const rowCls = cn(
    'flex w-full items-center gap-2',
    !fillWidth && ROW_JUSTIFY[horizontalAlign ?? 'left'],
  );
  const hasContent = (!!content && content.trim().length > 0) || !!contentHtml;
  if (!hasContent) {
    return <>{children}</>;
  }

  const label = (
    <div
      className={cn(DEFAULT_LABEL_CLASS, labelClassName, bold && 'font-bold')}
      style={textColor ? { color: textColor } : undefined}
    >
      <CellText text={content ?? ''} html={contentHtml} boldFirstLine={boldFirstLine} />
    </div>
  );

  switch (position) {
    case 'bottom':
      return (
        <div className="flex w-full flex-col gap-2">
          {children}
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
          {children}
        </div>
      );
  }
}
