'use client';

import React from 'react';

import type { TableCell } from '@/types/survey';
import { cn } from '@/lib/utils';

interface CellContentLayoutProps {
  content: string | undefined;
  position?: TableCell['textPosition'];
  children: React.ReactNode;
  /** 텍스트 라벨 div 에 추가로 적용할 className (예: 빌더 미리보기 톤 변경) */
  labelClassName?: string;
  /** 셀 콘텐츠 라벨만 굵게 표시한다. */
  bold?: boolean | undefined;
  /** 라벨 글자색. DEFAULT_LABEL_CLASS 의 text-gray-700 을 이겨야 하므로 inline style 로 얹는다. */
  textColor?: string | undefined;
}

const DEFAULT_LABEL_CLASS =
  'text-sm font-medium whitespace-pre-wrap [overflow-wrap:anywhere] text-gray-700 shrink-0';

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
  position = 'top',
  children,
  labelClassName,
  bold = false,
  textColor,
}: CellContentLayoutProps) {
  const hasContent = !!content && content.trim().length > 0;
  if (!hasContent) {
    return <>{children}</>;
  }

  const label = (
    <div
      className={cn(DEFAULT_LABEL_CLASS, labelClassName, bold && 'font-bold')}
      style={textColor ? { color: textColor } : undefined}
    >
      {content}
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
        <div className="flex w-full items-center gap-2">
          {label}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      );
    case 'right':
      return (
        <div className="flex w-full items-center gap-2">
          <div className="min-w-0 flex-1">{children}</div>
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
