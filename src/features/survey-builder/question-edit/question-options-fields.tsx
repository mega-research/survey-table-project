'use client';

import type { DragEndEvent } from '@dnd-kit/core';
import type { useSensors } from '@dnd-kit/core';

import type { OptionalOptionKey } from '@/features/survey-builder/question-option-helpers';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { OptionsLayoutSelector } from '@/features/survey-builder/options-layout-selector';
import {
  OTHER_OPTION_ID,
  createTextInputOption,
} from '@/features/survey-builder/question-option-helpers';

import { OptionLabelTextarea } from '@/features/survey-builder/option-label-textarea';
import { OptionPlaceholderEditor } from '@/features/survey-builder/option-placeholder-editor';
import { AnswerQuoteTextField } from '@/features/survey-builder/answer-quote-fields';
import { BranchRuleEditor } from '@/features/survey-builder/branch-rule-editor';
import { cn } from '@/lib/utils';
import { generateOptionCode } from '@/utils/option-code-generator';
import type { Question, QuestionOption } from '@/types/survey';

interface QuestionOptionsFieldsProps {
  question: Question;
  questionId: string;
  questions: Question[];
  formData: Partial<Question>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Question>>>;
  validationErrors: Record<string, string>;
  setValidationErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  showBranchSettings: boolean;
  setShowBranchSettings: React.Dispatch<React.SetStateAction<boolean>>;
  answerQuoteEnabled: boolean;
  needsOptions: boolean;
  sensors: ReturnType<typeof useSensors>;
  optionIds: string[];
  conflictOptionIds: Set<string>;
  commitOptionCodeAt: (index: number, code: string) => void;
  handleOptionDragEnd: (event: DragEndEvent) => void;
  addOption: () => void;
  updateOption: (
    optionId: string,
    updates: Partial<QuestionOption>,
    clear?: OptionalOptionKey[],
  ) => void;
  removeOption: (optionId: string) => void;
}

/** 질문 편집의 '옵션 설정' 구획 (단일·복수·드롭다운). 상태는 부모가 그대로 들고 있다. */
export function QuestionOptionsFields({
  question,
  questionId,
  questions,
  formData,
  setFormData,
  validationErrors,
  setValidationErrors,
  showBranchSettings,
  setShowBranchSettings,
  answerQuoteEnabled,
  needsOptions,
  sensors,
  optionIds,
  conflictOptionIds,
  commitOptionCodeAt,
  handleOptionDragEnd,
  addOption,
  updateOption,
  removeOption,
}: QuestionOptionsFieldsProps) {
  return (
    <>
  {needsOptions && (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>
          선택지 <span className="text-red-500">*</span>
        </Label>
        <div className="flex items-center space-x-4">
          {/* 조건부 분기 토글 */}
          <div className="flex items-center space-x-2">
            <Switch
              id="show-branch-settings"
              checked={showBranchSettings}
              onCheckedChange={setShowBranchSettings}
              className="scale-75"
            />
            <Label htmlFor="show-branch-settings" className="text-xs text-gray-600">
              조건부 분기
            </Label>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              addOption();
              if (validationErrors['options']) {
                setValidationErrors((prev) => ({ ...prev, options: '' }));
              }
            }}
            className="flex items-center space-x-1"
          >
            <Plus className="h-4 w-4" />
            <span>선택지</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const newOption = createTextInputOption(formData.options ?? []);
              setFormData((prev) => ({
                ...prev,
                options: [...(prev.options ?? []), newOption],
              }));
              if (validationErrors['options']) {
                setValidationErrors((prev) => ({ ...prev, options: '' }));
              }
            }}
            className="flex items-center space-x-1"
          >
            <Plus className="h-4 w-4" />
            <span>주관식 선택지</span>
          </Button>
        </div>
      </div>
      {validationErrors['options'] && (
        <p className="text-sm text-red-500">{validationErrors['options']}</p>
      )}

      {/* 응답 페이지에서 옵션 배치 방식 (select 는 드롭다운이라 의미 없어 숨김) */}
      {question.type !== 'select' && (
        <OptionsLayoutSelector
          value={formData.optionsColumns}
          onChange={(next) => setFormData((prev) => ({ ...prev, optionsColumns: next }))}
          align={formData.optionsAlign}
          onAlignChange={(next) => setFormData((prev) => ({ ...prev, optionsAlign: next }))}
          mobileValue={formData.mobileOptionsColumns}
          onMobileChange={(next) =>
            setFormData((prev) => ({ ...prev, mobileOptionsColumns: next }))
          }
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleOptionDragEnd}
      >
        <SortableContext items={optionIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {formData.options?.map((option, index) => (
              <SortableOptionItem
                key={option.id}
                option={option}
                index={index}
                totalCount={formData.options?.length ?? 0}
                updateOption={updateOption}
                removeOption={removeOption}
                onCommitCode={commitOptionCodeAt}
                hasConflict={conflictOptionIds.has(option.id)}
                showBranchSettings={showBranchSettings}
                answerQuoteEnabled={answerQuoteEnabled}
                questions={questions}
                questionId={questionId}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {(formData.options?.length || 0) === 0 && (
        <div className="py-8 text-center text-gray-500">
          <p className="mb-2">아직 선택지가 없습니다.</p>
          <Button type="button" variant="outline" onClick={addOption}>
            첫 번째 선택지 추가
          </Button>
        </div>
      )}
    </div>
  )}
    </>
  );
}

interface SortableOptionItemProps {
  option: QuestionOption;
  index: number;
  totalCount: number;
  updateOption: (
    optionId: string,
    updates: Partial<QuestionOption>,
    clear?: OptionalOptionKey[],
  ) => void;
  removeOption: (optionId: string) => void;
  /** optionCode Input의 blur 커밋 — value 동기화를 시도하고 중복 경고 state 를 갱신한다. */
  onCommitCode: (index: number, code: string) => void;
  /** blur 커밋 결과 이 옵션의 응답값이 다른 옵션과 중복되는지 여부 (경고 표시용). */
  hasConflict: boolean;
  showBranchSettings: boolean;
  /** 질문 단위 응답 인용 토글 — 켜졌을 때만 옵션별 인용 문구 입력칸을 노출한다. */
  answerQuoteEnabled: boolean;
  questions: Question[];
  questionId: string;
}

function SortableOptionItem({
  option,
  index,
  totalCount,
  updateOption,
  removeOption,
  onCommitCode,
  hasConflict,
  showBranchSettings,
  answerQuoteEnabled,
  questions,
  questionId,
}: SortableOptionItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: option.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-gray-200 bg-white transition-shadow hover:shadow-sm"
    >
      <div className="flex items-center space-x-2 px-3 py-1.5">
        <div
          className={isDragging ? 'cursor-grabbing' : 'cursor-grab'}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4 text-gray-400" />
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2">
            <OptionLabelTextarea
              value={option.label}
              onChange={(label) => updateOption(option.id, { label })}
              placeholder={`선택지 ${index + 1}`}
              className="flex-1 border-none bg-transparent px-0 py-1 focus-visible:border focus-visible:border-blue-200 focus-visible:bg-white focus-visible:ring-0"
            />
            {option.allowTextInput && (
              <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                주관식
              </span>
            )}
          </div>
          {option.id === OTHER_OPTION_ID && (
            <p className="mt-0.5 px-0 text-xs text-blue-600">기타 선택지 (수정 가능)</p>
          )}
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[10px] text-gray-400">응답값</span>
          <Input
            inputMode="numeric"
            value={option.spssNumericCode ?? ''}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '');
              if (v) {
                updateOption(option.id, {
                  spssNumericCode: parseInt(v, 10),
                } as Partial<QuestionOption>);
              } else {
                // 입력을 비우면 키 자체를 제거해야 stale 값으로 되돌아가지 않는다.
                updateOption(option.id, {}, ['spssNumericCode']);
              }
            }}
            className="h-8 w-14 text-center text-xs placeholder:text-gray-300"
            placeholder={String(index + 1)}
          />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[10px] text-gray-400">변수번호</span>
          <Input
            aria-label="변수번호"
            value={option.optionCode ?? generateOptionCode(index, totalCount)}
            onChange={(e) =>
              updateOption(option.id, {
                optionCode: e.target.value,
                isCustomOptionCode: true,
              } as Partial<QuestionOption>)
            }
            onBlur={() => onCommitCode(index, option.optionCode ?? '')}
            aria-invalid={hasConflict}
            className={cn(
              'h-8 w-16 text-center text-xs',
              hasConflict && 'border-red-500 focus-visible:ring-red-500',
            )}
          />
          {hasConflict && (
            <p className="w-24 text-center text-[10px] text-red-500">
              응답값이 다른 옵션과 중복됩니다
            </p>
          )}
        </div>
        {option.isCustomOptionCode && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => updateOption(option.id, { isCustomOptionCode: false }, ['optionCode'])}
            className="px-1 text-xs text-gray-400 hover:text-blue-500"
            title="자동 코드로 복원"
          >
            자동
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => removeOption(option.id)}
          className="text-red-500 hover:bg-red-50 hover:text-red-600"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {option.allowTextInput && (
        <OptionPlaceholderEditor
          value={option.textInputPlaceholder}
          onChange={(next) =>
            updateOption(option.id, {
              textInputPlaceholder: next,
            } as Partial<QuestionOption>)
          }
        />
      )}

      {answerQuoteEnabled && (
        <div className="px-3 pb-3">
          <AnswerQuoteTextField
            id={`answer-quote-option-${option.id}`}
            value={option.answerQuoteText}
            onChange={(answerQuoteText) => updateOption(option.id, { answerQuoteText })}
            showInputTokenHint={option.allowTextInput === true}
          />
        </div>
      )}

      {showBranchSettings && (
        <div className="px-3 pb-3">
          <BranchRuleEditor
            branchRule={option.branchRule}
            allQuestions={questions}
            currentQuestionId={questionId || ''}
            onChange={(branchRule) =>
              updateOption(option.id, {
                ...(branchRule !== undefined ? { branchRule } : {}),
              } as Partial<QuestionOption>)
            }
          />
        </div>
      )}
    </div>
  );
}
