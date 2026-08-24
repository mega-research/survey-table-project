'use client';

import type { RefObject } from 'react';

import type { VariableDef } from '@/components/ui/rich-text-editor/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberFormatFields } from '@/features/survey-builder/number-format-fields';
import { VariableButton } from '@/features/survey-builder/variable-button';
import { isPartialNumericInput, parseNumericInput } from '@/utils/numeric-input';
import type { Question } from '@/types/survey';

interface QuestionPlaceholderFieldsProps {
  question: Question;
  formData: Partial<Question>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Question>>>;
  /** prefill 템플릿 입력칸 — 변수 버튼이 커서 위치에 토큰을 꽂는다. */
  defaultTemplateRef: RefObject<HTMLInputElement | null>;
  /** 템플릿에 토큰이 있으면 응답자에게 readonly 로 보인다는 안내를 띄운다. */
  hasTokenPrefill: boolean;
  variableCatalog: VariableDef[];
}

/** 질문 편집의 '단답형 안내 문구·prefill' 구획. 상태는 부모가 그대로 들고 있다. */
export function QuestionPlaceholderFields({
  question,
  formData,
  setFormData,
  defaultTemplateRef,
  hasTokenPrefill,
  variableCatalog,
}: QuestionPlaceholderFieldsProps) {
  return (
    <>
  {question.type === 'text' && (
    <>
      <div>
        <Label htmlFor="placeholder">안내 문구 (Placeholder)</Label>
        <Input
          id="placeholder"
          value={formData.placeholder || ''}
          onChange={(e) => setFormData((prev) => ({ ...prev, placeholder: e.target.value }))}
          placeholder="예: 이름을 입력하세요"
          className="mt-2"
        />
        <p className="mt-1 text-xs text-gray-500">
          입력 필드에 표시될 안내 문구를 입력하세요
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="defaultValueTemplate">
          응답값 prefill
          <span className="ml-1 text-xs font-normal text-gray-500">(선택)</span>
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="defaultValueTemplate"
            ref={defaultTemplateRef}
            value={formData.defaultValueTemplate ?? ''}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                defaultValueTemplate: e.target.value || null,
              }))
            }
            placeholder="예: {{전시회명}}"
            className="flex-1"
          />
          {variableCatalog.length > 0 && (
            <VariableButton
              catalog={variableCatalog}
              inputRef={defaultTemplateRef}
              onChange={(v) =>
                setFormData((prev) => ({
                  ...prev,
                  defaultValueTemplate: v || null,
                }))
              }
            />
          )}
        </div>
        <p className="text-xs text-gray-500">
          변수 토큰 사용 시 응답자에게 readonly로 표시됩니다
        </p>
      </div>
      <div className="space-y-2">
        <div className="flex flex-col gap-3 rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="text-input-type-number"
              checked={formData.inputType === 'number'}
              onChange={(e) => {
                const checked = e.target.checked;
                setFormData((prev) => {
                  const next: Partial<Question> = {
                    ...prev,
                    inputType: checked ? 'number' : 'text',
                  };
                  if (!checked) {
                    delete next.emptyDefault;
                    delete next.numberFormat;
                  }
                  return next;
                });
              }}
              className="mt-0.5 h-4 w-4"
            />
            <label htmlFor="text-input-type-number" className="flex-1 cursor-pointer text-sm">
              <span className="font-medium">숫자만 입력</span>
              <p className="mt-0.5 text-xs text-gray-500">
                체크 시 응답자는 숫자만 입력할 수 있고, 분기 조건(expression)에서 비교 연산자
                (=, ≠, ≥, ≤, &gt;, &lt;) 를 사용할 수 있습니다.
              </p>
            </label>
          </div>

          {formData.inputType === 'number' && (
            <>
              <div className="ml-7 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  id="text-empty-default-enabled"
                  checked={formData.emptyDefault !== undefined}
                  disabled={hasTokenPrefill}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setFormData((prev) => {
                      const next: Partial<Question> = { ...prev };
                      if (checked) {
                        next.emptyDefault = prev.emptyDefault ?? 0;
                      } else {
                        delete next.emptyDefault;
                      }
                      return next;
                    });
                  }}
                  className="h-4 w-4"
                />
                <label htmlFor="text-empty-default-enabled" className="cursor-pointer">
                  응답자 입력란 초기값
                </label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={
                    formData.emptyDefault !== undefined ? String(formData.emptyDefault) : ''
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (isPartialNumericInput(v)) {
                      setFormData((prev) => ({
                        ...prev,
                        emptyDefault:
                          v === '' ? 0 : (parseNumericInput(v) ?? prev.emptyDefault ?? 0),
                      }));
                    }
                  }}
                  disabled={formData.emptyDefault === undefined || hasTokenPrefill}
                  className="h-8 w-24"
                  aria-label="초기값"
                />
                {hasTokenPrefill && (
                  <span className="text-xs text-gray-400">토큰 prefill 사용 중 (우선)</span>
                )}
              </div>
              <div className="ml-7">
                <NumberFormatFields
                  idPrefix="text-nf"
                  value={formData.numberFormat ?? undefined}
                  onChange={(nf) =>
                    setFormData((prev) => ({ ...prev, numberFormat: nf ?? null }))
                  }
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )}
    </>
  );
}
