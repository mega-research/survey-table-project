'use client';

import { useEffect, useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { RegionData, getRegionsByParent } from '@/data/regions';
import { SelectLevel } from '@/types/survey';

interface MultiLevelSelectProps {
  levels: SelectLevel[];
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  className?: string;
}

export function MultiLevelSelect({
  levels,
  values,
  onChange,
  disabled = false,
  className = '',
}: MultiLevelSelectProps) {
  const [currentValues, setCurrentValues] = useState<string[]>(values);

  useEffect(() => {
    setCurrentValues(values);
  }, [values]);

  const handleLevelChange = (levelIndex: number, selectedValue: string) => {
    const newValues = [...currentValues];

    // 선택된 레벨의 값을 업데이트하고, 하위 레벨들은 초기화
    newValues[levelIndex] = selectedValue;

    // 하위 레벨들을 초기화 (cascade effect)
    for (let i = levelIndex + 1; i < levels.length; i++) {
      newValues[i] = '';
    }

    setCurrentValues(newValues);
    onChange(newValues);
  };

  const getOptionsForLevel = (levelIndex: number): RegionData[] => {
    if (levelIndex === 0) {
      // 첫 번째 레벨은 시/도
      return getRegionsByParent();
    } else {
      // 상위 레벨의 선택된 값을 기반으로 하위 옵션들을 가져옴
      const parentValue = currentValues[levelIndex - 1];
      if (parentValue) {
        return getRegionsByParent(parentValue);
      }
      return [];
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {levels.map((level, index) => {
        const options = getOptionsForLevel(index);
        const isDisabled = disabled || (index > 0 && !currentValues[index - 1]);

        return (
          <div key={level.id} className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">{level.label}</label>
            <div className="relative">
              <select
                value={currentValues[index] || ''}
                onChange={(e) => handleLevelChange(index, e.target.value)}
                disabled={isDisabled}
                className={`w-full appearance-none rounded-lg border border-gray-200 bg-white p-3 transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none ${
                  isDisabled
                    ? 'cursor-not-allowed bg-gray-50 text-gray-400'
                    : 'hover:border-gray-300'
                }`}
              >
                <option value="">{level.placeholder || `${level.label} 선택`}</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className={`pointer-events-none absolute top-1/2 right-3 h-5 w-5 -translate-y-1/2 transform transition-colors ${
                  isDisabled ? 'text-gray-300' : 'text-gray-400'
                }`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 미리보기용 읽기 전용 컴포넌트
interface MultiLevelSelectPreviewProps {
  levels: SelectLevel[];
  className?: string;
}

export function MultiLevelSelectPreview({ levels, className = '' }: MultiLevelSelectPreviewProps) {
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
    </div>
  );
}
