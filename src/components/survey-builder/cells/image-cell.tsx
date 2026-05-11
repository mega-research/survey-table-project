'use client';

import React, { useEffect, useState } from 'react';

import { Image } from 'lucide-react';


import type { InteractiveCellProps, PreviewCellProps } from './types';

/** 이미지 셀 (인터랙티브 / 미리보기 동일) */
export const ImageCell = React.memo(function ImageCell({
  cell,
}: InteractiveCellProps | PreviewCellProps) {
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
  }, [cell.imageUrl]);

  if (!cell.imageUrl) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <Image className="h-4 w-4" />
        <span className="text-sm">이미지 없음</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div key={cell.imageUrl}>
        {error ? (
          <div className="flex items-center gap-1 text-sm text-red-500">
            <Image className="h-4 w-4" />
            <span>이미지 오류</span>
          </div>
        ) : (
          <img
            src={cell.imageUrl}
            alt="셀 이미지"
            className="h-auto max-h-full w-full rounded object-contain"
            style={{ maxWidth: '100%', maxHeight: '100%' }}
            onError={() => setError(true)}
          />
        )}
      </div>
      {cell.content && (
        <div className="mt-2 text-left text-sm text-gray-700">{cell.content}</div>
      )}
    </div>
  );
});
