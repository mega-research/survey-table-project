'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
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
  // 최대 선택 개수를 따라갈 후보 — 숫자형 단답 문항(자기 자신 제외)
  const allQuestions = useSurveyBuilderStore((s) => s.currentSurvey.questions);
  const numericQuestions = (allQuestions ?? []).filter(
    (q) => q.id !== question?.id && q.type === 'text' && q.inputType === 'number',
  );
  const source = formData.maxSelectionsSource ?? null;
  const sourceMissing =
    source !== null &&
    source.questionId !== '' &&
    !numericQuestions.some((q) => q.id === source.questionId);

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

      <div className="space-y-3 border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="max-selections-source-toggle" className="text-sm">
              최대 선택 개수를 다른 문항의 응답값으로
            </Label>
            <p className="text-xs text-gray-500">
              앞 문항에 적은 숫자만큼만 고를 수 있게 합니다. (예: 담당 팀 수가 2면 최대 2개)
            </p>
          </div>
          <Switch
            id="max-selections-source-toggle"
            checked={source !== null}
            onCheckedChange={(checked) =>
              setFormData((prev) => ({
                ...prev,
                maxSelectionsSource: checked ? { questionId: '' } : null,
              }))
            }
          />
        </div>

        {source !== null && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="max-selections-source-question" className="text-sm">
                참조 문항
              </Label>
              <Select
                value={source.questionId}
                onValueChange={(questionId) =>
                  setFormData((prev) => ({
                    ...prev,
                    maxSelectionsSource: { ...(prev.maxSelectionsSource ?? {}), questionId },
                  }))
                }
              >
                <SelectTrigger id="max-selections-source-question" className="w-full">
                  <SelectValue placeholder="숫자 문항 선택" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {numericQuestions.length === 0 && (
                    <div className="p-2 text-xs text-slate-500">
                      숫자 입력 단답형 문항이 없습니다
                    </div>
                  )}
                  {numericQuestions.map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.questionCode ? `${q.questionCode}. ` : ''}
                      {q.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">단답형 숫자 입력 문항만 고를 수 있습니다.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-selections-unlimited-from" className="text-sm">
                이 값 이상이면 제한 없음
              </Label>
              <Input
                id="max-selections-unlimited-from"
                type="number"
                min="2"
                value={source.unlimitedFrom ?? ''}
                onChange={(e) => {
                  const value = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                  setFormData((prev) => {
                    const { unlimitedFrom: _prevFrom, ...rest } = prev.maxSelectionsSource ?? {
                      questionId: '',
                    };
                    return {
                      ...prev,
                      maxSelectionsSource:
                        value !== undefined && Number.isFinite(value) && value > 0
                          ? { ...rest, unlimitedFrom: value }
                          : rest,
                    };
                  });
                }}
                placeholder="항상 제한"
                className="w-full"
              />
              <p className="text-xs text-gray-500">비우면 응답값이 항상 상한입니다.</p>
            </div>
          </div>
        )}

        {source !== null && source.questionId === '' && (
          <p className="text-sm text-orange-600">
            참조 문항을 고르지 않으면 위의 고정 최대 선택 개수만 적용됩니다.
          </p>
        )}
        {sourceMissing && (
          <p className="text-sm text-red-500">
            참조 문항이 삭제되었거나 숫자 입력 문항이 아닙니다. 다시 선택해 주세요.
          </p>
        )}
        {source !== null && (
          <p className="text-xs text-gray-500">
            참조 문항이 비어 있으면 위의 고정 최대 선택 개수(없으면 제한 없음)가 적용됩니다. 참조
            문항을 줄여 이미 고른 수가 넘치면 선택을 지우지 않고 「다음」에서 안내합니다.
          </p>
        )}
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
