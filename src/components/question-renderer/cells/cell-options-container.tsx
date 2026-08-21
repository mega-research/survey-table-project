'use client';

import React from 'react';

import { cn } from '@/lib/utils';
import type { TableCell } from '@/types/survey';
import { getOptionsLayout } from '@/components/question-renderer/utils/options-layout';

import { CellContentLayout } from './cell-content-layout';

interface CellOptionsContainerProps {
  cell: TableCell;
  /**
   * 셀 라벨 오버라이드. 인터랙티브 셀이 토큰 치환을 끝낸 문구를 넘긴다.
   * 미지정 시 cell.content 원문 — 이미 치환된 셀을 넘겨받는 PreviewCell 경로가
   * 두 번째 패스를 타지 않도록 opt-in 으로 둔다(mobile-original-row-table.tsx 참조).
   */
  content?: string | undefined;
  /** 옵션 리스트 — 그리드 컨테이너 안에 렌더됨 */
  children: React.ReactNode;
  /** 옵션 그리드 밖에 렌더할 추가 요소 (예: 선택 개수 제한 안내) */
  footer?: React.ReactNode;
}

/**
 * 테이블 셀(radio/checkbox/ranking 등) 옵션 리스트 공용 래퍼.
 * - 셀 콘텐츠(cell.content) 라벨을 cell.textPosition(top/bottom/left/right)에 따라 배치
 * - cell.optionsColumns 에 따라 세로/가로/N열 그리드 컨테이너 제공
 * - 하위 options.map(...) 결과물만 children 으로 전달하면 됨
 * - footer 는 그리드 밖(세로 스택 끝)에 렌더 → 선택 개수 제한 같은 메타 UI 배치용
 */
export function CellOptionsContainer({
  cell,
  content,
  children,
  footer,
}: CellOptionsContainerProps) {
  const layout = getOptionsLayout(cell.optionsColumns);
  // N열 그리드는 셀 폭을 N등분해야 하므로 shrink-to-fit 되는 flex item 래퍼를 셀 폭까지 넓힌다.
  // 세로/가로 배치는 콘텐츠 폭 유지가 맞으므로(셀 horizontalAlign 으로 블록 정렬) 그리드 한정.
  // footer(기타 상세 입력란 등)가 있으면 함께 넓힌다 — 콘텐츠 폭 래퍼 안에서는 입력 행이
  // 옵션 폭 기준으로 잡혀 셀 밖으로 넘칠 수 있다 (행 내부는 라벨 칩 truncate 로 수납).
  const isGrid = (cell.optionsColumns ?? 1) >= 2;

  return (
    <CellContentLayout
      content={content ?? cell.content}
      position={cell.textPosition}
      bold={cell.textBold}
      textColor={cell.textColor}
    >
      <div className={cn('space-y-2', (isGrid || footer != null) && 'w-full min-w-0')}>
        <div className={layout.className} style={layout.style}>
          {children}
        </div>
        {footer}
      </div>
    </CellContentLayout>
  );
}
