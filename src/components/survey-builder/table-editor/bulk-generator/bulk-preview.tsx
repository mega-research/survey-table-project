import { useMemo } from 'react';

import { AlertTriangle } from 'lucide-react';

import { Label } from '@/components/ui/label';

import type { BulkItemDef } from './types';

interface BulkPreviewProps {
  items: BulkItemDef[];
  existingCodes: string[];
  maxPreviewCount?: number;
}

export function BulkPreview({
  items,
  existingCodes,
  maxPreviewCount = 20,
}: BulkPreviewProps) {
  const existingSet = useMemo(() => new Set(existingCodes), [existingCodes]);
  const duplicates = useMemo(
    () => items.filter((item) => existingSet.has(item.code)),
    [items, existingSet],
  );

  const previewItems = items.slice(0, maxPreviewCount);
  const hasMore = items.length > maxPreviewCount;

  if (items.length === 0) {
    return (
      <p className="py-2 text-center text-xs text-gray-400">
        기본 라벨과 코드를 입력하면 미리보기가 표시됩니다.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">미리보기 (총 {items.length}개)</Label>
        {duplicates.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            코드 중복 {duplicates.length}건
          </span>
        )}
      </div>
      <div className="max-h-[200px] overflow-y-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr>
              <th className="w-10 border-b px-2 py-1 text-left font-medium text-gray-500">#</th>
              <th className="border-b px-2 py-1 text-left font-medium text-gray-500">라벨</th>
              <th className="border-b px-2 py-1 text-left font-medium text-gray-500">코드</th>
            </tr>
          </thead>
          <tbody>
            {previewItems.map((item, i) => {
              const isDuplicate = existingSet.has(item.code);
              return (
                <tr
                  key={i}
                  className={
                    isDuplicate ? 'bg-amber-50' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                  }
                >
                  <td className="px-2 py-0.5 text-gray-400">{i + 1}</td>
                  <td className="px-2 py-0.5">{item.label}</td>
                  <td
                    className={`px-2 py-0.5 font-mono ${isDuplicate ? 'text-amber-600' : 'text-gray-600'}`}
                  >
                    {item.code}
                    {isDuplicate && <AlertTriangle className="ml-1 inline h-3 w-3" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {hasMore && (
          <p className="border-t bg-gray-50 px-2 py-1 text-center text-[10px] text-gray-400">
            ... 외 {items.length - maxPreviewCount}개
          </p>
        )}
      </div>
    </div>
  );
}
