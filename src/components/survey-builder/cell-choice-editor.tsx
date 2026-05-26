'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { generateId } from '@/lib/utils';
import { getMaxSpssCode } from '@/utils/option-code-generator';
import { CheckboxOption, Question, QuestionOption, RadioOption } from '@/types/survey';

import { BranchRuleEditor } from './branch-rule-editor';
import { OptionPlaceholderEditor } from './option-placeholder-editor';
import { createTextInputOption } from './question-option-helpers';

// OTHER_OPTION_ID: 미리보기에서 기존 기타 옵션 구별용 (읽기 전용, Phase 7 cleanup 대상)
const OTHER_OPTION_ID = 'other-option';

// --- Props ---

export interface CellChoiceEditorProps {
  cellType: 'checkbox' | 'radio' | 'select';
  /** 공통 셀 텍스트 내용 (미리보기에 사용) */
  textContent: string;
  /** 현재 질문 ID (분기 규칙용) */
  currentQuestionId: string;
  /** 전체 질문 목록 (분기 규칙용) */
  questions: Question[];

  // checkbox
  checkboxOptions: CheckboxOption[];
  onCheckboxOptionsChange: (options: CheckboxOption[]) => void;

  // radio
  radioOptions: RadioOption[];
  onRadioOptionsChange: (options: RadioOption[]) => void;
  radioGroupName: string;
  onRadioGroupNameChange: (name: string) => void;

  // select
  selectOptions: QuestionOption[];
  onSelectOptionsChange: (options: QuestionOption[]) => void;

  // checkbox 전용: 선택 개수 제한
  minSelections: number | undefined;
  onMinSelectionsChange: (v: number | undefined) => void;
  maxSelections: number | undefined;
  onMaxSelectionsChange: (v: number | undefined) => void;
}

export function CellChoiceEditor({
  cellType,
  textContent,
  currentQuestionId,
  questions,
  checkboxOptions,
  onCheckboxOptionsChange,
  radioOptions,
  onRadioOptionsChange,
  radioGroupName,
  onRadioGroupNameChange,
  selectOptions,
  onSelectOptionsChange,
  minSelections,
  onMinSelectionsChange,
  maxSelections,
  onMaxSelectionsChange,
}: CellChoiceEditorProps) {
  // 조건부 분기 토글 상태 (이 컴포넌트 내부에서만 사용)
  const [showBranchSettings, setShowBranchSettings] = useState(false);

  // --- checkbox ---
  if (cellType === 'checkbox') {
    return (
      <div className="space-y-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>체크박스 옵션 관리</Label>
            <div className="flex items-center space-x-2">
              <Switch
                id="checkbox-show-branch"
                checked={showBranchSettings}
                onCheckedChange={setShowBranchSettings}
                className="scale-75"
              />
              <Label htmlFor="checkbox-show-branch" className="text-xs text-gray-600">
                조건부 분기
              </Label>
            </div>
          </div>

          <div className="max-h-[300px] space-y-3 overflow-y-auto pr-2">
            {checkboxOptions.map((option, index) => (
              <div key={option.id} className="overflow-hidden rounded-lg border border-gray-200">
                <div className="flex items-center gap-2 p-3">
                  <input
                    type="checkbox"
                    checked={option.checked || false}
                    onChange={(e) => {
                      const updated = [...checkboxOptions];
                      updated[index] = { ...option, checked: e.target.checked };
                      onCheckboxOptionsChange(updated);
                    }}
                    className="rounded"
                  />
                  <div className="flex-1 space-y-1">
                    <div className="flex gap-2">
                      <Input
                        value={option.label}
                        onChange={(e) => {
                          const updated = [...checkboxOptions];
                          updated[index] = { ...option, label: e.target.value };
                          onCheckboxOptionsChange(updated);
                        }}
                        placeholder="옵션 텍스트"
                        className="flex-1"
                      />
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[10px] text-gray-400">응답값</span>
                        <Input
                          inputMode="numeric"
                          value={option.spssNumericCode ?? ''}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, '');
                            const updated = [...checkboxOptions];
                            updated[index] = { ...option, spssNumericCode: v ? parseInt(v, 10) : undefined };
                            onCheckboxOptionsChange(updated);
                          }}
                          placeholder={String(index + 1)}
                          className="w-14 text-center text-xs placeholder:text-gray-300"
                        />
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[10px] text-gray-400">변수번호</span>
                        <Input
                          value={option.optionCode || ''}
                          onChange={(e) => {
                            const updated = [...checkboxOptions];
                            updated[index] = { ...option, optionCode: e.target.value };
                            onCheckboxOptionsChange(updated);
                          }}
                          placeholder="코드"
                          className="w-20 text-xs"
                        />
                      </div>
                    </div>
                    {option.id === OTHER_OPTION_ID && (
                      <p className="text-xs text-blue-600">🔹 기타 옵션 (수정 가능)</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onCheckboxOptionsChange(checkboxOptions.filter((_, i) => i !== index));
                    }}
                    className="text-red-500 hover:text-red-700"
                  >
                    삭제
                  </Button>
                </div>

                {option.allowTextInput && (
                  <OptionPlaceholderEditor
                    value={option.textInputPlaceholder}
                    onChange={(next) => {
                      const updated = [...checkboxOptions];
                      updated[index] = { ...option, textInputPlaceholder: next };
                      onCheckboxOptionsChange(updated);
                    }}
                  />
                )}

                {showBranchSettings && (
                  <div className="px-3 pb-3">
                    <BranchRuleEditor
                      branchRule={option.branchRule}
                      allQuestions={questions}
                      currentQuestionId={currentQuestionId}
                      onChange={(branchRule) => {
                        const updated = [...checkboxOptions];
                        updated[index] = { ...option, branchRule };
                        onCheckboxOptionsChange(updated);
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const newOption: CheckboxOption = {
                  id: generateId(),
                  label: '새 옵션',
                  value: `option-${checkboxOptions.length + 1}`,
                  checked: false,
                  spssNumericCode: getMaxSpssCode(checkboxOptions) + 1,
                };
                onCheckboxOptionsChange([...checkboxOptions, newOption]);
              }}
              className="flex-1"
            >
              옵션 추가
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const newOption = createTextInputOption(checkboxOptions) as CheckboxOption;
                onCheckboxOptionsChange([...checkboxOptions, newOption]);
              }}
              className="flex-1"
            >
              + 텍스트 옵션 추가
            </Button>
          </div>
        </div>

        {/* 선택 개수 제한 */}
        {checkboxOptions.length > 0 && (
          <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <Label className="text-base font-medium">선택 개수 제한</Label>
            <p className="text-sm text-gray-600">
              사용자가 선택할 수 있는 최소/최대 개수를 설정할 수 있습니다.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cell-min-selections" className="text-sm">
                  최소 선택 개수
                </Label>
                <Input
                  id="cell-min-selections"
                  type="number"
                  min="1"
                  max={checkboxOptions.length}
                  value={minSelections || ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                    onMinSelectionsChange(value);
                    if (value !== undefined && maxSelections !== undefined && value > maxSelections) {
                      onMaxSelectionsChange(value);
                    }
                  }}
                  placeholder="제한 없음"
                  className="w-full"
                />
                <p className="text-xs text-gray-500">
                  {checkboxOptions.length}개 옵션 중 최소 선택 개수
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cell-max-selections" className="text-sm">
                  최대 선택 개수
                </Label>
                <Input
                  id="cell-max-selections"
                  type="number"
                  min={minSelections ? minSelections : 1}
                  max={checkboxOptions.length}
                  value={maxSelections || ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                    onMaxSelectionsChange(value);
                  }}
                  placeholder="제한 없음"
                  className="w-full"
                />
                <p className="text-xs text-gray-500">
                  {checkboxOptions.length}개 옵션 중 최대 선택 개수
                </p>
              </div>
            </div>

            {minSelections !== undefined &&
              maxSelections !== undefined &&
              minSelections > maxSelections && (
                <p className="text-sm text-red-500">
                  최소 선택 개수는 최대 선택 개수보다 작거나 같아야 합니다.
                </p>
              )}

            {minSelections !== undefined && minSelections > checkboxOptions.length && (
              <p className="text-sm text-red-500">
                최소 선택 개수는 옵션 개수보다 작거나 같아야 합니다.
              </p>
            )}

            {maxSelections !== undefined && maxSelections > checkboxOptions.length && (
              <p className="text-sm text-red-500">
                최대 선택 개수는 옵션 개수보다 작거나 같아야 합니다.
              </p>
            )}
          </div>
        )}

        {checkboxOptions.length > 0 && (
          <div className="space-y-2">
            <Label>미리보기</Label>
            <div className="max-h-[150px] overflow-y-auto rounded-md border bg-gray-50 p-3">
              {textContent && textContent.trim() && (
                <div className="mb-3 border-b border-gray-200 pb-2 text-sm font-medium break-words whitespace-pre-wrap text-gray-700">
                  {textContent}
                </div>
              )}
              <div className="space-y-2">
                {checkboxOptions.map((option) => (
                  <div key={option.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={option.checked || false} readOnly className="rounded" />
                    <span className="text-sm">{option.label}</span>
                    {option.id === OTHER_OPTION_ID && (
                      <span className="ml-2 text-xs text-blue-600">(텍스트 입력)</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- radio ---
  if (cellType === 'radio') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="radio-group-name">라디오 그룹명</Label>
          <Input
            id="radio-group-name"
            value={radioGroupName}
            onChange={(e) => onRadioGroupNameChange(e.target.value)}
            placeholder="라디오 버튼 그룹명 (예: payment-type)"
          />
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>라디오 버튼 옵션 관리</Label>
            <div className="flex items-center space-x-2">
              <Switch
                id="radio-show-branch"
                checked={showBranchSettings}
                onCheckedChange={setShowBranchSettings}
                className="scale-75"
              />
              <Label htmlFor="radio-show-branch" className="text-xs text-gray-600">
                조건부 분기
              </Label>
            </div>
          </div>

          <div className="max-h-[300px] space-y-3 overflow-y-auto pr-2">
            {radioOptions.map((option, index) => (
              <div key={option.id} className="overflow-hidden rounded-lg border border-gray-200">
                <div className="flex items-center gap-2 p-3">
                  <input
                    type="radio"
                    name="preview-radio"
                    checked={option.selected || false}
                    onChange={(e) => {
                      if (e.target.checked) {
                        const updated = radioOptions.map((opt, i) => ({
                          ...opt,
                          selected: i === index,
                        }));
                        onRadioOptionsChange(updated);
                      }
                    }}
                  />
                  <div className="flex-1 space-y-1">
                    <div className="flex gap-2">
                      <Input
                        value={option.label}
                        onChange={(e) => {
                          const updated = [...radioOptions];
                          updated[index] = { ...option, label: e.target.value };
                          onRadioOptionsChange(updated);
                        }}
                        placeholder="옵션 텍스트"
                        className="flex-1"
                      />
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[10px] text-gray-400">응답값</span>
                        <Input
                          inputMode="numeric"
                          value={option.spssNumericCode ?? ''}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, '');
                            const updated = [...radioOptions];
                            updated[index] = { ...option, spssNumericCode: v ? parseInt(v, 10) : undefined };
                            onRadioOptionsChange(updated);
                          }}
                          placeholder={String(index + 1)}
                          className="w-14 text-center text-xs placeholder:text-gray-300"
                        />
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[10px] text-gray-400">변수번호</span>
                        <Input
                          value={option.optionCode || ''}
                          onChange={(e) => {
                            const updated = [...radioOptions];
                            updated[index] = { ...option, optionCode: e.target.value };
                            onRadioOptionsChange(updated);
                          }}
                          placeholder="코드"
                          className="w-20 text-xs"
                        />
                      </div>
                    </div>
                    {option.id === OTHER_OPTION_ID && (
                      <p className="text-xs text-blue-600">🔹 기타 옵션 (수정 가능)</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onRadioOptionsChange(radioOptions.filter((_, i) => i !== index));
                    }}
                    className="text-red-500 hover:text-red-700"
                  >
                    삭제
                  </Button>
                </div>

                {option.allowTextInput && (
                  <OptionPlaceholderEditor
                    value={option.textInputPlaceholder}
                    onChange={(next) => {
                      const updated = [...radioOptions];
                      updated[index] = { ...option, textInputPlaceholder: next };
                      onRadioOptionsChange(updated);
                    }}
                  />
                )}

                {showBranchSettings && (
                  <div className="px-3 pb-3">
                    <BranchRuleEditor
                      branchRule={option.branchRule}
                      allQuestions={questions}
                      currentQuestionId={currentQuestionId}
                      onChange={(branchRule) => {
                        const updated = [...radioOptions];
                        updated[index] = { ...option, branchRule };
                        onRadioOptionsChange(updated);
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const newOption: RadioOption = {
                  id: generateId(),
                  label: '새 옵션',
                  value: `option-${radioOptions.length + 1}`,
                  selected: false,
                  spssNumericCode: getMaxSpssCode(radioOptions) + 1,
                };
                onRadioOptionsChange([...radioOptions, newOption]);
              }}
              className="flex-1"
            >
              옵션 추가
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const newOption = createTextInputOption(radioOptions) as RadioOption;
                onRadioOptionsChange([...radioOptions, newOption]);
              }}
              className="flex-1"
            >
              + 텍스트 옵션 추가
            </Button>
          </div>
        </div>
        {radioOptions.length > 0 && (
          <div className="space-y-2">
            <Label>미리보기</Label>
            <div className="max-h-[150px] overflow-y-auto rounded-md border bg-gray-50 p-3">
              {textContent && textContent.trim() && (
                <div className="mb-3 border-b border-gray-200 pb-2 text-sm font-medium break-words whitespace-pre-wrap text-gray-700">
                  {textContent}
                </div>
              )}
              <div className="space-y-2">
                {radioOptions.map((option) => (
                  <div key={option.id} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="preview-radio-display"
                      checked={option.selected || false}
                      readOnly
                    />
                    <span className="text-sm">{option.label}</span>
                    {option.id === OTHER_OPTION_ID && (
                      <span className="ml-2 text-xs text-blue-600">(텍스트 입력)</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- select ---
  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>Select 옵션 관리</Label>
          <div className="flex items-center space-x-2">
            <Switch
              id="select-show-branch"
              checked={showBranchSettings}
              onCheckedChange={setShowBranchSettings}
              className="scale-75"
            />
            <Label htmlFor="select-show-branch" className="text-xs text-gray-600">
              조건부 분기
            </Label>
          </div>
        </div>

        <div className="max-h-[300px] space-y-3 overflow-y-auto pr-2">
          {selectOptions.map((option, index) => (
            <div key={option.id} className="overflow-hidden rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 p-3">
                <div className="flex-1 space-y-1">
                  <div className="flex gap-2">
                    <Input
                      value={option.label}
                      onChange={(e) => {
                        const updated = [...selectOptions];
                        updated[index] = { ...option, label: e.target.value };
                        onSelectOptionsChange(updated);
                      }}
                      placeholder="옵션 텍스트"
                      className="flex-1"
                    />
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[10px] text-gray-400">응답값</span>
                      <Input
                        inputMode="numeric"
                        value={option.spssNumericCode ?? ''}
                        onChange={(e) => {
                          const v = e.target.value.replace(/\D/g, '');
                          const updated = [...selectOptions];
                          updated[index] = { ...option, spssNumericCode: v ? parseInt(v, 10) : undefined };
                          onSelectOptionsChange(updated);
                        }}
                        placeholder={String(index + 1)}
                        className="w-14 text-center text-xs placeholder:text-gray-300"
                      />
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[10px] text-gray-400">변수번호</span>
                      <Input
                        value={option.optionCode || ''}
                        onChange={(e) => {
                          const updated = [...selectOptions];
                          updated[index] = { ...option, optionCode: e.target.value };
                          onSelectOptionsChange(updated);
                        }}
                        placeholder="코드"
                        className="w-20 text-xs"
                      />
                    </div>
                  </div>
                  {option.id === OTHER_OPTION_ID && (
                    <p className="text-xs text-blue-600">🔹 기타 옵션 (수정 가능)</p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onSelectOptionsChange(selectOptions.filter((_, i) => i !== index));
                  }}
                  className="text-red-500 hover:text-red-700"
                >
                  삭제
                </Button>
              </div>

              {option.allowTextInput && (
                <OptionPlaceholderEditor
                  value={option.textInputPlaceholder}
                  onChange={(next) => {
                    const updated = [...selectOptions];
                    updated[index] = { ...option, textInputPlaceholder: next };
                    onSelectOptionsChange(updated);
                  }}
                />
              )}

              {showBranchSettings && (
                <div className="px-3 pb-3">
                  <BranchRuleEditor
                    branchRule={option.branchRule}
                    allQuestions={questions}
                    currentQuestionId={currentQuestionId}
                    onChange={(branchRule) => {
                      const updated = [...selectOptions];
                      updated[index] = { ...option, branchRule };
                      onSelectOptionsChange(updated);
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const newOption: QuestionOption = {
                id: generateId(),
                label: '새 옵션',
                value: `option-${selectOptions.length + 1}`,
                spssNumericCode: getMaxSpssCode(selectOptions) + 1,
              };
              onSelectOptionsChange([...selectOptions, newOption]);
            }}
            className="flex-1"
          >
            옵션 추가
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const newOption = createTextInputOption(selectOptions);
              onSelectOptionsChange([...selectOptions, newOption]);
            }}
            className="flex-1"
          >
            + 텍스트 옵션 추가
          </Button>
        </div>
      </div>
      {selectOptions.length > 0 && (
        <div className="space-y-2">
          <Label>미리보기</Label>
          <div className="rounded-md border bg-gray-50 p-3">
            {textContent && textContent.trim() && (
              <div className="mb-3 border-b border-gray-200 pb-2 text-sm font-medium break-words whitespace-pre-wrap text-gray-700">
                {textContent}
              </div>
            )}
            <select className="w-full rounded border p-2">
              <option value="">선택하세요...</option>
              {selectOptions.map((option) => (
                <option key={option.id} value={option.value}>
                  {option.label}
                  {option.id === OTHER_OPTION_ID && ' (텍스트 입력)'}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
