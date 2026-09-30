'use client';

import type React from 'react';

import { cn } from '@/lib/utils';
import type { TableCell } from '@/types/survey';

import type { ChoiceGroupOriginalLine } from './utils/choice-group-original-line';

/**
 * 「행 단위 그룹 카드」의 원본 한 줄 — 잘라 낸 헤더 + 보기 셀 한 줄을 카드 폭에 등분해 그린다.
 *
 * 표 문항(mobile-row-group-cards)과 보기 소스 표(choice-table-response)가 같이 쓴다. 값 읽기·쓰기
 * 규칙은 두 경로가 달라 보기 칸 안의 컨트롤은 호출부가 `renderOption` 으로 넘긴다 — 여기는 배치만
 * 안다. 원본 표의 px 열 폭을 쓰지 않는 것은 휴대폰에서 가로 스크롤을 만들지 않기 위해서다.
 */
export function ChoiceGroupOriginalLineView({
  line,
  renderOption,
  testId,
}: {
  line: ChoiceGroupOriginalLine;
  renderOption: (cell: TableCell) => React.ReactNode;
  testId?: string | undefined;
}) {
  return (
    <div
      data-testid={testId}
      className="grid overflow-hidden rounded-lg border border-gray-200 bg-white"
      style={{ gridTemplateColumns: `repeat(${line.columnCount}, minmax(0, 1fr))` }}
    >
      {line.headers.map((header) => (
        <div
          key={header.id}
          className={cn(
            'flex items-center justify-center border-r border-b border-gray-200 bg-gray-50 px-0.5 py-1 text-center text-[11px] leading-tight break-keep text-gray-700 last:border-r-0',
            header.textBold && 'font-semibold',
          )}
          style={{ gridColumn: header.gridColumn, gridRow: header.gridRow }}
        >
          {header.label}
        </div>
      ))}
      {line.options.map(({ cell, gridColumn }) => (
        <div
          key={cell.id}
          data-cell-id={cell.id}
          className="border-r border-gray-200 last:border-r-0"
          style={{ gridColumn, gridRow: line.headerRowCount + 1 }}
        >
          {renderOption(cell)}
        </div>
      ))}
    </div>
  );
}

/**
 * 원본 한 줄의 보기 칸 하나 — 셀 글자(⓪·① 등 원본 표에 적힌 그대로) 아래에 컨트롤을 두고,
 * 칸 전체가 탭 영역이다. 고르면 칸을 칠한다(타일과 같은 파랑).
 */
export function OriginalLineOptionFrame({
  checked,
  disabled,
  htmlFor,
  control,
  children,
}: {
  checked: boolean;
  disabled?: boolean | undefined;
  htmlFor?: string | undefined;
  control: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        'flex h-full min-h-14 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 px-0.5 py-1.5 text-center text-[13px] leading-tight transition-colors',
        checked ? 'bg-blue-50 text-blue-900' : 'text-gray-800',
        disabled && 'cursor-default opacity-50',
      )}
    >
      {children}
      {control}
    </label>
  );
}
