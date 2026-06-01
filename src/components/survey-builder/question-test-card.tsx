'use client';

import React, { useEffect, useMemo, useState } from 'react';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { isEmptyHtml } from '@/lib/utils';
import { sanitizeRichHtml } from '@/lib/sanitize';
import { OptionTextInput } from '@/components/survey-response/option-text-input';
import { useTestResponseStore } from '@/stores/test-response-store';
import { Question, SurveyLookup } from '@/types/survey';
import { getOptionsLayout } from '@/utils/options-layout';
import { evaluateNumericComparisonV2 } from '@/utils/branch-logic';

import { RankingQuestion } from '@/components/survey-response/ranking-question';
import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';
import { isChoiceTableSource } from '@/utils/choice-source';

import { ConditionDebugPanel } from './condition-debug-panel';
import { InteractiveTableResponse } from './interactive-table-response';
import { LazyMount } from './sortable-question-list';
import { useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';

import { NoticeRenderer } from './notice-renderer';
import { UserDefinedMultiLevelSelect } from './user-defined-multi-level-select';
import { computeTableEstimatedHeight } from '@/hooks/use-row-heights';

// 기타 옵션 관련 타입 정의
type OtherChoiceValue = {
  selectedValue: string;
  otherValue?: string;
  hasOther: true;
};

export function isOtherChoiceValue(value: unknown): value is OtherChoiceValue {
  if (!value || typeof value !== 'object') return false;
  return (
    'selectedValue' in value &&
    typeof (value as { selectedValue: unknown }).selectedValue === 'string' &&
    'hasOther' in value &&
    (value as { hasOther: unknown }).hasOther === true
  );
}

type SingleChoiceResponse = string | null | OtherChoiceValue;
type MultiChoiceResponse = Array<string | OtherChoiceValue>;

// 테스트 모드용 Radio 질문 컴포넌트
function RadioTestInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: SingleChoiceResponse;
  onChange: (value: SingleChoiceResponse) => void;
}) {
  const [otherInput, setOtherInput] = useState('');

  useEffect(() => {
    if (isOtherChoiceValue(value) && value.otherValue) {
      setOtherInput(value.otherValue);
    } else {
      setOtherInput('');
    }
  }, [value]);

  const handleOptionChange = (optionValue: string, optionId: string) => {
    const isOtherOption = optionId === 'other-option';
    const isSelected = isOtherChoiceValue(value)
      ? value.selectedValue === optionValue
      : value === optionValue;

    if (isSelected) {
      onChange(null);
      return;
    }

    if (isOtherOption) {
      onChange({
        selectedValue: optionValue,
        otherValue: otherInput,
        hasOther: true,
      });
    } else {
      onChange(optionValue);
    }
  };

  const handleOtherInputChange = (inputValue: string) => {
    setOtherInput(inputValue);
    if (isOtherChoiceValue(value)) {
      onChange({
        ...value,
        otherValue: inputValue,
      });
    }
  };

  const isSelected = (optionValue: string) => {
    if (isOtherChoiceValue(value)) {
      return value.selectedValue === optionValue;
    }
    return value === optionValue;
  };

  const layout = getOptionsLayout(question.optionsColumns);

  return (
    <div className={layout.className} style={layout.style}>
      {question.options?.map((option) => (
        <div key={option.id} className="space-y-2">
          <div className="flex items-center space-x-3">
            <input
              type="radio"
              id={`${question.id}-${option.id}`}
              name={question.id}
              value={option.value}
              checked={isSelected(option.value)}
              onChange={() => handleOptionChange(option.value, option.id)}
              onClick={() => handleOptionChange(option.value, option.id)}
              className="h-4 w-4 cursor-pointer border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label
              htmlFor={`${question.id}-${option.id}`}
              onClick={(e) => {
                e.preventDefault();
                handleOptionChange(option.value, option.id);
              }}
              className="flex-1 cursor-pointer text-sm text-gray-700"
            >
              {option.label}
            </label>
          </div>
          {option.id === 'other-option' && isSelected(option.value) && (
            <div className="ml-7">
              <Input
                placeholder="기타 내용을 입력하세요..."
                value={otherInput}
                onChange={(e) => handleOtherInputChange(e.target.value)}
                className="w-full"
              />
            </div>
          )}
          {option.id !== 'other-option' && option.allowTextInput && isSelected(option.value) && (
            <OptionTextInput
              questionId={question.id}
              option={option}
              className="ml-7"
            />
          )}
        </div>
      ))}
    </div>
  );
}

// 테스트 모드용 Checkbox 질문 컴포넌트
function CheckboxTestInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: MultiChoiceResponse;
  onChange: (value: MultiChoiceResponse) => void;
}) {
  const [otherInputs, setOtherInputs] = useState<Record<string, string>>({});

  const currentValues = useMemo<MultiChoiceResponse>(
    () => (Array.isArray(value) ? (value as MultiChoiceResponse) : []),
    [value],
  );

  useEffect(() => {
    const newOtherInputs: Record<string, string> = {};
    currentValues.forEach((val) => {
      if (isOtherChoiceValue(val)) {
        newOtherInputs[val.selectedValue] = val.otherValue || '';
      }
    });
    setOtherInputs(newOtherInputs);
  }, [currentValues]);

  const handleOptionChange = (optionValue: string, optionId: string, isChecked: boolean) => {
    let newValues = [...currentValues];
    const isOtherOption = optionId === 'other-option';

    if (isChecked) {
      // 최대 선택 개수 체크
      const maxSelections = question.maxSelections;
      if (maxSelections !== undefined && maxSelections > 0) {
        const currentCount = newValues.length;
        if (currentCount >= maxSelections) {
          // 최대 개수 도달 시 추가 선택 불가
          return;
        }
      }

      if (isOtherOption) {
        newValues.push({
          selectedValue: optionValue,
          otherValue: otherInputs[optionValue] || '',
          hasOther: true,
        });
      } else {
        newValues.push(optionValue);
      }
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

  const handleOtherInputChange = (optionValue: string, inputValue: string) => {
    const newOtherInputs = { ...otherInputs, [optionValue]: inputValue };
    setOtherInputs(newOtherInputs);

    const newValues = currentValues.map((val) => {
      if (isOtherChoiceValue(val) && val.selectedValue === optionValue) {
        return { ...val, otherValue: inputValue };
      }
      return val;
    });

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
    if (isChecked(optionValue)) return true; // 이미 선택된 것은 해제 가능
    if (isMaxReached) return false; // 최대 개수 도달 시 추가 선택 불가
    return true;
  };

  const layout = getOptionsLayout(question.optionsColumns);

  return (
    <div className={layout.className} style={layout.style}>
      {question.options?.map((option) => {
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
                onChange={(e) => handleOptionChange(option.value, option.id, e.target.checked)}
                className={`h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 ${
                  disabled ? 'cursor-not-allowed opacity-50' : ''
                }`}
              />
              <label
                htmlFor={`${question.id}-${option.id}`}
                className={`flex-1 text-sm text-gray-700 ${
                  disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                }`}
              >
                {option.label}
              </label>
            </div>
            {option.id === 'other-option' && checked && (
              <div className="ml-7">
                <Input
                  placeholder="기타 내용을 입력하세요..."
                  value={otherInputs[option.value] || ''}
                  onChange={(e) => handleOtherInputChange(option.value, e.target.value)}
                  className="w-full"
                />
              </div>
            )}
            {option.id !== 'other-option' && option.allowTextInput && checked && (
              <OptionTextInput
                questionId={question.id}
                option={option}
                className="ml-7"
              />
            )}
          </div>
        );
      })}

      {/* 선택 개수 표시 */}
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

// 테스트 모드용 Select 질문 컴포넌트
function SelectTestInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: SingleChoiceResponse;
  onChange: (value: SingleChoiceResponse) => void;
}) {
  const [otherInput, setOtherInput] = useState('');
  const [selectedValue, setSelectedValue] = useState<string>('');

  // value가 변경될 때 selectedValue와 otherInput 동기화
  useEffect(() => {
    if (isOtherChoiceValue(value)) {
      setSelectedValue(value.selectedValue);
      setOtherInput(value.otherValue || '');
    } else {
      setSelectedValue(value || '');
      setOtherInput('');
    }
  }, [value]);

  const handleSelectChange = (newValue: string) => {
    setSelectedValue(newValue);
    const selectedOption = question.options?.find((opt) => opt.value === newValue);

    if (selectedOption?.id === 'other-option') {
      onChange({
        selectedValue: newValue,
        otherValue: otherInput,
        hasOther: true,
      });
    } else {
      onChange(newValue);
    }
  };

  const handleOtherInputChange = (inputValue: string) => {
    setOtherInput(inputValue);
    if (selectedValue) {
      const selectedOption = question.options?.find((opt) => opt.value === selectedValue);
      if (selectedOption?.id === 'other-option') {
        onChange({
          selectedValue,
          otherValue: inputValue,
          hasOther: true,
        });
      }
    }
  };

  const showOtherInput = () => {
    if (!selectedValue) return false;
    const selectedOption = question.options?.find((opt) => opt.value === selectedValue);
    return selectedOption?.id === 'other-option';
  };

  return (
    <div className="space-y-3">
      <select
        value={selectedValue}
        onChange={(e) => handleSelectChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 p-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
      >
        <option value="">선택하세요...</option>
        {question.options?.map((option) => (
          <option key={option.id} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {showOtherInput() && (
        <div>
          <Input
            placeholder="기타 내용을 입력하세요..."
            value={otherInput}
            onChange={(e) => handleOtherInputChange(e.target.value)}
            className="w-full"
          />
        </div>
      )}

      {(() => {
        if (!selectedValue) return null;
        const selectedOption = question.options?.find((opt) => opt.value === selectedValue);
        if (!selectedOption || selectedOption.id === 'other-option') return null;
        if (!selectedOption.allowTextInput) return null;
        return (
          <OptionTextInput
            questionId={question.id}
            option={selectedOption}
            className="w-full"
          />
        );
      })()}
    </div>
  );
}

// 질문 타입별 테스트 입력 컴포넌트
function QuestionTestInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const attrs = useContactAttrs();
  switch (question.type) {
    case 'text':
      return (
        <Input
          placeholder={question.placeholder || '답변을 입력하세요...'}
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full"
        />
      );

    case 'textarea':
      return (
        <textarea
          className="w-full resize-none rounded-lg border border-gray-300 p-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
          rows={3}
          placeholder="답변을 입력하세요..."
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'radio':
      if (isChoiceTableSource(question)) {
        return (
          <ChoiceTableResponse
            question={question}
            value={value}
            onChange={onChange as (v: string | string[] | null) => void}
          />
        );
      }
      return (
        <RadioTestInput
          question={question}
          value={value as SingleChoiceResponse}
          onChange={onChange as (value: SingleChoiceResponse) => void}
        />
      );

    case 'checkbox':
      if (isChoiceTableSource(question)) {
        return (
          <ChoiceTableResponse
            question={question}
            value={value}
            onChange={onChange as (v: string | string[] | null) => void}
          />
        );
      }
      return (
        <CheckboxTestInput
          question={question}
          value={value as MultiChoiceResponse}
          onChange={onChange as (value: MultiChoiceResponse) => void}
        />
      );

    case 'select':
      return (
        <SelectTestInput
          question={question}
          value={value as SingleChoiceResponse}
          onChange={onChange as (value: SingleChoiceResponse) => void}
        />
      );

    case 'multiselect':
      return question.selectLevels ? (
        <UserDefinedMultiLevelSelect
          levels={question.selectLevels}
          values={Array.isArray(value) ? value : []}
          onChange={onChange}
          className="w-full"
        />
      ) : null;

    case 'ranking':
      return (
        <RankingQuestion
          question={question}
          value={value}
          onChange={(v) => onChange(v)}
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
          value={typeof value === 'object' && value !== null ? value : undefined}
          onChange={onChange}
          isTestMode={true}
          className="border-0 shadow-none"
          dynamicRowConfigs={question.dynamicRowConfigs}
          hideColumnLabels={question.hideColumnLabels}
        />
      ) : (
        <div className="py-4 text-center text-gray-500">테이블이 구성되지 않았습니다.</div>
      );

    case 'notice':
      return (
        <NoticeRenderer
          content={substituteTokens(question.noticeContent || '', attrs)}
          requiresAcknowledgment={question.requiresAcknowledgment}
          value={typeof value === 'boolean' ? value : false}
          onChange={onChange}
          isTestMode={true}
        />
      );

    default:
      return (
        <div className="py-4 text-center text-gray-500">이 질문 유형은 테스트할 수 없습니다.</div>
      );
  }
}

// 테스트 모드용 인터랙티브 질문 카드 컴포넌트
export function QuestionTestCard({
  question,
  index,
  lookups = [],
}: {
  question: Question;
  index: number;
  /** 분기 조건 우변 LUT 룩업 평가에 사용. currentSurvey.lookups 를 전달. */
  lookups?: SurveyLookup[];
}) {
  const testResponse = useTestResponseStore((s) => s.testResponses[question.id]);
  const updateTestResponse = useTestResponseStore((s) => s.updateTestResponse);
  // 디버그 패널 평가용 — 다른 질문 응답도 ctx 에 포함되도록 전체 testResponses 구독.
  const allTestResponses = useTestResponseStore((s) => s.testResponses);
  // 토큰 치환 + 분기 조건 평가에 사용할 컨택 attrs (ContactAttrsProvider 가 주입).
  const attrs = useContactAttrs();

  const handleResponse = (value: unknown) => {
    updateTestResponse(
      question.id,
      value as string | string[] | Record<string, string | string[] | object>,
    );
  };

  // displayCondition 의 numericComparison 들을 평가해서 디버그 패널 prop 으로 변환.
  const debugConditions = useMemo(() => {
    const out: Array<{ label: string; result: ReturnType<typeof evaluateNumericComparisonV2> }> = [];
    const conds = question.displayCondition?.conditions ?? [];
    // responses 를 LookupEvalCtx 가 기대하는 형태로 평탄화 (table 응답만 의미 있음).
    const responsesShaped: Record<string, Record<string, string | undefined>> = {};
    for (const [qid, raw] of Object.entries(allTestResponses)) {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const cells: Record<string, string | undefined> = {};
        for (const [cellId, cellVal] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof cellVal === 'string') cells[cellId] = cellVal;
        }
        responsesShaped[qid] = cells;
      }
    }
    const ctx = { responses: responsesShaped, contactAttrs: attrs, lookups };

    conds.forEach((c, idx) => {
      const mainCmp = c.tableConditions?.numericComparison;
      const addCmp = c.additionalConditions?.numericComparison;
      if (mainCmp) {
        out.push({
          label: c.name?.trim() || `조건 ${idx + 1} (메인)`,
          result: evaluateNumericComparisonV2(mainCmp, '', ctx),
        });
      }
      if (addCmp) {
        out.push({
          label: `${c.name?.trim() || `조건 ${idx + 1}`} (추가)`,
          result: evaluateNumericComparisonV2(addCmp, '', ctx),
        });
      }
    });
    return out;
  }, [question.displayCondition, allTestResponses, attrs, lookups]);

  return (
    <Card className="border-l-4 border-l-blue-500 p-6" data-question-index={index}>
      <div className="mb-4">
        <div className="mb-2 flex items-center space-x-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-600">
            {index + 1}
          </span>
          {question.required && <span className="text-sm text-red-500">*</span>}
        </div>
        <h3 className="mb-1 text-lg font-medium text-gray-900">
          {substituteTokens(question.title, attrs)}
        </h3>
        {!isEmptyHtml(question.description) && (
          <div
            className="prose prose-sm mb-4 max-w-none overflow-x-auto text-sm text-gray-600 [&_p]:min-h-[1.6em] [&_table]:my-2 [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_table]:border-2 [&_table]:border-gray-300 [&_table_p]:m-0 [&_table_td]:border [&_table_td]:border-gray-300 [&_table_td]:px-3 [&_table_td]:py-2 [&_table_th]:border [&_table_th]:border-gray-300 [&_table_th]:bg-transparent [&_table_th]:px-3 [&_table_th]:py-2 [&_table_th]:font-normal"
            style={{
              WebkitOverflowScrolling: 'touch',
            }}
            dangerouslySetInnerHTML={{
              __html: sanitizeRichHtml(
                substituteTokens(question.description!, attrs),
              ),
            }}
          />
        )}
      </div>

      <div className="space-y-3">
        {question.type === 'table' ? (
          <LazyMount
            questionId={question.id}
            estimatedHeight={computeTableEstimatedHeight(question.tableColumns ?? [], question.tableRowsData ?? [], question.tableHeaderGrid)}
          >
            <QuestionTestInput
              question={question}
              value={testResponse}
              onChange={handleResponse}
            />
          </LazyMount>
        ) : (
          <QuestionTestInput
            question={question}
            value={testResponse}
            onChange={handleResponse}
          />
        )}
      </div>

      {debugConditions.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold text-gray-500">표시 조건 평가</div>
          {debugConditions.map((c, idx) => (
            <ConditionDebugPanel key={idx} conditionLabel={c.label} result={c.result} />
          ))}
        </div>
      )}
    </Card>
  );
}
