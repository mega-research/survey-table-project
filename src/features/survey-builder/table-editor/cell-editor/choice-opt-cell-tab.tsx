'use client';

import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import { generateId } from '@/lib/utils';
import { isInputFormat } from '@/types/input-type';
import type { InputType, NumberFormat, QuestionType } from '@/types/survey';
import { BranchRule, ChoiceGroup, Question } from '@/types/survey';
import { issueGroupKey, nextGroupKey } from '@/utils/choice-group-helpers';
import { DEFAULT_REQUIRED_MESSAGE } from '@/utils/required-message';

import { AnswerQuoteTextField } from '@/features/survey-builder/answer-quote-fields';
import { BranchRuleEditor } from '@/features/survey-builder/branch-rule-editor';
import { InputFormatSelect } from '@/features/survey-builder/input-format-select';
import { NumberFormatFields } from '@/features/survey-builder/number-format-fields';

interface ChoiceOptCellTabProps {
  choiceLabel: string;
  onChoiceLabelChange: (v: string) => void;
  spssNumericCode: number | '';
  onSpssNumericCodeChange: (v: number | '') => void;
  allowTextInput: boolean;
  onAllowTextInputChange: (v: boolean) => void;
  /** 단독 선택 보기 (CONTEXT.md) — 체크박스 그룹(또는 그룹 없는 checkbox 문항)에서만 노출 */
  exclusiveChoice: boolean;
  onExclusiveChoiceChange: (v: boolean) => void;
  /** 단독 선택 범위 — 그룹이 여럿인 표에서만 노출 */
  exclusiveScope: 'group' | 'table';
  onExclusiveScopeChange: (v: 'group' | 'table') => void;
  /** 이 셀을 품은 문항의 유형 — 그룹 없는 보기 셀이 체크박스로 그려지는지 판단한다 */
  parentQuestionType: QuestionType | undefined;
  /** 사이드카 텍스트 입력 모드 — 'number' 면 숫자만 (입력 셀과 같은 규칙) */
  textInputType: InputType;
  onTextInputTypeChange: (v: InputType) => void;
  textInputNumberFormat: NumberFormat | undefined;
  onTextInputNumberFormatChange: (v: NumberFormat | undefined) => void;
  /** 이 보기 옵션 선택 시 적용할 조건부 분기 규칙 */
  branchRule: BranchRule | undefined;
  onBranchRuleChange: (v: BranchRule | undefined) => void;
  /** 분기 대상 질문 선택용 전체 질문 목록 */
  allQuestions: Question[];
  /** 현재 질문 ID (분기 대상은 이 질문 이후만 노출) */
  currentQuestionId: string;
  /** 질문 레벨의 radio 그룹 목록 */
  choiceGroups: ChoiceGroup[];
  /** 그룹 id → 멤버 셀 수 (표시용) */
  groupMemberCounts: Record<string, number>;
  /** 현재 셀이 속한 그룹 id. 빈 문자열 = 미소속 */
  choiceGroupId: string;
  onChoiceGroupIdChange: (id: string) => void;
  onChoiceGroupsChange: (groups: ChoiceGroup[]) => void;
  /** 질문 레벨 "필수 질문" 여부 — 그룹별 필수 토글의 상속 기본값 표시용 */
  questionRequired: boolean;
  /** 질문 단위 응답 인용 토글 — 켜졌을 때만 인용 문구 입력칸을 노출한다. */
  answerQuoteEnabled?: boolean | undefined;
  answerQuoteText: string;
  onAnswerQuoteTextChange: (v: string) => void;
}

/**
 * cell-content-modal 의 '보기 옵션' (Case A choice_opt) 탭.
 * 이 셀은 질문 레벨 radio/checkbox 의 옵션 소스로 사용된다.
 */
export function ChoiceOptCellTab({
  choiceLabel,
  onChoiceLabelChange,
  spssNumericCode,
  onSpssNumericCodeChange,
  allowTextInput,
  onAllowTextInputChange,
  exclusiveChoice,
  onExclusiveChoiceChange,
  exclusiveScope,
  onExclusiveScopeChange,
  parentQuestionType,
  textInputType,
  onTextInputTypeChange,
  textInputNumberFormat,
  onTextInputNumberFormatChange,
  branchRule,
  onBranchRuleChange,
  allQuestions,
  currentQuestionId,
  choiceGroups,
  groupMemberCounts,
  choiceGroupId,
  onChoiceGroupIdChange,
  onChoiceGroupsChange,
  questionRequired,
  answerQuoteEnabled = false,
  answerQuoteText,
  onAnswerQuoteTextChange,
}: ChoiceOptCellTabProps) {
  // 현재 셀이 소속된 그룹의 type을 초기값으로 사용하고, 미소속이면 '라디오' 기본값
  const currentGroupType = choiceGroups.find((g) => g.id === choiceGroupId)?.type ?? 'radio';
  // ranking 그룹에 소속된 경우도 '라디오'로 폴백 (세그먼트에 ranking 없음)
  const initialSelectedType: 'radio' | 'checkbox' =
    currentGroupType === 'checkbox' ? 'checkbox' : 'radio';

  const [selectedType, setSelectedType] = useState<'radio' | 'checkbox'>(initialSelectedType);

  // 선택된 종류의 그룹만 드롭다운에 표시
  const filteredGroups = choiceGroups.filter((g) => g.type === selectedType);
  const nextKey = nextGroupKey(filteredGroups, selectedType);
  const currentGroup = filteredGroups.find((g) => g.id === choiceGroupId);

  function handleTypeSelect(type: 'radio' | 'checkbox') {
    if (type === selectedType) return;
    setSelectedType(type);
    // 다른 type 그룹에 남지 않도록 소속 해제
    onChoiceGroupIdChange('');
  }

  // groupKey 는 응답 저장 키라 재패딩은 응답이 존재할 수 없는 draft 에서만 허용.
  const canRepadKeys = useSurveyBuilderStore((s) => s.currentSurvey.status === 'draft');

  function handleGroupSelectChange(value: string) {
    if (value === '__new__') {
      // 순번이 10 에 도달하면 같은 종류의 기존 키를 0 패딩으로 재발번 (rad1 → rad01).
      const { key, groups: repaddedGroups } = issueGroupKey(choiceGroups, selectedType, {
        repadExisting: canRepadKeys,
      });
      const newGroup: ChoiceGroup = {
        id: generateId(),
        groupKey: key,
        type: selectedType,
        label: '',
      };
      onChoiceGroupsChange([...repaddedGroups, newGroup]);
      onChoiceGroupIdChange(newGroup.id);
    } else {
      onChoiceGroupIdChange(value);
    }
  }

  function handleGroupLabelChange(label: string) {
    if (!currentGroup) return;
    onChoiceGroupsChange(choiceGroups.map((g) => (g.id === choiceGroupId ? { ...g, label } : g)));
  }

  return (
    <div className="space-y-4">
      {/* 옵션 종류 세그먼트 — 라디오·체크박스 (순위는 ranking_opt 셀 전용으로 분리) */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">옵션 종류</Label>
        <div className="flex gap-1">
          <button
            type="button"
            aria-pressed={selectedType === 'radio'}
            onClick={() => handleTypeSelect('radio')}
            className={
              selectedType === 'radio'
                ? 'rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white'
                : 'rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200'
            }
          >
            라디오
          </button>
          <button
            type="button"
            aria-pressed={selectedType === 'checkbox'}
            onClick={() => handleTypeSelect('checkbox')}
            className={
              selectedType === 'checkbox'
                ? 'rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white'
                : 'rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200'
            }
          >
            체크박스
          </button>
        </div>
      </div>

      {/* 그룹 select + 그룹 라벨 한 줄 */}
      <div className="space-y-1.5">
        <Label htmlFor="choice-opt-group-select" className="text-sm font-medium">
          그룹
        </Label>
        <div className="flex gap-2">
          <select
            id="choice-opt-group-select"
            aria-label="그룹"
            value={choiceGroupId}
            onChange={(e) => handleGroupSelectChange(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="">(그룹 없음)</option>
            {filteredGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.groupKey}
                {g.label ? ` — ${g.label}` : ''}
                {' · 셀 '}
                {groupMemberCounts[g.id] ?? 0}
              </option>
            ))}
            <option value="__new__">+ 새 그룹 ({nextKey})</option>
          </select>
          <Input
            aria-label="그룹 라벨"
            placeholder="그룹 라벨 (그룹을 선택하세요)"
            value={currentGroup?.label ?? ''}
            disabled={!currentGroup}
            onChange={(e) => handleGroupLabelChange(e.target.value)}
            className="flex-1"
          />
        </div>
        <p className="text-xs text-gray-500">
          {selectedType === 'checkbox'
            ? '같은 그룹에서 여러 개를 선택할 수 있습니다. 그룹 라벨 수정은 그룹 전체에 반영됩니다.'
            : '같은 그룹의 셀들 중 하나만 선택됩니다. 그룹 라벨 수정은 그룹 전체에 반영됩니다.'}
        </p>
      </div>

      {/* 그룹별 필수 응답 — 미설정 시 질문 레벨 "필수 질문" 을 상속. 토글 조작은 명시값 저장 */}
      {currentGroup && (
        <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between gap-4">
            <Label className="text-sm font-medium">
              이 그룹 필수 응답 ({currentGroup.groupKey})
            </Label>
            <Switch
              checked={currentGroup.required ?? questionRequired}
              onCheckedChange={(on) =>
                onChoiceGroupsChange(
                  choiceGroups.map((g) => (g.id === choiceGroupId ? { ...g, required: on } : g)),
                )
              }
            />
          </div>
          {(currentGroup.required ?? questionRequired) && (
            <Input
              aria-label="그룹 필수 안내 문구"
              placeholder={DEFAULT_REQUIRED_MESSAGE}
              value={currentGroup.requiredMessage ?? ''}
              onChange={(e) =>
                onChoiceGroupsChange(
                  choiceGroups.map((g) =>
                    g.id === choiceGroupId ? { ...g, requiredMessage: e.target.value } : g,
                  ),
                )
              }
            />
          )}
          <p className="text-xs text-gray-500">
            끄면 이 그룹만 선택 사항이 됩니다. 문구를 비우면 질문 문구를 따릅니다. 설정은 그룹
            전체에 반영됩니다.
          </p>
        </div>
      )}

      {/* 단독 선택 보기 — 체크박스에서만 의미가 있다. 그룹이 있으면 그룹 종류, 없으면(레거시 보기
          소스 표) 문항 유형으로 판단한다. 라디오는 원래 하나만 남으니 노출하지 않는다. */}
      {(currentGroup ? currentGroup.type === 'checkbox' : parentQuestionType === 'checkbox') && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="choice-opt-exclusive" className="text-sm font-medium">
              단독 선택 보기
            </Label>
            <Switch
              id="choice-opt-exclusive"
              checked={exclusiveChoice}
              onCheckedChange={onExclusiveChoiceChange}
            />
          </div>
          <p className="text-xs text-gray-500">
            「없음 · 해당 없음 · 모름」용. 이 보기를 고르면 같은 그룹의 다른 선택이 풀리고, 다른
            보기를 고르면 이 보기가 풀립니다. 이 보기 하나로 최소 선택 수를 충족한 것으로 봅니다.
          </p>
          {/* 범위 — 그룹이 둘 이상인 표에서만 의미가 있다(하나면 둘이 같다) */}
          {exclusiveChoice && currentGroup && choiceGroups.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-gray-600">범위</span>
              <div className="inline-flex overflow-hidden rounded-md border border-gray-200">
                <button
                  type="button"
                  aria-pressed={exclusiveScope === 'group'}
                  onClick={() => onExclusiveScopeChange('group')}
                  className={`px-3 py-1 text-xs font-medium ${exclusiveScope === 'group' ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-500'}`}
                >
                  이 그룹만
                </button>
                <button
                  type="button"
                  aria-pressed={exclusiveScope === 'table'}
                  onClick={() => onExclusiveScopeChange('table')}
                  className={`border-l border-gray-200 px-3 py-1 text-xs font-medium ${exclusiveScope === 'table' ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-500'}`}
                >
                  표 전체
                </button>
              </div>
              <span className="text-xs text-gray-500">
                {exclusiveScope === 'table'
                  ? '이 표의 모든 그룹 선택이 풀리고, 필수 그룹도 전부 충족한 것으로 봅니다'
                  : '이 보기가 속한 그룹만 비웁니다'}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <Label className="text-sm font-medium">선택 시 텍스트 입력 받기</Label>
        <Switch checked={allowTextInput} onCheckedChange={onAllowTextInputChange} />
      </div>
      {allowTextInput && (
        <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
          <InputFormatSelect
            id="choice-text-format"
            value={textInputType}
            onChange={(next) => {
              onTextInputTypeChange(next);
              // 형식과 숫자 모드는 배타 — 숫자 서식을 남기지 않는다.
              if (next !== 'number') onTextInputNumberFormatChange(undefined);
            }}
          />
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="choice-text-number"
              disabled={isInputFormat(textInputType)}
              checked={textInputType === 'number'}
              onChange={(e) => onTextInputTypeChange(e.target.checked ? 'number' : 'text')}
              className="mt-0.5 h-4 w-4"
            />
            <label htmlFor="choice-text-number" className="flex-1 cursor-pointer text-sm">
              <span className="font-medium">숫자만 입력</span>
              <p className="mt-0.5 text-xs text-gray-500">
                입력 셀과 같은 규칙 — 콤마 표시·단위·최소/최대·소수 자릿수·허용값을 쓸 수 있고, SPSS
                변수도 숫자형으로 내보냅니다.
              </p>
            </label>
          </div>
          {textInputType === 'number' && (
            <NumberFormatFields
              idPrefix="choice-text-nf"
              value={textInputNumberFormat}
              onChange={onTextInputNumberFormatChange}
            />
          )}
        </div>
      )}

      {/* 옵션 라벨 + 응답값 한 줄 배치 */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">옵션 라벨 / 응답값</Label>
        <div className="flex items-start gap-2">
          <div className="flex-1 space-y-1">
            <Input
              id="choice-opt-label"
              value={choiceLabel}
              onChange={(e) => onChoiceLabelChange(e.target.value)}
              placeholder="옵션 라벨 (비워두면 셀 본문 텍스트 사용)"
            />
            <p className="text-xs text-gray-500">
              선택 열 셀은 보통 비어 있으므로(라벨이 다른 열에 있음) 분석/SPSS 라벨을 여기에
              명시하세요.
            </p>
          </div>
          <div className="w-44 space-y-1">
            <Input
              id="choice-opt-spss-code"
              type="number"
              inputMode="numeric"
              value={spssNumericCode}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') onSpssNumericCodeChange('');
                else {
                  const n = parseInt(v, 10);
                  if (!Number.isNaN(n)) onSpssNumericCodeChange(n);
                }
              }}
              placeholder="응답값 (선택)"
            />
            <p className="text-xs text-gray-500">
              SPSS 값으로 기록됩니다. 셀 순서가 바뀌어도 유지되길 원하면 명시하세요.
            </p>
          </div>
        </div>
      </div>

      {answerQuoteEnabled && (
        <AnswerQuoteTextField
          id="choice-opt-answer-quote-text"
          value={answerQuoteText}
          onChange={onAnswerQuoteTextChange}
          showInputTokenHint={allowTextInput}
        />
      )}

      <BranchRuleEditor
        {...(branchRule !== undefined ? { branchRule } : {})}
        allQuestions={allQuestions}
        currentQuestionId={currentQuestionId}
        onChange={onBranchRuleChange}
      />
    </div>
  );
}
