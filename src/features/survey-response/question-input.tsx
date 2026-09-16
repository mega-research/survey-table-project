'use client';

import { useEffect, useEffectEvent, useMemo } from 'react';

import { Input } from '@/components/ui/input';
import { ChoiceTableResponse } from '@/features/question-renderer/choice-table-response';
import { useAnswerQuotes, useContactAttrs } from '@/features/question-renderer/contact-attrs-context';
import { useFieldFocus } from '@/features/question-renderer/hooks/use-field-focus';
import { useInputFormatField } from '@/features/question-renderer/hooks/use-input-format-field';
import { InteractiveTableResponse } from '@/features/question-renderer/interactive-table-response';
import { NoticeRenderer } from '@/features/question-renderer/notice-renderer';
import { OptionTextInput } from '@/features/question-renderer/option-text-input';
import { OptionTextInputStack } from '@/features/question-renderer/option-text-input-stack';
import { RankingQuestion } from '@/features/question-renderer/ranking-question';
import {
  ResponseSourcesProvider,
  useResponseSources,
} from '@/features/question-renderer/response-sources';
import { UserDefinedMultiLevelSelect } from '@/features/question-renderer/user-defined-multi-level-select';
import {
  applyMobileOptionsGridOverride,
  resolveMobileOptionsColumns,
} from '@/features/question-renderer/utils/mobile-card-options';
import { getOptionsLayout } from '@/features/question-renderer/utils/options-layout';
import {
  type ValidationBannerItem,
  ValidationIssueBanner,
} from '@/features/question-renderer/validation-issue-banner';
import { collectUnfilledChoiceGroupCellIds } from '@/features/survey-response/lib/answer-validation';
import type { NumericIssue } from '@/features/survey-response/lib/numeric-validation';
import { resolveTextQualityViolation } from '@/features/survey-response/lib/numeric-validation';
import { liveResponseSources } from '@/features/survey-response/stores/live-response-sources';
import { useFormattedNumericInput } from '@/hooks/use-formatted-numeric-input';
import { useMobileView } from '@/hooks/use-media-query';
import { isChoiceGroupTableQuestion } from '@/lib/survey/choice-selection';
import {
  applyExclusiveSelection,
  choiceValueKey,
  countSelectionsTowardMax,
  satisfiesMinSelections,
} from '@/features/question-renderer/utils/exclusive-choice';
import {
  PRIOR_HIGHLIGHT_CONTROL_CLS,
  PRIOR_HIGHLIGHT_TEXT_CLS,
  isPriorChoice,
  isPriorText,
} from '@/features/question-renderer/utils/prior-answer-highlight';
import { type PriorAnswers, hasPriorAnswer, priorAnswerText } from '@/lib/survey/prior-answers';
import { usePriorAnswers, usePriorHighlight } from '@/features/question-renderer/prior-answers-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { type InputFormat, isInputFormat } from '@/types/input-type';
import { Question, QuestionOption } from '@/types/survey';
import { isChoiceTableSource } from '@/utils/choice-source';
import { formatSampleValue } from '@/features/question-renderer/utils/input-format';
import { effectiveMaxLength, isPlainTextInput } from '@/features/question-renderer/utils/text-quality';

/**
 * 라디오·체크박스 옵션 목록의 좌우 인셋 — 질문 제목보다 옵션 블록을 안쪽으로 들여쓴다.
 * 세로 여백은 건드리지 않는다(컨트롤의 mt-1 첫 줄 정렬 유지).
 * 옵션 컨테이너 자체가 아니라 바깥을 감싸는 이유: getOptionsLayout 의 정렬 클래스
 * (mx-auto / ml-auto / pr-5)와 padding·margin 이 충돌하지 않게 하기 위함.
 */
const OPTIONS_INSET_X = 'px-1';

interface QuestionInputProps {
  question: Question;
  value: unknown;
  onChange: (value: unknown) => void;
  allResponses?: Record<string, unknown>;
  allQuestions?: Question[];
  /** 숫자 차단형 검증 위반 목록 — "다음"/제출 시도 후에만 채워짐(라이브 계산은 상위 소유). */
  numericIssues?: NumericIssue[] | undefined;
  selectedDynamicRowIds?: string[] | undefined;
  onDynamicRowSelectionChange?: ((rowIds: string[]) => void) | undefined;
  /** 미충족 필수 보기 그룹을 표에 표시할지 — 「다음」을 누른 뒤에만 켠다. */
  showRequiredHighlight?: boolean | undefined;
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

function buildTableValidationBannerItems(
  question: Question,
  numericIssues: NumericIssue[] | undefined,
): ValidationBannerItem[] | undefined {
  const rowKeyByCellId = new Map<string, string>();
  const rowLabelByKey = new Map<string, string>();
  for (const row of question.tableRowsData ?? []) {
    for (const cell of row.cells) rowKeyByCellId.set(cell.id, row.id);
    const mobileHeader = row.cells.find(
      (cell) =>
        cell.type === 'text' && cell.mobileDisplay === 'header' && Boolean(cell.content?.trim()),
    );
    const rowLabel = mobileHeader?.content?.trim() || row.label?.trim();
    if (rowLabel) rowLabelByKey.set(row.id, rowLabel);
  }

  const items = (numericIssues ?? [])
    .filter((issue) => issue.kind !== 'range')
    .flatMap((issue): ValidationBannerItem[] => {
      const cellIds = issue.cellIds ?? [];
      if (issue.kind !== 'required-cells' || cellIds.length < 2) {
        const rowIds = new Set(cellIds.map((cellId) => rowKeyByCellId.get(cellId)).filter(Boolean));
        const rowId = rowIds.size === 1 ? [...rowIds][0] : undefined;
        return [
          {
            message: issue.message,
            cellIds,
            ...(rowId ? { rowId } : {}),
            ...(issue.detailTargetIds ? { detailTargetIds: issue.detailTargetIds } : {}),
          },
        ];
      }

      const cellIdsByRow = new Map<string, string[]>();
      for (const cellId of cellIds) {
        const key = rowKeyByCellId.get(cellId) ?? `cell:${cellId}`;
        const rowCellIds = cellIdsByRow.get(key) ?? [];
        rowCellIds.push(cellId);
        cellIdsByRow.set(key, rowCellIds);
      }
      if (cellIdsByRow.size <= 1) {
        const rowId = [...cellIdsByRow.keys()][0];
        return [
          {
            message: issue.message,
            cellIds,
            ...(rowId && !rowId.startsWith('cell:') ? { rowId } : {}),
            ...(issue.detailTargetIds ? { detailTargetIds: issue.detailTargetIds } : {}),
          },
        ];
      }

      // 모바일 표는 행마다 카드가 되므로 필수 오류도 행별 항목으로 나눈다.
      // 여러 행의 상세 입력 target은 셀과 일대일 매핑할 수 없으므로 이 경우에는
      // 각 행의 오류 셀을 카드 이동 기준으로 사용한다.
      return [...cellIdsByRow.entries()].map(([rowKey, rowCellIds]) => ({
        message: issue.message,
        ...(!rowKey.startsWith('cell:') ? { rowId: rowKey } : {}),
        ...(rowLabelByKey.has(rowKey) ? { labelPrefix: rowLabelByKey.get(rowKey) } : {}),
        cellIds: rowCellIds,
      }));
    });
  return items.length > 0 ? items : undefined;
}

// 질문 유형별 입력 라우터
export function QuestionInput({ question, numericIssues, ...controlProps }: QuestionInputProps) {
  const control = (
    <QuestionInputControl question={question} numericIssues={numericIssues} {...controlProps} />
  );
  if (question.type === 'table')
    return (
      <ResponseSourcesProvider sources={liveResponseSources}>{control}</ResponseSourcesProvider>
    );

  // range·format·text-quality 는 입력칸 바로 아래에 이미 붙는다 — 배너로 한 번 더 말하지 않는다.
  const bannerItems = (numericIssues ?? [])
    .filter(
      (issue) => issue.kind !== 'range' && issue.kind !== 'format' && issue.kind !== 'text-quality',
    )
    .map((issue) => ({
      message: issue.message,
      cellIds: issue.cellIds,
      detailTargetIds: issue.detailTargetIds,
    }));
  return (
    <ResponseSourcesProvider sources={liveResponseSources}>
      {control}
      <ValidationIssueBanner items={bannerItems} questionId={question.id} />
    </ResponseSourcesProvider>
  );
}

/**
 * 표의 붉은 테두리 셀 — 차단형 검증 위반 셀에, 「다음」을 누른 뒤에는 미충족 필수 보기 그룹의
 * 보기 셀(보기 그룹 표)을 더한다. 판정은 필수 게이트와 같은 술어(collectUnfilledChoiceGroupCellIds)다.
 */
function resolveTableErrorCellIds(
  question: Question,
  value: unknown,
  numericIssues: NumericIssue[] | undefined,
  showRequiredHighlight: boolean | undefined,
): Set<string> | undefined {
  const ids = new Set<string>(numericIssues?.flatMap((i) => i.cellIds ?? []) ?? []);
  if (showRequiredHighlight && isChoiceGroupTableQuestion(question)) {
    for (const id of collectUnfilledChoiceGroupCellIds(question, value)) ids.add(id);
  }
  return ids.size > 0 ? ids : undefined;
}

function QuestionInputControl({
  question,
  value,
  onChange,
  allResponses,
  allQuestions,
  numericIssues,
  selectedDynamicRowIds,
  onDynamicRowSelectionChange,
  showRequiredHighlight,
}: QuestionInputProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const priorHighlight = usePriorHighlight();
  const { answers: priorAnswersForQuality } = usePriorAnswers();

  // choice_opt 테이블 소스 라디오/체크박스는 hooks 진입 전에 디스패처에서 분기
  if (
    (question.type === 'radio' || question.type === 'checkbox') &&
    isChoiceTableSource(question)
  ) {
    return (
      <ChoiceTableResponse
        question={question}
        value={value}
        onChange={onChange as (v: unknown) => void}
        allResponses={allResponses}
        allQuestions={allQuestions}
        selectedDynamicRowIds={selectedDynamicRowIds}
        onDynamicRowSelectionChange={onDynamicRowSelectionChange}
        // 미충족 필수 보기 그룹은 필수 게이트와 같은 술어로 여기서 계산해 넘긴다 — 렌더러는
        // 응답 검증 규칙(answer-validation)을 모른다. 함수가 그룹 없는 문항은 빈 집합으로 접는다.
        unfilledGroupCellIds={
          showRequiredHighlight ? collectUnfilledChoiceGroupCellIds(question, value) : undefined
        }
      />
    );
  }

  switch (question.type) {
    case 'notice': {
      const noticeVal =
        value && typeof value === 'object' && 'agreed' in (value as Record<string, unknown>)
          ? (value as { agreed: boolean; agreedAt?: string })
          : { agreed: typeof value === 'boolean' ? value : false };
      return (
        <NoticeRenderer
          content={substituteTokens(question.noticeContent || '', attrs, quotes)}
          bgColor={question.noticeBgColor}
          {...(question.requiresAcknowledgment !== undefined
            ? { requiresAcknowledgment: question.requiresAcknowledgment }
            : {})}
          value={noticeVal.agreed}
          onChange={(v) =>
            onChange(v ? { agreed: true, agreedAt: new Date().toISOString() } : { agreed: false })
          }
        />
      );
    }

    case 'text':
      return (
        <TextResponseInput question={question} value={value} onChange={onChange} attrs={attrs} />
      );

    case 'textarea':
      return (
        <TextareaResponseInput
          question={question}
          value={value}
          onChange={onChange}
          priorAnswers={priorAnswersForQuality}
          priorHighlightCls={
            isPriorText(priorHighlight, question.id, value) ? PRIOR_HIGHLIGHT_TEXT_CLS : ''
          }
        />
      );

    case 'radio':
      return (
        <div className={OPTIONS_INSET_X}>
          <RadioQuestion
            question={question}
            value={(value ?? null) as SingleChoiceResponse}
            onChange={onChange}
          />
        </div>
      );

    case 'checkbox':
      return (
        <div className={OPTIONS_INSET_X}>
          <CheckboxQuestion
            question={question}
            value={value as MultiChoiceResponse | unknown}
            onChange={onChange}
          />
        </div>
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
          questionId={question.id}
          priorHighlight={priorHighlight}
        />
      ) : (
        <div className="py-4 text-center text-gray-500">다단계 선택이 구성되지 않았습니다.</div>
      );

    case 'ranking':
      return <RankingQuestion question={question} value={value} onChange={(v) => onChange(v)} />;

    case 'table':
      return question.tableColumns && question.tableRowsData ? (
        <InteractiveTableResponse
          questionId={question.id}
          {...(question.tableTitle !== undefined ? { tableTitle: question.tableTitle } : {})}
          columns={question.tableColumns}
          rows={question.tableRowsData}
          {...(question.tableHeaderGrid ? { tableHeaderGrid: question.tableHeaderGrid } : {})}
          {...(typeof value === 'object' && value !== null
            ? { value: value as Record<string, unknown> }
            : {})}
          onChange={onChange as (v: Record<string, unknown>) => void}
          className="border-0 shadow-none"
          allResponses={allResponses}
          allQuestions={allQuestions}
          {...(question.dynamicRowConfigs !== undefined
            ? { dynamicRowConfigs: question.dynamicRowConfigs }
            : {})}
          {...(question.rowRepeatConfig != null
            ? { rowRepeatConfig: question.rowRepeatConfig }
            : {})}
          {...(question.hideColumnLabels !== undefined
            ? { hideColumnLabels: question.hideColumnLabels }
            : {})}
          {...(question.stickyColumnCount !== undefined
            ? { stickyColumnCount: question.stickyColumnCount }
            : {})}
          {...(question.mobileOriginalTable !== undefined
            ? { mobileOriginalTable: question.mobileOriginalTable }
            : {})}
          {...(question.mobileTableDisplayMode !== undefined
            ? { mobileTableDisplayMode: question.mobileTableDisplayMode }
            : {})}
          {...(question.mobileDrilldownOmitLeadingColumns !== undefined
            ? {
                mobileDrilldownOmitLeadingColumns: question.mobileDrilldownOmitLeadingColumns,
              }
            : {})}
          {...(question.mobileDrilldownRepeatHeaderStartRow !== undefined
            ? {
                mobileDrilldownRepeatHeaderStartRow: question.mobileDrilldownRepeatHeaderStartRow,
              }
            : {})}
          {...(question.mobileDrilldownRepeatHeaderEndRow !== undefined
            ? { mobileDrilldownRepeatHeaderEndRow: question.mobileDrilldownRepeatHeaderEndRow }
            : {})}
          choiceGroups={question.choiceGroups}
          errorCellIds={resolveTableErrorCellIds(
            question,
            value,
            numericIssues,
            showRequiredHighlight,
          )}
          errorItems={buildTableValidationBannerItems(question, numericIssues)}
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
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
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

  const priorHighlight = usePriorHighlight();

  const isMobileView = useMobileView();
  const effectiveColumns = isMobileView
    ? resolveMobileOptionsColumns(
        question.mobileOptionsColumns,
        question.options?.map((o) => o.label) ?? [],
      )
    : question.optionsColumns;
  const layout = getOptionsLayout(effectiveColumns, question.optionsAlign);
  const layoutStyle = isMobileView
    ? applyMobileOptionsGridOverride(layout.style, effectiveColumns)
    : layout.style;

  // 기타 입력란(1d): 선택한 allowTextInput 옵션의 입력란을 옵션 그리드 아래
  // [옵션 라벨 칩 | 풀폭 입력란] 행으로 렌더 (테이블 셀과 동일 패턴).
  const selectedTextOption = question.options?.find(
    (option) => option.allowTextInput && isSelected(option.value),
  );

  return (
    <div className="space-y-3">
      <div className={layout.className} style={layoutStyle}>
        {question.options?.map((option: QuestionOption) => (
          // items-start + mt-1: 라벨이 2줄로 감겨도 라디오가 첫 줄 중앙에 고정 (한 줄일 때 위치 동일)
          <div key={option.id} className="flex items-start space-x-3">
            <input
              type="radio"
              id={`${question.id}-${option.id}`}
              name={question.id}
              value={option.value}
              checked={isSelected(option.value)}
              onChange={() => handleOptionChange(option.value)}
              onClick={() => handleOptionChange(option.value)}
              className={`mt-1 h-4 w-4 shrink-0 cursor-pointer border-gray-300 text-blue-600 focus:ring-blue-500 ${
                isSelected(option.value) && isPriorChoice(priorHighlight, question.id, option.value)
                  ? PRIOR_HIGHLIGHT_CONTROL_CLS
                  : ''
              }`}
            />
            <label
              htmlFor={`${question.id}-${option.id}`}
              onClick={(e) => {
                e.preventDefault();
                handleOptionChange(option.value);
              }}
              className="flex-1 cursor-pointer text-base whitespace-pre-line text-gray-700"
            >
              {substituteTokens(option.label, attrs, quotes)}
            </label>
          </div>
        ))}
      </div>
      {selectedTextOption && (
        <OptionTextInputStack
          questionId={question.id}
          entries={[
            {
              option: selectedTextOption,
              label:
                substituteTokens(selectedTextOption.label, attrs, quotes).trim() || '(라벨 없음)',
            },
          ]}
        />
      )}
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
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const priorHighlight = usePriorHighlight();
  const currentValues = useMemo<MultiChoiceResponse>(
    () => (Array.isArray(value) ? (value as MultiChoiceResponse) : []),
    [value],
  );

  // 단독 선택 보기 판정 — 값은 문자열 또는 기타 상세기재 객체({selectedValue})다
  const exclusiveChoiceValues = useMemo(
    () =>
      new Set(
        (question.options ?? []).filter((o) => o.exclusiveChoice === true).map((o) => o.value),
      ),
    [question.options],
  );
  const isExclusiveChoiceValue = (val: MultiChoiceResponse[number]) => {
    const key = choiceValueKey(val);
    return key !== undefined && exclusiveChoiceValues.has(key);
  };

  const handleOptionChange = (optionValue: string, isChecked: boolean) => {
    let newValues = [...currentValues];

    if (isChecked) {
      // 최대 선택 가드는 단독 선택 보기에는 걸지 않는다 — 고르면 그것 하나만 남아 상한 안이고,
      // "나중에 누른 쪽이 이긴다"는 규칙상 꽉 찬 상태에서도 「없음」은 들어가야 한다.
      // 개수도 단독 보기를 뺀 것으로 센다 — 「없음」이 골라진 상태에서 일반 보기를 누르면 「없음」이 풀린다.
      const maxSelections = question.maxSelections;
      if (
        !isExclusiveChoiceValue(optionValue) &&
        maxSelections !== undefined &&
        maxSelections > 0 &&
        countSelectionsTowardMax(newValues, isExclusiveChoiceValue) >= maxSelections
      ) {
        return;
      }

      // 단독 선택 보기 규칙 — 「없음」을 고르면 나머지가 풀리고, 일반 보기를 고르면 「없음」이 풀린다
      newValues = applyExclusiveSelection<MultiChoiceResponse[number]>(
        newValues,
        optionValue,
        isExclusiveChoiceValue,
      ).next;
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
    maxSelections !== undefined &&
    maxSelections > 0 &&
    countSelectionsTowardMax(currentValues, isExclusiveChoiceValue) >= maxSelections;
  const isMinNotMet = !satisfiesMinSelections(currentValues, minSelections, isExclusiveChoiceValue);

  const canSelect = (optionValue: string) => {
    if (isChecked(optionValue)) return true;
    // 단독 선택 보기는 꽉 찬 상태에서도 누를 수 있어야 한다 — 고르면 그것 하나만 남는다
    if (isMaxReached) return isExclusiveChoiceValue(optionValue);
    return true;
  };

  const isMobileView = useMobileView();
  const effectiveColumns = isMobileView
    ? resolveMobileOptionsColumns(
        question.mobileOptionsColumns,
        question.options?.map((o) => o.label) ?? [],
      )
    : question.optionsColumns;
  const layout = getOptionsLayout(effectiveColumns, question.optionsAlign);
  const layoutStyle = isMobileView
    ? applyMobileOptionsGridOverride(layout.style, effectiveColumns)
    : layout.style;

  // 기타 입력란(1d): 선택한 allowTextInput 옵션들의 입력란을 옵션 그리드 아래
  // 선택 순서(currentValues 순서)대로 [옵션 라벨 칩 | 풀폭 입력란] 행으로 쌓는다.
  const textInputEntries = currentValues
    .map((val) => (isOtherChoiceValue(val) ? val.selectedValue : val))
    .filter((val): val is string => typeof val === 'string')
    .map((val) => question.options?.find((option) => option.allowTextInput && option.value === val))
    .filter((option): option is QuestionOption => Boolean(option))
    .map((option) => ({
      option,
      label: substituteTokens(option.label, attrs, quotes).trim() || '(라벨 없음)',
    }));

  return (
    <div className="space-y-3">
      <div className={layout.className} style={layoutStyle}>
        {question.options?.map((option: QuestionOption) => {
          const checked = isChecked(option.value);
          const disabled = !canSelect(option.value);

          return (
            // items-start + mt-1: 라벨이 2줄로 감겨도 체크박스가 첫 줄 중앙에 고정 (한 줄일 때 위치 동일)
            <div key={option.id} className="flex items-start space-x-3">
              <input
                type="checkbox"
                id={`${question.id}-${option.id}`}
                checked={checked}
                disabled={disabled}
                onChange={(e) => handleOptionChange(option.value, e.target.checked)}
                className={`mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500 ${
                  checked && isPriorChoice(priorHighlight, question.id, option.value)
                    ? PRIOR_HIGHLIGHT_CONTROL_CLS
                    : ''
                } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              />
              <label
                htmlFor={`${question.id}-${option.id}`}
                className={`flex-1 text-base whitespace-pre-line text-gray-700 ${
                  disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                }`}
              >
                {substituteTokens(option.label, attrs, quotes)}
              </label>
            </div>
          );
        })}
      </div>

      <OptionTextInputStack questionId={question.id} entries={textInputEntries} />

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
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const priorHighlight = usePriorHighlight();
  // OtherChoiceValue fallback: snapshot 호환 (Phase 7 cleanup 까지 유지)
  const selectedValue = isOtherChoiceValue(value)
    ? value.selectedValue
    : typeof value === 'string'
      ? value
      : '';
  const legacyOtherInput = isOtherChoiceValue(value) ? (value.otherValue ?? '') : '';

  const selectedOption = question.options?.find((opt) => opt.value === selectedValue);

  const handleSelectChange = (newValue: string) => {
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
  const showAllowTextInput = !showLegacyOtherInput && selectedOption?.allowTextInput === true;

  return (
    <div className="space-y-3">
      <select
        value={selectedValue}
        onChange={(e) => handleSelectChange(e.target.value)}
        className={`w-full rounded-lg border border-gray-300 p-3 text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-500 ${
          isPriorChoice(priorHighlight, question.id, selectedValue) ? PRIOR_HIGHLIGHT_TEXT_CLS : ''
        }`}
      >
        <option value="">선택하세요...</option>
        {question.options?.map((option: QuestionOption) => (
          <option key={option.id} value={option.value}>
            {substituteTokens(option.label, attrs, quotes)}
          </option>
        ))}
      </select>

      {/* allowTextInput 옵션 선택 시 인라인 텍스트 입력 */}
      {showAllowTextInput && selectedOption && (
        <OptionTextInput questionId={question.id} option={selectedOption} className="w-full" />
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

/** 운영자가 placeholder 를 적지 않았을 때의 기본 문구. 형식 칸은 예시 값이 가장 친절하다. */
function defaultPlaceholder(isNumberMode: boolean, format: InputFormat | null): string {
  if (format) return formatSampleValue(format);
  return isNumberMode ? '숫자만 입력하세요...' : '답변을 입력하세요...';
}

// 단답형(text) prefill 지원 컴포넌트
/**
 * 장문형 입력 — 응답 품질 위반(최소·최대 글자 수·의미 없는 입력)은 칸을 벗어난 뒤 입력칸 아래에
 * 보인다. 치는 동안 띄우면 한글 조합 중 첫 자모(ㅇ)에 "자음만으로는 답할 수 없다" 가 스친다.
 */
function TextareaResponseInput({
  question,
  value,
  onChange,
  priorAnswers,
  priorHighlightCls,
}: {
  question: Question;
  value: unknown;
  onChange: (v: unknown) => void;
  priorAnswers: PriorAnswers | null;
  priorHighlightCls: string;
}) {
  const focus = useFieldFocus();
  const quality = focus.focused ? null : resolveTextQualityViolation(question, value, priorAnswers);
  const max = effectiveMaxLength(question.textValidation);
  const text = typeof value === 'string' ? value : '';
  return (
    <div className="w-full">
      <textarea
        className={`w-full resize-none rounded-lg border border-gray-300 p-3 text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-500 ${priorHighlightCls}`}
        rows={4}
        placeholder={question.placeholder || '답변을 입력하세요...'}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onFocus={focus.onFocus}
        onBlur={focus.onBlur}
        {...(max !== null ? { maxLength: max } : {})}
      />
      {max !== null && <TextLengthCounter current={text.length} max={max} />}
      {quality && (
        <p className="mt-1 px-1 text-xs text-red-500" data-testid="text-quality-violation">
          * {quality.message}
        </p>
      )}
    </div>
  );
}

/** 「현재 / 최대자」 글자 수 표시 — 표 input 셀과 같은 모양. 상한에 닿으면 붉게. */
function TextLengthCounter({ current, max }: { current: number; max: number }) {
  return (
    <div className="mt-1 flex justify-end px-1" data-testid="text-length-counter">
      <p className="text-xs text-gray-500">
        <span className={current >= max ? 'font-medium text-red-500' : ''}>{current}</span>
        {' / '}
        {max}자
      </p>
    </div>
  );
}

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
  // prefill·빈값 기본치는 응답자의 입력이 아니다 — 쓰기 직전에 호스트에게 알린다.
  const { markSeedWrite } = useResponseSources();
  const template = question.defaultValueTemplate ?? '';
  const isPrefilled = template.trim().length > 0;
  const prefilledValue = isPrefilled ? substituteTokens(template, attrs) : '';
  const currentValue = typeof value === 'string' ? value : '';
  const isNumberMode = question.inputType === 'number';
  const format = isInputFormat(question.inputType) ? question.inputType : null;
  // 응답 품질 검사 — 평문 모드·손대지 않은 이월 값 면제 판정은 검증 쪽 함수가 쥔다.
  // 문구는 포커스가 빠진 뒤에만(형식 검사와 같은 규칙 — 한글 조합 중 자모에 반응하지 않게).
  const { answers: priorAnswersForQuality } = usePriorAnswers();
  const focus = useFieldFocus();
  const qualityViolation = focus.focused
    ? null
    : resolveTextQualityViolation(question, currentValue, priorAnswersForQuality);
  // 입력 상한 — 표 input 셀의 inputMaxLength 와 같은 하드 캡 + 글자 수 표시. 평문 모드에서만.
  const maxLength =
    isPlainTextInput(question) && !isPrefilled ? effectiveMaxLength(question.textValidation) : null;

  const { displayValue, handleChange, handleFocus, handleBlur, unitReading, rangeViolation } =
    useFormattedNumericInput({
      rawValue: currentValue,
      onRawChange: onChange,
      numberFormat: question.numberFormat,
      enabled: isNumberMode,
    });

  // 형식 칸의 blur 정돈·위반 문구. 프리필 잠금 칸은 응답자가 못 고치므로 대상이 아니고,
  // 이월 값을 손대지 않은 칸도 대상이 아니다(prior-answers 의 면제 규칙).
  const { answers: priorAnswersForFormat } = usePriorAnswers();
  const priorHighlight = usePriorHighlight();
  const formatField = useInputFormatField({
    format,
    rawValue: currentValue,
    onRawChange: onChange,
    enabled: !isPrefilled,
    priorOriginal: priorAnswerText(priorAnswersForFormat, question.id),
  });

  // prefill 결과가 바뀔 때만 저장값을 덮어쓴다. value/onChange 는 effect event 로 실행 시점의
  // 최신값을 읽는다(표 셀 input-cell.tsx 와 동일 사유 — value 를 deps 에 넣으면 재기록 루프 위험).
  const applyPrefill = useEffectEvent(() => {
    if (isPrefilled && value !== prefilledValue) {
      markSeedWrite?.(question.id);
      onChange(prefilledValue);
    }
  });
  useEffect(() => {
    applyPrefill();
  }, [isPrefilled, prefilledValue]);

  // 숫자 모드 + emptyDefault 정의 + 토큰 prefill 아님 + 값 미존재 → 첫 진입 시 자동 채움.
  // 응답자가 지워 빈 문자열이 되면 재채움하지 않음(의도 보존).
  //
  // **이월 값이 있는 문항은 건드리지 않는다.** 이 effect 는 자식이라 부모의 이월 값
  // 프리필보다 먼저 돈다 — 여기서 기본값을 써 버리면 프리필이 "이미 값이 있다"고 보고
  // 건너뛰어, 지난 회차 값이 0 으로 조용히 바뀐 채 제출된다.
  const { answers: priorAnswersForDefault } = usePriorAnswers();
  const hasPriorValue = hasPriorAnswer(priorAnswersForDefault, question.id);
  const applyEmptyDefault = useEffectEvent(() => {
    if (
      !isPrefilled &&
      !hasPriorValue &&
      isNumberMode &&
      typeof question.emptyDefault === 'number' &&
      (value === undefined || value === null)
    ) {
      markSeedWrite?.(question.id);
      onChange(String(question.emptyDefault));
    }
  });
  useEffect(() => {
    applyEmptyDefault();
  }, [value, isPrefilled, hasPriorValue, isNumberMode, question.emptyDefault]);

  return (
    <div className="w-full">
      <Input
        type="text"
        inputMode={isNumberMode ? 'decimal' : formatField.inputMode}
        placeholder={question.placeholder || defaultPlaceholder(isNumberMode, format)}
        value={isPrefilled ? prefilledValue : displayValue}
        onChange={format ? formatField.handleChange : handleChange}
        onFocus={() => {
          handleFocus();
          formatField.handleFocus();
          focus.onFocus();
        }}
        onBlur={() => {
          handleBlur();
          formatField.handleBlur();
          focus.onBlur();
        }}
        className={`w-full text-base ${
          !isPrefilled && isPriorText(priorHighlight, question.id, currentValue)
            ? PRIOR_HIGHLIGHT_TEXT_CLS
            : ''
        }`}
        disabled={isPrefilled}
        data-prefilled={isPrefilled || undefined}
        {...(maxLength !== null ? { maxLength } : {})}
      />
      {maxLength !== null && <TextLengthCounter current={currentValue.length} max={maxLength} />}
      {(unitReading || rangeViolation || formatField.violation || qualityViolation) &&
        !isPrefilled && (
          <div className="mt-1 space-y-0.5 px-1">
            {unitReading && <p className="text-muted-foreground text-xs">{unitReading}</p>}
            {rangeViolation && <p className="text-xs text-red-500">* {rangeViolation}</p>}
            {formatField.violation && (
              <p className="text-xs text-red-500">* {formatField.violation}</p>
            )}
            {qualityViolation && (
              <p className="text-xs text-red-500" data-testid="text-quality-violation">
                * {qualityViolation.message}
              </p>
            )}
          </div>
        )}
    </div>
  );
}
