'use client';

import { Scissors } from 'lucide-react';

export function PageBreakDivider({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  if (active) {
    return (
      <div className="group/divider relative my-2 flex items-center gap-2">
        <div className="h-px flex-1 bg-blue-300" />
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-100"
          title="페이지 나누기 해제"
        >
          <Scissors className="h-3 w-3" />
          페이지 나눔
        </button>
        <div className="h-px flex-1 bg-blue-300" />
      </div>
    );
  }
  return (
    <div className="flex h-6 items-center justify-center opacity-0 transition-opacity hover:opacity-100">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 rounded-full border border-dashed border-gray-300 bg-white px-3 py-0.5 text-xs text-gray-400 hover:border-blue-300 hover:text-blue-500"
        title="여기서 페이지 나누기"
      >
        <Scissors className="h-3 w-3" />
        여기서 페이지 나누기
      </button>
    </div>
  );
}
