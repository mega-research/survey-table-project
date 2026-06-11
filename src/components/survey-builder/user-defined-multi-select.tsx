'use client';

import { useEffect, useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { QuestionOption, SelectLevel } from '@/types/survey';

interface UserDefinedMultiSelectProps {
  levels: SelectLevel[];
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  className?: string;
}

export function UserDefinedMultiSelect({
  levels,
  values,
  onChange,
  disabled = false,
  className = '',
}: UserDefinedMultiSelectProps) {
  const [currentValues, setCurrentValues] = useState<string[]>(values);

  // 부모가 매 렌더마다 새로운 [] 참조를 넘겨도 진행 중 선택이 초기화되지 않도록
  // 내용이 실제로 달라졌을 때만 동기화한다([obj] vs [obj?.id] reset footgun 방지).
  const valuesKey = JSON.stringify(values);
  useEffect(() => {
    setCurrentValues((prev) => (JSON.stringify(prev) === valuesKey ? prev : values));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey]);

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

  const getOptionsForLevel = (levelIndex: number): QuestionOption[] => {
    const level = levels[levelIndex];
    if (!level) return [];

    if (levelIndex === 0) {
      // 첫 번째 레벨은 모든 옵션 표시
      return level.options || [];
    } else {
      // 상위 레벨의 선택된 값을 기반으로 하위 옵션들을 가져옴
      const parentValue = currentValues[levelIndex - 1];
      if (!parentValue) return [];

      // parentValue와 연관된 옵션들만 필터링
      // 이는 사용자가 설정한 옵션의 value 값으로 연동됩니다
      return (
        level.options?.filter((option) => {
          // 옵션의 value가 parent의 value로 시작하는지 확인
          // 예: parent가 "seoul"이면 "seoul-gangnam", "seoul-songpa" 등이 매칭
          return option.value.startsWith(parentValue + '-');
        }) || []
      );
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
                  <option key={option.id} value={option.value}>
                    {option.label}
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
