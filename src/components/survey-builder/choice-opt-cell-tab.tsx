'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { BranchRule, ChoiceGroup, Question } from '@/types/survey';
import { generateId } from '@/lib/utils';
import { nextGroupKey } from '@/utils/choice-group-helpers';

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
  /** 질문 레벨의 radio 그룹 목록 */
  choiceGroups: ChoiceGroup[];
  /** 그룹 id → 멤버 셀 수 (표시용) */
  groupMemberCounts: Record<string, number>;
  /** 현재 셀이 속한 그룹 id. 빈 문자열 = 미소속 */
  choiceGroupId: string;
  onChoiceGroupIdChange: (id: string) => void;
  onChoiceGroupsChange: (groups: ChoiceGroup[]) => void;
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
  choiceGroups,
  groupMemberCounts,
  choiceGroupId,
  onChoiceGroupIdChange,
  onChoiceGroupsChange,
}: ChoiceOptCellTabProps) {
  const radioGroups = choiceGroups.filter((g) => g.type === 'radio');
  const nextKey = nextGroupKey(radioGroups, 'radio');
  const currentGroup = radioGroups.find((g) => g.id === choiceGroupId);

  function handleGroupSelectChange(value: string) {
    if (value === '__new__') {
      const key = nextGroupKey(choiceGroups, 'radio');
      const newGroup: ChoiceGroup = {
        id: generateId(),
        groupKey: key,
        type: 'radio',
        label: '',
      };
      onChoiceGroupsChange([...choiceGroups, newGroup]);
      onChoiceGroupIdChange(newGroup.id);
    } else {
      onChoiceGroupIdChange(value);
    }
  }

  function handleGroupLabelChange(label: string) {
    if (!currentGroup) return;
    onChoiceGroupsChange(
      choiceGroups.map((g) => (g.id === choiceGroupId ? { ...g, label } : g)),
    );
  }

  return (
    <div className="space-y-4">
      {/* 옵션 종류 세그먼트 — 라디오만 활성 */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">옵션 종류</Label>
        <div className="flex gap-1">
          <button
            type="button"
            aria-pressed="true"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
          >
            라디오
          </button>
          <button
            type="button"
            disabled
            title="추후 지원"
            className="cursor-not-allowed rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-400"
          >
            체크박스
          </button>
          <button
            type="button"
            disabled
            title="추후 지원"
            className="cursor-not-allowed rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-400"
          >
            순위
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
            className="flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">(그룹 없음)</option>
            {radioGroups.map((g) => (
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
          같은 그룹의 셀들 중 하나만 선택됩니다. 그룹 라벨 수정은 그룹 전체에 반영됩니다.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label className="text-sm font-medium">선택 시 텍스트 입력 받기</Label>
        <Switch checked={allowTextInput} onCheckedChange={onAllowTextInputChange} />
      </div>

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
              선택 열 셀은 보통 비어 있으므로(라벨이 다른 열에 있음) 분석/SPSS 라벨을 여기에 명시하세요.
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

      <BranchRuleEditor
        {...(branchRule !== undefined ? { branchRule } : {})}
        allQuestions={allQuestions}
        currentQuestionId={currentQuestionId}
        onChange={onBranchRuleChange}
      />
    </div>
  );
}
