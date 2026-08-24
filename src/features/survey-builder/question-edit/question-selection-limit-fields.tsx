'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Question } from '@/types/survey';

interface QuestionSelectionLimitFieldsProps {
  question: Question;
  formData: Partial<Question>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Question>>>;
}

/** 질문 편집의 '선택 개수 제한' 구획 (복수선택 전용). 상태는 부모가 그대로 들고 있다. */
export function QuestionSelectionLimitFields({
  question,
  formData,
  setFormData,
}: QuestionSelectionLimitFieldsProps) {
  return (
    <>
  {question?.type === 'checkbox' && (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <Label className="text-base font-medium">선택 개수 제한</Label>
      <p className="text-sm text-gray-600">
        사용자가 선택할 수 있는 최소/최대 개수를 설정할 수 있습니다.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="min-selections" className="text-sm">
            최소 선택 개수
          </Label>
          <Input
            id="min-selections"
            type="number"
            min="1"
            max={formData.options?.length || 0}
            value={formData.minSelections || ''}
            onChange={(e) => {
              const value = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
              setFormData((prev) => {
                const next: Partial<Question> = { ...prev };
                if (value !== undefined) {
                  next.minSelections = value;
                } else {
                  delete next.minSelections;
                }
                return next;
              });
              // 최소값이 최대값보다 크면 최대값 조정
              if (
                value !== undefined &&
                formData.maxSelections !== undefined &&
                value > formData.maxSelections
              ) {
                setFormData((prev) => ({ ...prev, maxSelections: value }));
              }
            }}
            placeholder="제한 없음"
            className="w-full"
          />
          <p className="text-xs text-gray-500">
            {formData.options?.length || 0}개 옵션 중 최소 선택 개수
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="max-selections" className="text-sm">
            최대 선택 개수
          </Label>
          <Input
            id="max-selections"
            type="number"
            min={formData.minSelections ? formData.minSelections : 1}
            max={formData.options?.length || 0}
            value={formData.maxSelections || ''}
            onChange={(e) => {
              const value = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
              setFormData((prev) => {
                const next: Partial<Question> = { ...prev };
                if (value !== undefined) {
                  next.maxSelections = value;
                } else {
                  delete next.maxSelections;
                }
                return next;
              });
            }}
            placeholder="제한 없음"
            className="w-full"
          />
          <p className="text-xs text-gray-500">
            {formData.options?.length || 0}개 옵션 중 최대 선택 개수
          </p>
        </div>
      </div>

      {formData.minSelections !== undefined &&
        formData.maxSelections !== undefined &&
        formData.minSelections > formData.maxSelections && (
          <p className="text-sm text-red-500">
            최소 선택 개수는 최대 선택 개수보다 작거나 같아야 합니다.
          </p>
        )}

      {formData.minSelections !== undefined &&
        formData.minSelections > (formData.options?.length || 0) && (
          <p className="text-sm text-red-500">
            최소 선택 개수는 옵션 개수보다 작거나 같아야 합니다.
          </p>
        )}

      {formData.maxSelections !== undefined &&
        formData.maxSelections > (formData.options?.length || 0) && (
          <p className="text-sm text-red-500">
            최대 선택 개수는 옵션 개수보다 작거나 같아야 합니다.
          </p>
        )}
    </div>
  )}
    </>
  );
}
