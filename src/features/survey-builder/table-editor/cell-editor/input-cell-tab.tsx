'use client';

import type { RefObject } from 'react';

import { PenLine } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { VariableDef } from '@/components/ui/rich-text-editor/types';
import { CellContentLayout } from '@/features/question-renderer/cells/cell-content-layout';
import {
  AnswerQuoteQuestionControl,
  AnswerQuoteTextField,
} from '@/features/survey-builder/answer-quote-fields';
import { FormulaExprEditor } from '@/features/survey-builder/formula/formula-expr-editor';
import { NumberFormatFields } from '@/features/survey-builder/number-format-fields';
import { VariableButton } from '@/features/survey-builder/variable-button';
import type { Question } from '@/types/survey';
import { isPartialNumericInput } from '@/utils/numeric-input';

import type { CellFormSetters, UseCellFormResult } from './hooks/use-cell-form';

interface InputCellTabProps {
  form: UseCellFormResult['form'];
  setters: CellFormSetters;
  /** prefill 템플릿 입력칸 — 변수 버튼이 커서 위치에 토큰을 꽂는다. */
  inputTemplateRef: RefObject<HTMLInputElement | null>;
  /** 숫자 모드를 이 세션에서 처음 켰는지 — 초기값 기본 ON 을 한 번만 적용한다. */
  emptyDefaultAutoAppliedRef: { current: boolean };
  ownQuestion: Question;
  questions: Question[];
  variableCatalog: VariableDef[];
  /** 표 질문일 때만 셀 단위 인용 컨트롤을 보여준다. */
  showCellAnswerQuote: boolean;
  answerQuoteEnabled?: boolean | undefined;
}

/**
 * cell-content-modal 의 '단답형 입력' 탭 내용.
 * 숫자 모드·계산 검증·placeholder·prefill·글자수 제한·인용·미리보기.
 */
export function InputCellTab({
  form,
  setters,
  inputTemplateRef,
  emptyDefaultAutoAppliedRef,
  ownQuestion,
  questions,
  variableCatalog,
  showCellAnswerQuote,
  answerQuoteEnabled = false,
}: InputCellTabProps) {
  const {
    inputType,
    emptyDefaultEnabled,
    emptyDefaultRaw,
    cellNumberFormat,
    formulaValidationEnabled,
    formula,
    formulaToleranceRaw,
    formulaErrorMessage,
    inputPlaceholder,
    inputDefaultValueTemplate,
    inputMaxLength,
    answerQuoteEnabled: cellAnswerQuoteEnabled,
    answerQuoteName: cellAnswerQuoteName,
    answerQuoteText,
    textContent,
    textPosition,
    textColor,
  } = form;
  const {
    setInputType,
    setEmptyDefaultEnabled,
    setEmptyDefaultRaw,
    setCellNumberFormat,
    setFormulaValidationEnabled,
    setFormula,
    setFormulaToleranceRaw,
    setFormulaErrorMessage,
    setInputPlaceholder,
    setInputDefaultValueTemplate,
    setInputMaxLength,
    setAnswerQuoteEnabled: setCellAnswerQuoteEnabled,
    setAnswerQuoteName: setCellAnswerQuoteName,
    setAnswerQuoteText,
  } = setters;

  return (
    <>
      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
        <div className="flex items-start gap-2">
          <PenLine className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
          <div>
            <p className="text-sm font-medium text-blue-900">단답형 입력 필드</p>
            <p className="mt-1 text-xs text-blue-700">
              사용자가 짧은 텍스트를 입력할 수 있는 필드입니다. 이름, 이메일, 전화번호 등
              간단한 정보 수집에 적합합니다.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-col gap-3 rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="input-type-number"
              checked={inputType === 'number'}
              onChange={(e) => {
                const checked = e.target.checked;
                setInputType(checked ? 'number' : 'text');
                if (checked && !emptyDefaultAutoAppliedRef.current) {
                  // 숫자 모드를 이 세션에서 처음 켤 때만 emptyDefault 기본 ON (기본값 0).
                  // 이후 사용자가 초기값 옵션을 끈 뒤 다시 토글해도 강제로 켜지지 않는다.
                  emptyDefaultAutoAppliedRef.current = true;
                  setEmptyDefaultEnabled(true);
                }
              }}
              className="mt-0.5 h-4 w-4"
            />
            <label htmlFor="input-type-number" className="flex-1 cursor-pointer text-sm">
              <span className="font-medium">숫자만 입력</span>
              <p className="mt-0.5 text-xs text-gray-500">
                체크 시 응답자는 숫자만 입력할 수 있고, 분기 조건에서 비교 연산자 (=, ≠, ≥, ≤,
                &gt;, &lt;) 를 사용할 수 있습니다.
              </p>
            </label>
          </div>

          {inputType === 'number' && (
            <div className="ml-7 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                id="empty-default-enabled"
                checked={emptyDefaultEnabled}
                onChange={(e) => setEmptyDefaultEnabled(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="empty-default-enabled" className="cursor-pointer">
                응답자 입력란 초기값
              </label>
              <Input
                type="text"
                inputMode="decimal"
                value={emptyDefaultRaw}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isPartialNumericInput(v)) setEmptyDefaultRaw(v);
                }}
                disabled={!emptyDefaultEnabled}
                className="h-8 w-24"
                aria-label="초기값"
              />
            </div>
          )}
          {inputType === 'number' && (
            <div className="ml-7">
              <NumberFormatFields
                idPrefix="cell-nf"
                value={cellNumberFormat}
                onChange={setCellNumberFormat}
              />
            </div>
          )}
        </div>
      </div>

      {inputType === 'number' ? (
        <div className="space-y-3 rounded border p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={formulaValidationEnabled}
              onChange={(e) => setFormulaValidationEnabled(e.target.checked)}
            />
            계산 검증 — 입력값이 수식 계산 결과와 다르면 다음 진행을 차단
          </label>
          {formulaValidationEnabled ? (
            <>
              <FormulaExprEditor
                value={formula}
                onChange={setFormula}
                ownQuestion={ownQuestion}
                allQuestions={questions}
              />
              <div className="flex items-center gap-2 text-sm">
                <span>오차 허용 ±</span>
                <Input
                  className="w-24"
                  value={formulaToleranceRaw}
                  onChange={(e) => {
                    const v = e.target.value;
                    // 오차 허용은 0 이상만 허용한다 — 음수면 Math.abs(입력 − 계산) > tolerance
                    // 비교가 정확히 일치하는 값도 항상 위반으로 판정하는 트랩이 된다.
                    if (v.includes('-')) return;
                    if (isPartialNumericInput(v)) setFormulaToleranceRaw(v);
                  }}
                  placeholder="0"
                />
              </div>
              <p className="text-xs text-gray-500">
                음수는 입력할 수 없습니다. 오차 허용이 음수이면 값이 정확히 일치해도 항상
                불일치로 판정됩니다.
              </p>
              <Input
                value={formulaErrorMessage}
                onChange={(e) => setFormulaErrorMessage(e.target.value)}
                placeholder="불일치 시 표시할 문구 (비우면 기본 문구, 계산값 미노출)"
              />
            </>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="input-placeholder" className="text-sm font-medium">
          안내 문구 (Placeholder)
        </Label>
        <Input
          id="input-placeholder"
          value={inputPlaceholder}
          onChange={(e) => setInputPlaceholder(e.target.value)}
          placeholder="예: 이름을 입력하세요"
          className="w-full"
        />
        <p className="text-xs text-gray-500">입력 필드에 표시될 안내 문구를 입력하세요</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="input-default-value-template" className="text-sm font-medium">
          응답값 prefill <span className="font-normal text-gray-500">(선택)</span>
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="input-default-value-template"
            ref={inputTemplateRef}
            value={inputDefaultValueTemplate}
            onChange={(e) => setInputDefaultValueTemplate(e.target.value)}
            placeholder="예: {{전시회명}}"
            className="flex-1"
          />
          {variableCatalog.length > 0 && (
            <VariableButton
              catalog={variableCatalog}
              inputRef={inputTemplateRef}
              onChange={(v) => setInputDefaultValueTemplate(v)}
            />
          )}
        </div>
        <p className="text-xs text-gray-500">
          변수 토큰 사용 시 응답자에게 readonly로 표시됩니다
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="input-max-length" className="text-sm font-medium">
          최대 글자 수 <span className="font-normal text-gray-500">(선택사항)</span>
        </Label>
        <Input
          id="input-max-length"
          type="number"
          min={1}
          max={500}
          value={inputMaxLength}
          onChange={(e) => {
            const value = e.target.value;
            if (value === '') {
              setInputMaxLength('');
            } else {
              const num = parseInt(value);
              if (!isNaN(num) && num >= 1 && num <= 500) {
                setInputMaxLength(num);
              }
            }
          }}
          placeholder="제한 없음"
          className="w-full"
        />
        <p className="text-xs text-gray-500">
          {inputMaxLength === '' || inputMaxLength === 0
            ? '글자 수 제한이 없습니다'
            : `최대 ${inputMaxLength}자까지 입력 가능`}
        </p>
        {inputType === 'number' && cellNumberFormat?.thousandSeparator && (
          <p className="text-xs text-amber-600">
            천단위 콤마 표시가 켜져 있으면 화면에 콤마가 포함된 문자열 기준으로 글자 수가
            계산됩니다. 큰 숫자가 잘리지 않도록 여유 있게 설정하세요.
          </p>
        )}
      </div>

      {showCellAnswerQuote ? (
        <AnswerQuoteQuestionControl
          idPrefix="cell-answer-quote"
          enabled={cellAnswerQuoteEnabled}
          onEnabledChange={setCellAnswerQuoteEnabled}
          name={cellAnswerQuoteName}
          onNameChange={setCellAnswerQuoteName}
          questionText={{ value: answerQuoteText, onChange: setAnswerQuoteText }}
          scope="cell"
        />
      ) : (
        answerQuoteEnabled && (
          <AnswerQuoteTextField
            id="cell-answer-quote-text"
            value={answerQuoteText}
            onChange={setAnswerQuoteText}
            mode="input"
            showInputTokenHint
          />
        )
      )}

      <div className="space-y-2">
        <Label className="text-sm font-medium">미리보기</Label>
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4">
          <CellContentLayout
            content={textContent}
            position={textPosition}
            textColor={textColor}
          >
            <div className="space-y-2">
              <Input
                placeholder={inputPlaceholder || '답변을 입력하세요...'}
                maxLength={typeof inputMaxLength === 'number' ? inputMaxLength : undefined}
                disabled
                className="bg-white"
              />
              {typeof inputMaxLength === 'number' && inputMaxLength > 0 && (
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>0 / {inputMaxLength}자</span>
                </div>
              )}
            </div>
          </CellContentLayout>
        </div>
      </div>
    </>
  );
}
