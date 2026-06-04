'use client';

import { Tag } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { BranchRule, Question } from '@/types/survey';

import { BranchRuleEditor } from './branch-rule-editor';

interface ChoiceOptCellTabProps {
  choiceLabel: string;
  onChoiceLabelChange: (v: string) => void;
  spssNumericCode: number | '';
  onSpssNumericCodeChange: (v: number | '') => void;
  allowTextInput: boolean;
  onAllowTextInputChange: (v: boolean) => void;
  /** 이 보기 옵션 선택 시 적용할 조건부 분기 규칙 */
  branchRule: BranchRule | undefined;
  onBranchRuleChange: (v: BranchRule | undefined) => void;
  /** 분기 대상 질문 선택용 전체 질문 목록 */
  allQuestions: Question[];
  /** 현재 질문 ID (분기 대상은 이 질문 이후만 노출) */
  currentQuestionId: string;
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
  branchRule,
  onBranchRuleChange,
  allQuestions,
  currentQuestionId,
}: ChoiceOptCellTabProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex items-start gap-2">
          <Tag className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-medium text-emerald-900">보기 옵션 소스 (Case A)</p>
            <p className="mt-1 text-xs text-emerald-700">
              이 셀은 질문(단일/복수 선택)의 보기로 사용됩니다. 응답자는 이 셀에서 선택하며,
              응답은 일반 radio/checkbox 와 동일하게 저장됩니다.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label className="text-sm font-medium">선택 시 텍스트 입력 받기</Label>
        <Switch checked={allowTextInput} onCheckedChange={onAllowTextInputChange} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="choice-opt-label" className="text-sm font-medium">
          옵션 라벨
        </Label>
        <Input
          id="choice-opt-label"
          value={choiceLabel}
          onChange={(e) => onChoiceLabelChange(e.target.value)}
          placeholder="옵션 라벨 (비워두면 셀 본문 텍스트가 사용됨)"
        />
        <p className="text-xs text-gray-500">
          선택 열 셀은 보통 비어 있으므로(라벨이 다른 열에 있음) 분석/SPSS 라벨을 여기에 명시하세요.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="choice-opt-spss-code" className="text-sm font-medium">
          응답값 (선택)
        </Label>
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
          placeholder="(비워두면 자동: 수집 순서 기반 1-based 인덱스)"
          className="w-64"
        />
        <p className="text-xs text-gray-500">
          SPSS 변수의 값으로 기록됩니다. 셀 순서가 바뀌어도 값이 유지되길 원하면 명시하세요.
        </p>
      </div>

      <BranchRuleEditor
        branchRule={branchRule}
        allQuestions={allQuestions}
        currentQuestionId={currentQuestionId}
        onChange={onBranchRuleChange}
      />
    </div>
  );
}
