'use client';

import { useEffect, useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { QuestionOption, SelectLevel } from '@/types/survey';

interface UserDefinedMultiLevelSelectProps {
  levels: SelectLevel[];
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  className?: string;
}

export function UserDefinedMultiLevelSelect({
  levels,
  values,
  onChange,
  disabled = false,
  className = '',
}: UserDefinedMultiLevelSelectProps) {
  const [currentValues, setCurrentValues] = useState<string[]>(values);

  // 부모가 매 렌더마다 새로운 [] 참조를 넘겨도(초기 빈 응답 상태) 진행 중 선택이
  // 초기화되지 않도록 내용이 실제로 달라졌을 때만 동기화한다.
  // [values] 참조 기반 비교는 [obj] vs [obj?.id] reset footgun을 그대로 재현하므로 직렬화 키로 비교.
  const valuesKey = JSON.stringify(values);
  useEffect(() => {
    setCurrentValues((prev) => (JSON.stringify(prev) === valuesKey ? prev : values));
    // valuesKey 가 동일하면 동일 내용이므로 동기화 스킵
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

    // 첫 번째 레벨은 모든 옵션 표시
    if (levelIndex === 0) {
      return level.options;
    }

    // 하위 레벨은 상위 선택들에 따라 필터링
    // 바로 이전 레벨의 선택값을 기준으로 필터링
    const parentValue = currentValues[levelIndex - 1];
    if (!parentValue) return [];

    // 상위 레벨들의 값을 모두 결합하여 현재까지의 경로를 만듦
    const currentPath = currentValues.slice(0, levelIndex).join('-');

    // 현재 경로와 정확히 일치하는 prefix를 가진 옵션들만 필터링
    return level.options.filter((option) => {
      // option의 value가 currentPath로 시작하는지 확인
      return option.value.startsWith(currentPath + '-') || option.value === currentPath;
    });
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
interface UserDefinedMultiLevelSelectPreviewProps {
  levels: SelectLevel[];
  className?: string;
}

export function UserDefinedMultiLevelSelectPreview({
  levels,
  className = '',
}: UserDefinedMultiLevelSelectPreviewProps) {
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
