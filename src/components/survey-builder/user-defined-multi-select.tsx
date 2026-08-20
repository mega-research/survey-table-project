'use client';

import { ChevronDown } from 'lucide-react';

import { SelectLevel } from '@/types/survey';

// 미리보기용 읽기 전용 컴포넌트
interface UserDefinedMultiSelectPreviewProps {
  levels: SelectLevel[];
  className?: string;
}

export function UserDefinedMultiSelectPreview({
  levels,
  className = '',
}: UserDefinedMultiSelectPreviewProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      {levels.map((level) => (
        <div key={level.id} className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">{level.label}</label>
          <div className="relative">
            <select
              disabled
              className="w-full cursor-not-allowed appearance-none rounded-lg border border-gray-200 bg-gray-50 p-3 text-gray-400"
            >
              <option>{level.placeholder || `${level.label} 선택`}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-5 w-5 -translate-y-1/2 transform text-gray-300" />
          </div>
        </div>
      ))}

      {(() => {
        const firstLevel = levels[0];
        if (!firstLevel?.options || firstLevel.options.length === 0) return null;
        return (
          <div className="mt-3 text-xs text-gray-500">
            {firstLevel.label}: {firstLevel.options.map((opt) => opt.label).join(', ')}
            {firstLevel.options.length > 3 && '...'}
          </div>
        );
      })()}
    </div>
  );
}
