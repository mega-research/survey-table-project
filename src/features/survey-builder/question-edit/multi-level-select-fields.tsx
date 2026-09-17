'use client';

import { GripVertical, Plus, Settings, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AnswerQuoteTextField } from '@/features/survey-builder/answer-quote-fields';
import { getParentLevelOptions } from '@/features/survey-builder/question-option-helpers';
import { UserDefinedMultiSelectPreview } from './user-defined-multi-select';
import type { Question, QuestionOption, SelectLevel } from '@/types/survey';

interface MultiLevelSelectFieldsProps {
  formData: Partial<Question>;
  answerQuoteEnabled: boolean;
  validationErrors: Record<string, string>;
  setValidationErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  addSelectLevel: () => void;
  updateSelectLevel: (levelId: string, updates: Partial<SelectLevel>) => void;
  removeSelectLevel: (levelId: string) => void;
  addLevelOption: (levelId: string) => void;
  updateOptionWithParent: (
    levelId: string,
    optionId: string,
    parentValue: string,
    optionLabel: string,
  ) => void;
  updateLevelOption: (levelId: string, optionId: string, updates: Partial<QuestionOption>) => void;
  removeLevelOption: (levelId: string, optionId: string) => void;
}

/**
 * 질문 편집의 '다단계 Select 설정' 구획 — 단계 추가·삭제와 단계별 옵션 편집.
 * 상태와 핸들러는 question-basic-tab 이 그대로 들고 이 컴포넌트는 표시만 한다.
 */
export function MultiLevelSelectFields({
  formData,
  answerQuoteEnabled,
  validationErrors,
  setValidationErrors,
  addSelectLevel,
  updateSelectLevel,
  removeSelectLevel,
  addLevelOption,
  updateOptionWithParent,
  updateLevelOption,
  removeLevelOption,
}: MultiLevelSelectFieldsProps) {
  return (
  <div className="space-y-4">
    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
      <Label className="flex items-center space-x-2">
        <Settings className="h-4 w-4" />
        <span>
          다단계 Select 설정 <span className="text-red-500">*</span>
        </span>
      </Label>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          addSelectLevel();
          if (validationErrors['selectLevels']) {
            setValidationErrors((prev) => ({ ...prev, selectLevels: '' }));
          }
        }}
        className="flex w-full items-center space-x-1 sm:w-auto"
      >
        <Plus className="h-4 w-4" />
        <span>레벨 추가</span>
      </Button>
    </div>
    {validationErrors['selectLevels'] && (
      <p className="text-sm text-red-500">{validationErrors['selectLevels']}</p>
    )}

    {formData.selectLevels && formData.selectLevels.length > 0 ? (
      <div className="space-y-4">
        {formData.selectLevels
          .sort((a, b) => a.order - b.order)
          .map((level, index) => (
            <div key={level.id} className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-start space-x-3">
                <div className="cursor-grab">
                  <GripVertical className="h-4 w-4 text-gray-400" />
                </div>

                <div className="flex-1 space-y-4">
                  {/* 레벨 기본 정보 */}
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium text-gray-600">
                      레벨 {index + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeSelectLevel(level.id)}
                      className="h-auto p-1 text-red-500 hover:bg-red-50 hover:text-red-600"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* 레벨 설정 */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">레이블</Label>
                      <Input
                        value={level.label}
                        onChange={(e) =>
                          updateSelectLevel(level.id, { label: e.target.value })
                        }
                        placeholder="예: 카테고리"
                        className="mt-1 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">플레이스홀더</Label>
                      <Input
                        value={level.placeholder || ''}
                        onChange={(e) =>
                          updateSelectLevel(level.id, { placeholder: e.target.value })
                        }
                        placeholder="예: 카테고리를 선택하세요"
                        className="mt-1 text-sm"
                      />
                    </div>
                  </div>

                  {/* 레벨 옵션들 */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">옵션 목록</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addLevelOption(level.id)}
                        className="h-6 px-2 text-xs"
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        추가
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {level.options?.map((option, optionIndex) => {
                        const parentOptions = getParentLevelOptions(
                          formData.selectLevels,
                          index,
                        );
                        const isFirstLevel = index === 0;

                        return (
                          <div
                            key={option.id}
                            className="space-y-2 rounded-lg bg-gray-50 p-3"
                          >
                            <div className="flex items-center space-x-2">
                              <span className="w-6 text-xs text-gray-500">
                                {optionIndex + 1}.
                              </span>
                              <Input
                                value={option.label}
                                onChange={(e) =>
                                  updateLevelOption(level.id, option.id, {
                                    label: e.target.value,
                                  })
                                }
                                placeholder="옵션명 (예: 김치찌개)"
                                className="h-8 flex-1 text-xs"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeLevelOption(level.id, option.id)}
                                className="h-6 w-6 p-1 text-red-500 hover:bg-red-100 hover:text-red-600"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>

                            {!isFirstLevel && parentOptions.length > 0 && (
                              <div className="ml-8 flex items-center space-x-2">
                                <span className="min-w-fit text-xs text-gray-600">
                                  연동할 상위 옵션:
                                </span>
                                <select
                                  value={
                                    option.value.includes('-')
                                      ? option.value.split('-')[0]
                                      : ''
                                  }
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      updateOptionWithParent(
                                        level.id,
                                        option.id,
                                        e.target.value,
                                        option.label,
                                      );
                                    }
                                  }}
                                  className="h-6 flex-1 rounded border border-gray-200 bg-white px-2 text-xs"
                                >
                                  <option value="">상위 옵션 선택...</option>
                                  {parentOptions.map((parentOption) => (
                                    <option key={parentOption.id} value={parentOption.value}>
                                      {parentOption.label}
                                    </option>
                                  ))}
                                </select>
                                <div className="min-w-fit text-xs text-gray-400">
                                  → {option.value}
                                </div>
                              </div>
                            )}

                            {isFirstLevel && (
                              <div className="ml-8">
                                <div className="text-xs text-gray-400">
                                  값: {option.value}
                                </div>
                              </div>
                            )}

                            {answerQuoteEnabled && (
                              <div className="ml-8">
                                <AnswerQuoteTextField
                                  id={`answer-quote-level-option-${option.id}`}
                                  value={option.answerQuoteText}
                                  onChange={(answerQuoteText) =>
                                    updateLevelOption(level.id, option.id, {
                                      answerQuoteText,
                                    })
                                  }
                                  showInputTokenHint={option.allowTextInput === true}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {(!level.options || level.options.length === 0) && (
                        <div className="py-4 text-center text-xs text-gray-400">
                          옵션이 없습니다. 추가해주세요.
                        </div>
                      )}
                    </div>

                    {index > 0 && (
                      <div className="rounded bg-blue-50 p-2 text-xs text-blue-600">
                        <strong>💡 자동 연동:</strong> 하위 레벨에서 &ldquo;연동할 상위
                        옵션&rdquo;을 선택하면 한글 값이 자동 생성됩니다.
                        <br />
                        예: 상위 &ldquo;한식&rdquo; 선택 + 하위 &ldquo;김치찌개&rdquo; → 값:
                        &ldquo;한식-김치찌개&rdquo; (한글 그대로 저장)
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}

        {/* 미리보기 */}
        <div className="rounded-lg bg-gray-50 p-4">
          <Label className="mb-3 block text-sm font-medium text-gray-700">미리보기</Label>
          <UserDefinedMultiSelectPreview levels={formData.selectLevels} />
        </div>
      </div>
    ) : (
      <div className="rounded-lg border border-gray-200 py-8 text-center text-gray-500">
        <Settings className="mx-auto mb-2 h-8 w-8 text-gray-400" />
        <p className="mb-2">아직 레벨이 없습니다.</p>
        <Button type="button" variant="outline" onClick={addSelectLevel}>
          첫 번째 레벨 추가
        </Button>
      </div>
    )}

    <div className="rounded-lg bg-blue-50 p-3">
      <p className="text-sm text-blue-700">
        <strong>🔗 다단계 Select 기능:</strong> 카테고리 → 세부항목 같은 계층적 선택을
        제공합니다.
        <br />• 1단계: 기본 옵션들 설정 (예: 한식, 중식, 양식)
        <br />• 2단계 이상: 상위 옵션 선택으로 자동 연동 (한글 값 그대로 저장됩니다)
        <br />• 데이터 저장: 한글로 된 값들이 그대로 저장되어 분석이 쉽습니다 📊
      </p>
    </div>
  </div>
  );
}
