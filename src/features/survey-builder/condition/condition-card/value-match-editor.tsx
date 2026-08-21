'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QuestionCondition, QuestionOption } from '@/types/survey';

import { UpdateConditionFn } from './types';

interface ValueMatchEditorProps {
  condition: QuestionCondition;
  updateCondition: UpdateConditionFn;
  // value-match 옵션 소스 (테이블-소스 choice 포함). ConditionCard 에서 resolveChoiceOptions 로 파생해 내려준다.
  valueMatchOptions: QuestionOption[];
}

/**
 * value-match 조건의 본문 (옵션 체크박스 picker 또는 직접 입력).
 * valueMatchOptions 길이로 분기하는 ConditionCard 인라인 블록을 1:1 추출.
 */
export function ValueMatchEditor({
  condition,
  updateCondition,
  valueMatchOptions,
}: ValueMatchEditorProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={`values-${condition.id}`}>필요한 값들</Label>

      {/* 참조 질문의 옵션이 있으면 체크박스로 표시 (테이블-소스 choice 포함) */}
      {valueMatchOptions.length > 0 ? (
        <div className="space-y-2">
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-gray-200 p-3">
            {valueMatchOptions.map((option) => {
              const isSelected = (condition.requiredValues || []).includes(
                option.value,
              );
              return (
                <div key={option.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`cond-opt-${condition.id}-${option.id}`}
                    checked={isSelected}
                    onChange={(e) => {
                      const currentValues = condition.requiredValues || [];
                      const newValues = e.target.checked
                        ? [...currentValues, option.value]
                        : currentValues.filter((v) => v !== option.value);
                      updateCondition(condition.id, {
                        requiredValues: newValues.length > 0 ? newValues : [],
                      });
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label
                    htmlFor={`cond-opt-${condition.id}-${option.id}`}
                    className="flex-1 cursor-pointer text-sm"
                  >
                    {option.label}
                    <span className="ml-2 text-xs text-gray-400">
                      (값: {option.value})
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
          {(condition.requiredValues || []).length === 0 && (
            <p className="text-xs text-red-600">
              최소 1개 이상의 옵션을 선택해주세요
            </p>
          )}
        </div>
      ) : (
        // 옵션이 없거나 텍스트 타입인 경우 직접 입력
        <>
          <Input
            id={`values-${condition.id}`}
            value={(condition.requiredValues || []).join(', ')}
            onChange={(e) => {
              const values = e.target.value
                .split(',')
                .map((v) => v.trim())
                .filter((v) => v);
              updateCondition(condition.id, { requiredValues: values });
            }}
            placeholder="예: ②, 2, 평상시에 끊기기도 한다"
          />
          <p className="text-xs text-gray-500">
            참조 질문의 응답 값과 일치하는 값들을 쉼표로 구분하여 입력하세요
          </p>
        </>
      )}

      <p className="text-xs text-blue-600">
        💡 참조 질문의 응답이 선택한 값들 중 하나와 일치하면 조건 만족
      </p>
    </div>
  );
}
