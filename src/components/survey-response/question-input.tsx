'use client';

import { useEffect, useMemo, useState } from 'react';

import { InteractiveTableResponse } from '@/components/survey-builder/interactive-table-response';
import { NoticeRenderer } from '@/components/survey-builder/notice-renderer';
import { UserDefinedMultiLevelSelect } from '@/components/survey-builder/user-defined-multi-level-select';
import { Input } from '@/components/ui/input';
import { useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { isPartialNumericInput } from '@/utils/numeric-input';
import { Question, QuestionOption, RankingAnswer } from '@/types/survey';
import {
  applyMobileOptionsGridOverride,
  computeMobileOptionsColumnsByLabels,
} from '@/utils/mobile-card-options';
import { isChoiceTableSource } from '@/utils/choice-source';
import { getOptionsLayout } from '@/utils/options-layout';

import { useMobileView } from '@/hooks/use-media-query';

import { ChoiceTableResponse } from './choice-table-response';
import { OptionTextInput } from './option-text-input';
import { RankingQuestion } from './ranking-question';

interface QuestionInputProps {
  question: Question;
  value: unknown;
  onChange: (value: unknown) => void;
  allResponses?: Record<string, unknown>;
  allQuestions?: Question[];
}

// 타입 정의
/**
 * @deprecated allowTextInput 기반 인라인 입력으로 전환 중. Phase 7 cleanup 에서 제거 예정.
 * checkbox/select 에서 하위 호환을 위해 임시 유지.
 */
export type OtherChoiceValue = {
  selectedValue: string;
  otherValue?: string;
  hasOther: true;
};

/** @deprecated OtherChoiceValue 와 함께 제거 예정. */
export function isOtherChoiceValue(value: unknown): value is OtherChoiceValue {
  if (!value || typeof value !== 'object') return false;
  return (
    'selectedValue' in value &&
    typeof (value as { selectedValue: unknown }).selectedValue === 'string' &&
    'hasOther' in value &&
    (value as { hasOther: unknown }).hasOther === true
  );
}

export type SingleChoiceResponse = string | null | OtherChoiceValue;
export type MultiChoiceResponse = Array<string | OtherChoiceValue>;

// 질문 유형별 입력 라우터
export function QuestionInput({
  question,
  value,
  onChange,
  allResponses,
  allQuestions,
}: QuestionInputProps) {
  const attrs = useContactAttrs();

  // choice_opt 테이블 소스 라디오/체크박스는 hooks 진입 전에 디스패처에서 분기
  if ((question.type === 'radio' || question.type === 'checkbox') && isChoiceTableSource(question)) {
    return (
      <ChoiceTableResponse
        question={question}
        value={value}
        onChange={onChange as (v: string | string[] | null) => void}
      />
    );
  }

  switch (question.type) {
    case 'notice': {
      const noticeVal = value && typeof value === 'object' && 'agreed' in (value as Record<string, unknown>)
        ? (value as { agreed: boolean; agreedAt?: string })
        : { agreed: typeof value === 'boolean' ? value : false };
      return (
        <NoticeRenderer
          content={substituteTokens(question.noticeContent || '', attrs)}
          requiresAcknowledgment={question.requiresAcknowledgment}
          value={noticeVal.agreed}
          onChange={(v) =>
            onChange(v ? { agreed: true, agreedAt: new Date().toISOString() } : { agreed: false })
          }
          isTestMode={false}
        />
      );
    }

    case 'text':
      return <TextResponseInput question={question} value={value} onChange={onChange} attrs={attrs} />;

    case 'textarea':
      return (
        <textarea
          className="w-full resize-none rounded-lg border border-gray-300 p-3 text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
          rows={4}
          placeholder="답변을 입력하세요..."
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'radio':
      return (
        <RadioQuestion
          question={question}
          value={(value ?? null) as SingleChoiceResponse}
          onChange={onChange}
        />
      );

    case 'checkbox':
      return (
        <CheckboxQuestion
          question={question}
          value={value as MultiChoiceResponse | unknown}
          onChange={onChange}
        />
      );

    case 'select':
      return (
        <SelectQuestion
          question={question}
          value={(value ?? '') as SingleChoiceResponse}
          onChange={onChange}
        />
      );

    case 'multiselect':
      return question.selectLevels ? (
        <UserDefinedMultiLevelSelect
          levels={question.selectLevels}
          values={Array.isArray(value) ? (value as string[]) : []}
          onChange={(v) => onChange(v)}
          className="w-full"
        />
      ) : (
        <div className="py-4 text-center text-gray-500">다단계 선택이 구성되지 않았습니다.</div>
      );

    case 'ranking':
      return (
        <RankingQuestion
          question={question}
          value={value}
          onChange={(v: RankingAnswer[]) => onChange(v)}
        />
      );

    case 'table':
      return question.tableColumns && question.tableRowsData ? (
        <InteractiveTableResponse
          questionId={question.id}
          tableTitle={question.tableTitle}
          columns={question.tableColumns}
          rows={question.tableRowsData}
          tableHeaderGrid={question.tableHeaderGrid}
          value={
            typeof value === 'object' && value !== null
              ? (value as Record<string, unknown>)
              : undefined
          }
          onChange={onChange as (v: Record<string, unknown>) => void}
          isTestMode={false}
          className="border-0 shadow-none"
          allResponses={allResponses}
          allQuestions={allQuestions}
          dynamicRowConfigs={question.dynamicRowConfigs}
          hideColumnLabels={question.hideColumnLabels}
        />
      ) : (
        <div className="py-4 text-center text-gray-500">테이블이 구성되지 않았습니다.</div>
      );

    default:
      return <div className="py-4 text-center text-gray-500">지원하지 않는 질문 유형입니다.</div>;
  }
}

// 단일선택(Radio) 질문 컴포넌트
function RadioQuestion({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: SingleChoiceResponse;
  onChange: (value: SingleChoiceResponse) => void;
}) {
  const isSelected = (optionValue: string) => {
    if (isOtherChoiceValue(value)) {
      return value.selectedValue === optionValue;
    }
    return value === optionValue;
  };

  const handleOptionChange = (optionValue: string) => {
    if (isSelected(optionValue)) {
      onChange(null);
      return;
    }
    onChange(optionValue);
  };

  const isMobileView = useMobileView();
  const effectiveColumns = isMobileView
    ? computeMobileOptionsColumnsByLabels(question.options?.map((o) => o.label) ?? [])
    : question.optionsColumns;
  const layout = getOptionsLayout(effectiveColumns);
  const layoutStyle = isMobileView
    ? applyMobileOptionsGridOverride(layout.style, effectiveColumns)
    : layout.style;

  return (
    <div className={layout.className} style={layoutStyle}>
      {question.options?.map((option: QuestionOption) => (
        <div key={option.id} className="space-y-2">
          <div className="flex items-center space-x-3">
            <input
              type="radio"
              id={`${question.id}-${option.id}`}
              name={question.id}
              value={option.value}
              checked={isSelected(option.value)}
              onChange={() => handleOptionChange(option.value)}
              onClick={() => handleOptionChange(option.value)}
              className="h-4 w-4 cursor-pointer border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label
              htmlFor={`${question.id}-${option.id}`}
              onClick={(e) => {
                e.preventDefault();
                handleOptionChange(option.value);
              }}
              className="flex-1 cursor-pointer text-base text-gray-700"
            >
              {option.label}
            </label>
          </div>
          {option.allowTextInput && isSelected(option.value) && (
            <div className="pl-7">
              <OptionTextInput questionId={question.id} option={option} className="w-full" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// 다중선택(Checkbox) 질문 컴포넌트
function CheckboxQuestion({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: unknown;
  onChange: (value: MultiChoiceResponse) => void;
}) {
  const currentValues = useMemo<MultiChoiceResponse>(
    () => (Array.isArray(value) ? (value as MultiChoiceResponse) : []),
    [value],
  );

  const handleOptionChange = (optionValue: string, isChecked: boolean) => {
    let newValues = [...currentValues];

    if (isChecked) {
      const maxSelections = question.maxSelections;
      if (maxSelections !== undefined && maxSelections > 0) {
        const currentCount = newValues.length;
        if (currentCount >= maxSelections) {
          return;
        }
      }

      newValues.push(optionValue);
    } else {
      newValues = newValues.filter((val) => {
        if (isOtherChoiceValue(val)) {
          return val.selectedValue !== optionValue;
        }
        return val !== optionValue;
      });
    }

    onChange(newValues);
  };

  const isChecked = (optionValue: string) => {
    return currentValues.some((val) => {
      if (isOtherChoiceValue(val)) {
        return val.selectedValue === optionValue;
      }
      return val === optionValue;
    });
  };

  const currentCount = currentValues.length;
  const maxSelections = question.maxSelections;
  const minSelections = question.minSelections;
  const isMaxReached =
    maxSelections !== undefined && maxSelections > 0 && currentCount >= maxSelections;
  const isMinNotMet =
    minSelections !== undefined && minSelections > 0 && currentCount < minSelections;

  const canSelect = (optionValue: string) => {
    if (isChecked(optionValue)) return true;
    if (isMaxReached) return false;
    return true;
  };

  const isMobileView = useMobileView();
  const effectiveColumns = isMobileView
    ? computeMobileOptionsColumnsByLabels(question.options?.map((o) => o.label) ?? [])
    : question.optionsColumns;
  const layout = getOptionsLayout(effectiveColumns);
  const layoutStyle = isMobileView
    ? applyMobileOptionsGridOverride(layout.style, effectiveColumns)
    : layout.style;

  return (
    <div className={layout.className} style={layoutStyle}>
      {question.options?.map((option: QuestionOption) => {
        const checked = isChecked(option.value);
        const disabled = !canSelect(option.value);

        return (
          <div key={option.id} className="space-y-2">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id={`${question.id}-${option.id}`}
                checked={checked}
                disabled={disabled}
                onChange={(e) => handleOptionChange(option.value, e.target.checked)}
                className={`h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 ${
                  disabled ? 'cursor-not-allowed opacity-50' : ''
                }`}
              />
              <label
                htmlFor={`${question.id}-${option.id}`}
                className={`flex-1 text-base text-gray-700 ${
                  disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                }`}
              >
                {option.label}
              </label>
            </div>
            {option.allowTextInput && checked && (
              <div className="pl-7">
                <OptionTextInput questionId={question.id} option={option} className="w-full" />
              </div>
            )}
          </div>
        );
      })}

      {(maxSelections !== undefined || minSelections !== undefined) && (
        <div className="border-t border-gray-200 pt-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">
              {maxSelections !== undefined && maxSelections > 0
                ? `${currentCount}/${maxSelections}개 선택됨`
                : `${currentCount}개 선택됨`}
            </span>
            {isMinNotMet && (
              <span className="text-orange-600">최소 {minSelections}개 이상 선택해주세요</span>
            )}
            {isMaxReached && <span className="text-blue-600">최대 선택 개수에 도달했습니다</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// 드롭다운(Select) 질문 컴포넌트
function SelectQuestion({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: SingleChoiceResponse;
  onChange: (value: SingleChoiceResponse) => void;
}) {
  // OtherChoiceValue fallback: snapshot 호환 (Phase 7 cleanup 까지 유지)
  const [legacyOtherInput, setLegacyOtherInput] = useState('');
  const [selectedValue, setSelectedValue] = useState<string>('');

  useEffect(() => {
    if (isOtherChoiceValue(value)) {
      setSelectedValue(value.selectedValue);
      setLegacyOtherInput(value.otherValue || '');
    } else {
      setSelectedValue(typeof value === 'string' ? value : '');
      setLegacyOtherInput('');
    }
  }, [value]);

  const selectedOption = question.options?.find((opt) => opt.value === selectedValue);

  const handleSelectChange = (newValue: string) => {
    setSelectedValue(newValue);
    // 선택해제
    if (!newValue) {
      onChange('');
      return;
    }
    const opt = question.options?.find((o) => o.value === newValue);
    // other-option 매직 ID — OtherChoiceValue 호환 fallback (@deprecated)
    if (opt?.id === 'other-option') {
      onChange({
        selectedValue: newValue,
        otherValue: legacyOtherInput,
        hasOther: true,
      });
    } else {
      onChange(newValue);
    }
  };

  // OtherChoiceValue 경로 (other-option 전용, deprecated)
  const handleLegacyOtherInputChange = (inputValue: string) => {
    setLegacyOtherInput(inputValue);
    if (selectedValue) {
      const opt = question.options?.find((o) => o.value === selectedValue);
      if (opt?.id === 'other-option') {
        onChange({
          selectedValue,
          otherValue: inputValue,
          hasOther: true,
        });
      }
    }
  };

  const showLegacyOtherInput = selectedOption?.id === 'other-option';
  const showAllowTextInput = !showLegacyOtherInput && (selectedOption?.allowTextInput === true);

  return (
    <div className="space-y-3">
      <select
        value={selectedValue}
        onChange={(e) => handleSelectChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 p-3 text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
      >
        <option value="">선택하세요...</option>
        {question.options?.map((option: QuestionOption) => (
          <option key={option.id} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {/* allowTextInput 옵션 선택 시 인라인 텍스트 입력 */}
      {showAllowTextInput && selectedOption && (
        <OptionTextInput
          questionId={question.id}
          option={selectedOption}
          className="w-full"
        />
      )}

      {/* other-option 매직 ID 호환 경로 (@deprecated) */}
      {showLegacyOtherInput && (
        <Input
          placeholder="기타 내용을 입력하세요..."
          value={legacyOtherInput}
          onChange={(e) => handleLegacyOtherInputChange(e.target.value)}
          className="w-full"
        />
      )}
    </div>
  );
}

// 단답형(text) prefill 지원 컴포넌트
function TextResponseInput({
  question,
  value,
  onChange,
  attrs,
}: {
  question: Question;
  value: unknown;
  onChange: (v: unknown) => void;
  attrs: Record<string, string>;
}) {
  const template = question.defaultValueTemplate ?? '';
  const isPrefilled = template.trim().length > 0;
  const prefilledValue = isPrefilled ? substituteTokens(template, attrs) : '';
  const currentValue = typeof value === 'string' ? value : '';
  const inputValue = isPrefilled ? prefilledValue : currentValue;
  const isNumberMode = question.inputType === 'number';

  useEffect(() => {
    if (isPrefilled && value !== prefilledValue) {
      onChange(prefilledValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPrefilled, prefilledValue]);

  // 숫자 모드 + emptyDefault 정의 + 토큰 prefill 아님 + 값 미존재 → 첫 진입 시 자동 채움.
  // 응답자가 지워 빈 문자열이 되면 재채움하지 않음(의도 보존).
  useEffect(() => {
    if (
      !isPrefilled &&
      isNumberMode &&
      typeof question.emptyDefault === 'number' &&
      (value === undefined || value === null)
    ) {
      onChange(String(question.emptyDefault));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, isPrefilled, isNumberMode, question.emptyDefault]);

  return (
    <Input
      type="text"
      inputMode={isNumberMode ? 'decimal' : undefined}
      placeholder={
        question.placeholder || (isNumberMode ? '숫자만 입력하세요...' : '답변을 입력하세요...')
      }
      value={inputValue}
      onChange={(e) => {
        const v = e.target.value;
        if (isNumberMode && !isPartialNumericInput(v)) return;
        onChange(v);
      }}
      className="w-full text-base"
      disabled={isPrefilled}
      data-prefilled={isPrefilled || undefined}
    />
  );
}
