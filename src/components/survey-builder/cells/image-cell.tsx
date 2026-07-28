'use client';

import React, { useState } from 'react';

import { Image as ImageIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { getCellTextClassName } from '@/utils/cell-style';

import type { InteractiveCellProps, PreviewCellProps } from './types';

/** 이미지 셀 (인터랙티브 / 미리보기 동일) */
export const ImageCell = React.memo(function ImageCell({
  cell,
}: InteractiveCellProps | PreviewCellProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  if (!cell.imageUrl) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <ImageIcon className="h-4 w-4" />
        <span className="text-sm">이미지 없음</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div key={cell.imageUrl}>
        {failedImageUrl === cell.imageUrl ? (
          <div className="flex items-center gap-1 text-sm text-red-500">
            <ImageIcon className="h-4 w-4" />
            <span>이미지 오류</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- R2 사용자 업로드 이미지(크기 미상), next/image 최적화 비용 회피
          <img
            src={cell.imageUrl}
            alt="셀 이미지"
            className="h-auto max-h-full w-full rounded object-contain"
            style={{ maxWidth: '100%', maxHeight: '100%' }}
            onError={() => setFailedImageUrl(cell.imageUrl ?? null)}
          />
        )}
      </div>
      {cell.content && (
        <div className={cn('mt-2 text-left text-sm text-gray-700', getCellTextClassName(cell))}>
          {cell.content}
        </div>
      )}
    </div>
  );
});
