'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  Image,
  Plus,
  Settings,
  Table,
  Video,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isPartialNumericInput, parseNumericInput } from '@/utils/numeric-input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { generateId } from '@/lib/utils';
import { generateOptionCode } from '@/utils/option-code-generator';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { useSurveyUIStore } from '@/stores/ui-store';
import { isOptionListType } from '@/types/question-types';
import { Question, QuestionOption, SelectLevel } from '@/types/survey';

import { OptionPlaceholderEditor } from './option-placeholder-editor';
import { VariableButton } from './variable-button';

import { BranchRuleEditor } from './branch-rule-editor';
import { DynamicTableEditor } from './dynamic-table-editor';
import { RichTextEditor, type RichTextEditorHandle } from '@/components/ui/rich-text-editor';
import { NoticeRenderer } from './notice-renderer';
import { OptionsLayoutSelector } from './options-layout-selector';
import { RankingConfigEditorForQuestion } from './ranking-config-editor';
import { SpssVariableEditor } from './spss-variable-editor';
import { TablePreview } from './table-preview';
import { UserDefinedMultiSelectPreview } from './user-defined-multi-select';
import {
  OTHER_OPTION_ID,
  createTextInputOption,
  getParentLevelOptions,
  type OptionalOptionKey,
} from './question-option-helpers';

interface QuestionBasicTabProps {
  question: Question;
  questionId: string;
  questions: Question[];
  formData: Partial<Question>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Question>>>;
  validationErrors: Record<string, string>;
  setValidationErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  showBranchSettings: boolean;
  setShowBranchSettings: React.Dispatch<React.SetStateAction<boolean>>;
  // 로컬 title/exportLabel state (debounce 용)
  localTitle: string;
  setLocalTitle: React.Dispatch<React.SetStateAction<string>>;
  localExportLabel: string;
  setLocalExportLabel: React.Dispatch<React.SetStateAction<string>>;
  debouncedTitleRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  debouncedExportLabelRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  // option helpers
  addOption: () => void;
  updateOption: (
    optionId: string,
    updates: Partial<QuestionOption>,
    clear?: OptionalOptionKey[],
  ) => void;
  removeOption: (optionId: string) => void;
  // select level helpers
  addSelectLevel: () => void;
  updateSelectLevel: (levelId: string, updates: Partial<SelectLevel>) => void;
  removeSelectLevel: (levelId: string) => void;
  addLevelOption: (levelId: string) => void;
  updateOptionWithParent: (levelId: string, optionId: string, parentValue: string, optionLabel: string) => void;
  updateLevelOption: (levelId: string, optionId: string, updates: Partial<QuestionOption>) => void;
  removeLevelOption: (levelId: string, optionId: string) => void;
}

export function QuestionBasicTab({
  question,
  questionId,
  questions,
  formData,
  setFormData,
  validationErrors,
  setValidationErrors,
  showBranchSettings,
  setShowBranchSettings,
  localTitle,
  setLocalTitle,
  localExportLabel,
  setLocalExportLabel,
  debouncedTitleRef,
  debouncedExportLabelRef,
  addOption,
  updateOption,
  removeOption,
  addSelectLevel,
  updateSelectLevel,
  removeSelectLevel,
  addLevelOption,
  updateOptionWithParent,
  updateLevelOption,
  removeLevelOption,
}: QuestionBasicTabProps) {
  // 변수 카탈로그 (prefill 토큰용)
  const variableCatalog = useSurveyUIStore((s) => s.variableCatalog);
  const defaultTemplateRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  // 공지사항 RichTextEditor ref — unmount 시 미사용 첨부·이미지 정리에 사용
  const noticeEditorRef = useRef<RichTextEditorHandle>(null);

  // 모달 close (취소·저장) 또는 다른 질문 선택으로 unmount 될 때
  // tmp 위치에 남은 미사용 첨부·이미지를 폐기. 저장 흐름에서는 publish 단계의
  // promote 가 영구 위치로 이미 옮겼으므로 멱등 (orphan 만 정리됨).
  const cleanupNoticeEditor = useCallback(() => {
    const noticeEditor = noticeEditorRef.current;

    noticeEditor?.cleanupOrphanFileAttachments().catch(() => undefined);
    noticeEditor?.cleanupOrphanImages().catch(() => undefined);
  }, []);

  useEffect(() => cleanupNoticeEditor, [cleanupNoticeEditor]);

  // ranking + optionsSource='table' (자체 테이블 내장) 이면 수동 옵션 UI 숨김
  const isRankingTableSource =
    question.type === 'ranking' && formData.rankingConfig?.optionsSource === 'table';
  // radio/checkbox: tableColumns 가 있으면 설명 테이블 모드 (choice_opt 옵션 소스)
  const isChoiceTableMode =
    (question.type === 'radio' || question.type === 'checkbox')
    && (formData.tableColumns?.length ?? 0) > 0;
  const needsOptions =
    isOptionListType(question.type)
    && !isRankingTableSource
    && !isChoiceTableMode;
  // 자체 내장 테이블 편집기 노출 조건: table 타입 자체 OR ranking 테이블 소스 OR radio/checkbox 설명 테이블 모드
  const showTableEditor = question.type === 'table' || isRankingTableSource || isChoiceTableMode;

  // 토큰 prefill(defaultValueTemplate)이 설정되면 숫자 초기값(emptyDefault)은 비활성 — prefill 우선
  const hasTokenPrefill = (formData.defaultValueTemplate ?? '').trim().length > 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const optionIds = useMemo(
    () => (formData.options ?? []).map((o) => o.id),
    [formData.options],
  );

  const handleOptionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setFormData((prev) => {
      const options = prev.options || [];
      const oldIndex = options.findIndex((o) => o.id === active.id);
      const newIndex = options.findIndex((o) => o.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return { ...prev, options: arrayMove(options, oldIndex, newIndex) };
    });
  };
  const needsSelectLevels = question.type === 'multiselect';

  return (
    <>
      {/* 기본 정보 */}
      <div className="space-y-4">
        <div>
          <Label htmlFor="title">
            질문 제목 <span className="text-red-500">*</span>
          </Label>
          <div className="mt-2 flex items-start gap-2">
            <Input
              id="title"
              ref={titleRef}
              value={localTitle}
              onChange={(e) => {
                const value = e.target.value;
                setLocalTitle(value);
                if (validationErrors['title']) {
                  setValidationErrors((prev) => ({ ...prev, title: '' }));
                }
                // 300ms debounce 후 formData에 반영
                if (debouncedTitleRef.current) clearTimeout(debouncedTitleRef.current);
                debouncedTitleRef.current = setTimeout(() => {
                  setFormData((prev) => ({ ...prev, title: value }));
                  debouncedTitleRef.current = null;
                }, 300);
              }}
              placeholder="질문을 입력하세요"
              className={`flex-1 ${
                validationErrors['title'] ? 'border-red-500 focus:border-red-500' : ''
              }`}
            />
            {variableCatalog.length > 0 && (
              <VariableButton
                catalog={variableCatalog}
                inputRef={titleRef}
                onChange={(v) => {
                  setLocalTitle(v);
                  if (validationErrors['title']) {
                    setValidationErrors((prev) => ({ ...prev, title: '' }));
                  }
                  // 토큰 삽입은 명시적 액션이므로 debounce 우회 — 즉시 반영
                  if (debouncedTitleRef.current) {
                    clearTimeout(debouncedTitleRef.current);
                    debouncedTitleRef.current = null;
                  }
                  setFormData((prev) => ({ ...prev, title: v }));
                }}
              />
            )}
          </div>
          {validationErrors['title'] && (
            <p className="mt-1 text-sm text-red-500">{validationErrors['title']}</p>
          )}
        </div>

        {/* 응답 페이지 질문 제목 표시 토글 (빌더에는 항상 표시) */}
        <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2.5">
          <div className="pr-3">
            <Label>응답 페이지에 질문 제목 표시</Label>
            <p className="mt-0.5 text-xs text-gray-500">
              끄면 설문 응답 페이지에서 이 질문의 제목이 보이지 않습니다 (빌더에는 그대로 표시)
            </p>
          </div>
          <Switch
            checked={!formData.hideTitle}
            onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, hideTitle: !checked }))}
          />
        </div>

        {/* SPSS 변수명 및 엑셀 라벨 */}
        {(question?.type !== 'notice' || formData.requiresAcknowledgment) && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="grid grid-cols-2 gap-4">
              <SpssVariableEditor
                questionCode={formData.questionCode || ''}
                autoGeneratedCode={(() => {
                  if (question?.type === 'notice') {
                    const notices = questions
                      .filter((q) => q.type === 'notice' && q.requiresAcknowledgment)
                      .sort((a, b) => a.order - b.order);
                    const idx = notices.findIndex((q) => q.id === questionId);
                    return `N${idx + 1}`;
                  }
                  const nonNotice = questions
                    .filter((q) => q.type !== 'notice')
                    .sort((a, b) => a.order - b.order);
                  const idx = nonNotice.findIndex((q) => q.id === questionId);
                  return `Q${idx + 1}`;
                })()}
                isCustom={formData.isCustomSpssVarName || false}
                onChangeCode={(code, isCustom) =>
                  setFormData((prev) => ({
                    ...prev,
                    questionCode: code,
                    isCustomSpssVarName: isCustom,
                  }))
                }
                onReset={() => {
                  if (question?.type === 'notice') {
                    const notices = questions
                      .filter((q) => q.type === 'notice' && q.requiresAcknowledgment)
                      .sort((a, b) => a.order - b.order);
                    const idx = notices.findIndex((q) => q.id === questionId);
                    const autoCode = `N${idx + 1}`;
                    setFormData((prev) => ({
                      ...prev,
                      questionCode: autoCode,
                      isCustomSpssVarName: false,
                    }));
                    return;
                  }
                  const nonNotice = questions
                    .filter((q) => q.type !== 'notice')
                    .sort((a, b) => a.order - b.order);
                  const idx = nonNotice.findIndex((q) => q.id === questionId);
                  const autoCode = `Q${idx + 1}`;
                  setFormData((prev) => ({
                    ...prev,
                    questionCode: autoCode,
                    isCustomSpssVarName: false,
                  }));
                }}
                options={formData.options?.map((o) => ({
                  id: o.id,
                  label: o.label,
                  value: o.value,
                  spssNumericCode: o.spssNumericCode,
                }))}
                allowOtherOption={formData.allowOtherOption}
              />
              <div>
                <Label htmlFor="exportLabel">엑셀 라벨 (선택사항)</Label>
                <Input
                  id="exportLabel"
                  value={localExportLabel}
                  onChange={(e) => {
                    const value = e.target.value;
                    setLocalExportLabel(value);
                    if (debouncedExportLabelRef.current) clearTimeout(debouncedExportLabelRef.current);
                    debouncedExportLabelRef.current = setTimeout(() => {
                      setFormData((prev) => ({ ...prev, exportLabel: value }));
                      debouncedExportLabelRef.current = null;
                    }, 300);
                  }}
                  placeholder="예: 성별, TV보유현황"
                  className="mt-2"
                />
                <p className="mt-1 text-xs text-gray-500">
                  엑셀 헤더에 표시될 라벨 (미입력 시 질문 제목 사용)
                </p>
              </div>
            </div>

            {/* SPSS .sav 변수 타입 / 측정 수준 오버라이드 */}
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="spssVarType">변수 타입</Label>
                <select
                  id="spssVarType"
                  value={formData.spssVarType || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      spssVarType: (e.target.value || null) as any,
                    }))
                  }
                  className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">
                    자동 (
                    {question?.type === 'text' || question?.type === 'textarea'
                      ? 'String'
                      : question?.type === 'radio' ||
                          question?.type === 'select' ||
                          question?.type === 'checkbox'
                        ? 'Numeric'
                        : 'String'}
                    )
                  </option>
                  <option value="Numeric">Numeric</option>
                  <option value="String">String</option>
                  <option value="Date">Date</option>
                  <option value="DateTime">DateTime</option>
                </select>
              </div>
              <div>
                <Label htmlFor="spssMeasure">측정 수준</Label>
                <select
                  id="spssMeasure"
                  value={formData.spssMeasure || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      spssMeasure: (e.target.value || null) as any,
                    }))
                  }
                  className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">자동 (Nominal)</option>
                  <option value="Nominal">Nominal (명목형)</option>
                  <option value="Ordinal">Ordinal (순서형)</option>
                  <option value="Continuous">Continuous (연속형)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        <div>
          <Label htmlFor="group">그룹 선택 (선택사항)</Label>
          <select
            id="group"
            value={formData.groupId || ''}
            onChange={(e) => {
              const gid = e.target.value || undefined;
              setFormData((prev) => {
                const next: Partial<Question> = { ...prev };
                if (gid !== undefined) {
                  next.groupId = gid;
                } else {
                  delete next.groupId;
                }
                return next;
              });
            }}
            className="mt-2 w-full rounded-lg border border-gray-300 p-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
          >
            <option value="">그룹 없음</option>
            {(() => {
              const groups = useSurveyBuilderStore.getState().currentSurvey.groups || [];
              const topLevelGroups = groups
                .filter((g) => !g.parentGroupId)
                .sort((a, b) => a.order - b.order);
              const getSubGroups = (parentId: string) =>
                groups
                  .filter((g) => g.parentGroupId === parentId)
                  .sort((a, b) => a.order - b.order);

              const options: React.ReactElement[] = [];

              topLevelGroups.forEach((group) => {
                options.push(
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>,
                );

                // 하위 그룹들 추가
                const subGroups = getSubGroups(group.id);
                subGroups.forEach((subGroup) => {
                  options.push(
                    <option key={subGroup.id} value={subGroup.id}>
                      └─ {subGroup.name}
                    </option>,
                  );
                });
              });

              return options;
            })()}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            이 질문을 특정 그룹에 포함시킬 수 있습니다.
          </p>
        </div>

        <div>
          <Label htmlFor="description">설명 (선택사항)</Label>
          <div className="mt-2">
            <RichTextEditor
              kind="survey"
              initialHtml={formData.description || ''}
              onChange={(html) =>
                setFormData((prev) => ({ ...prev, description: html }))
              }
              variableCatalog={variableCatalog}
              minHeight={80}
              editorClassName="text-sm"
              placeholder="질문에 대한 추가 설명을 입력하세요..."
            />
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="required"
            checked={formData.required || false}
            onCheckedChange={(checked) =>
              setFormData((prev) => ({ ...prev, required: checked }))
            }
          />
          <Label htmlFor="required">필수 질문</Label>
        </div>

        {/* 단답형 질문용 placeholder 설정 */}
        {question.type === 'text' && (
          <>
            <div>
              <Label htmlFor="placeholder">안내 문구 (Placeholder)</Label>
              <Input
                id="placeholder"
                value={formData.placeholder || ''}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, placeholder: e.target.value }))
                }
                placeholder="예: 이름을 입력하세요"
                className="mt-2"
              />
              <p className="mt-1 text-xs text-gray-500">
                입력 필드에 표시될 안내 문구를 입력하세요
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultValueTemplate">
                응답값 prefill
                <span className="ml-1 text-xs font-normal text-gray-500">(선택)</span>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="defaultValueTemplate"
                  ref={defaultTemplateRef}
                  value={formData.defaultValueTemplate ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      defaultValueTemplate: e.target.value || null,
                    }))
                  }
                  placeholder="예: {{전시회명}}"
                  className="flex-1"
                />
                {variableCatalog.length > 0 && (
                  <VariableButton
                    catalog={variableCatalog}
                    inputRef={defaultTemplateRef}
                    onChange={(v) =>
                      setFormData((prev) => ({
                        ...prev,
                        defaultValueTemplate: v || null,
                      }))
                    }
                  />
                )}
              </div>
              <p className="text-xs text-gray-500">
                변수 토큰 사용 시 응답자에게 readonly로 표시됩니다
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex flex-col gap-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="text-input-type-number"
                    checked={formData.inputType === 'number'}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setFormData((prev) => {
                        const next: Partial<Question> = { ...prev, inputType: checked ? 'number' : 'text' };
                        if (!checked) delete next.emptyDefault;
                        return next;
                      });
                    }}
                    className="mt-0.5 h-4 w-4"
                  />
                  <label
                    htmlFor="text-input-type-number"
                    className="flex-1 cursor-pointer text-sm"
                  >
                    <span className="font-medium">숫자만 입력</span>
                    <p className="mt-0.5 text-xs text-gray-500">
                      체크 시 응답자는 숫자만 입력할 수 있고, 분기 조건(expression)에서 비교
                      연산자 (=, ≠, ≥, ≤, &gt;, &lt;) 를 사용할 수 있습니다.
                    </p>
                  </label>
                </div>

                {formData.inputType === 'number' && (
                  <div className="ml-7 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      id="text-empty-default-enabled"
                      checked={formData.emptyDefault !== undefined}
                      disabled={hasTokenPrefill}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData((prev) => {
                          const next: Partial<Question> = { ...prev };
                          if (checked) {
                            next.emptyDefault = prev.emptyDefault ?? 0;
                          } else {
                            delete next.emptyDefault;
                          }
                          return next;
                        });
                      }}
                      className="h-4 w-4"
                    />
                    <label htmlFor="text-empty-default-enabled" className="cursor-pointer">
                      응답자 입력란 초기값
                    </label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={
                        formData.emptyDefault !== undefined ? String(formData.emptyDefault) : ''
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        if (isPartialNumericInput(v)) {
                          setFormData((prev) => ({
                            ...prev,
                            emptyDefault:
                              v === '' ? 0 : (parseNumericInput(v) ?? prev.emptyDefault ?? 0),
                          }));
                        }
                      }}
                      disabled={formData.emptyDefault === undefined || hasTokenPrefill}
                      className="h-8 w-24"
                      aria-label="초기값"
                    />
                    {hasTokenPrefill && (
                      <span className="text-xs text-gray-400">토큰 prefill 사용 중 (우선)</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 순위형(ranking) 설정 — 선택 옵션 블록 위로 배치해 항상 먼저 보이도록 */}
      {question.type === 'ranking' && (
        <RankingConfigEditorForQuestion formData={formData} setFormData={setFormData} />
      )}

      {/* 설명 테이블로 보기 구성 (radio/checkbox) — 옵션 블록 위로 배치 */}
      {(question.type === 'radio' || question.type === 'checkbox') && (
        <div className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between gap-4">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Table className="h-4 w-4" />
              설명 테이블로 보기 구성
            </Label>
            <Switch
              checked={isChoiceTableMode}
              onCheckedChange={(on) => {
                if (on) {
                  setFormData((prev) => ({
                    ...prev,
                    options: [],
                    tableColumns: prev.tableColumns?.length
                      ? prev.tableColumns
                      : [
                          { id: generateId(), label: '항목' },
                          { id: generateId(), label: '선택' },
                        ],
                    tableRowsData: prev.tableRowsData?.length
                      ? prev.tableRowsData
                      : [
                          {
                            id: generateId(),
                            label: '',
                            cells: [
                              { id: generateId(), type: 'text', content: '' },
                              {
                                id: generateId(),
                                type: 'choice_opt',
                                content: '',
                                choiceLabel: '',
                              },
                            ],
                          },
                        ],
                  }));
                } else {
                  setFormData((prev) => ({
                    ...prev,
                    tableColumns: [],
                    tableRowsData: [],
                  }));
                }
              }}
            />
          </div>
          <p className="text-xs text-gray-500">
            켜면 행마다 설명을 넣고 &quot;선택&quot; 열 셀을 보기로 지정합니다. 셀을 클릭 →
            &quot;보기 옵션&quot; 탭에서 라벨/코드를 설정하세요.
          </p>
        </div>
      )}

      {/* 옵션 설정 (radio, checkbox, select) */}
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
              onChange={(next) =>
                setFormData((prev) => ({ ...prev, optionsColumns: next }))
              }
            />
          )}

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleOptionDragEnd}>
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
                    showBranchSettings={showBranchSettings}
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

      {/* 선택 개수 제한 (checkbox 타입 전용) */}
      {question?.type === 'checkbox' && (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <Label className="text-base font-medium">선택 개수 제한</Label>
          <p className="text-sm text-gray-600">
            사용자가 선택할 수 있는 최소/최대 개수를 설정할 수 있습니다.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="min-selections" className="text-sm">
                최소 선택 개수
              </Label>
              <Input
                id="min-selections"
                type="number"
                min="1"
                max={formData.options?.length || 0}
                value={formData.minSelections || ''}
                onChange={(e) => {
                  const value =
                    e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                  setFormData((prev) => {
                    const next: Partial<Question> = { ...prev };
                    if (value !== undefined) { next.minSelections = value; } else { delete next.minSelections; }
                    return next;
                  });
                  // 최소값이 최대값보다 크면 최대값 조정
                  if (
                    value !== undefined &&
                    formData.maxSelections !== undefined &&
                    value > formData.maxSelections
                  ) {
                    setFormData((prev) => ({ ...prev, maxSelections: value }));
                  }
                }}
                placeholder="제한 없음"
                className="w-full"
              />
              <p className="text-xs text-gray-500">
                {formData.options?.length || 0}개 옵션 중 최소 선택 개수
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-selections" className="text-sm">
                최대 선택 개수
              </Label>
              <Input
                id="max-selections"
                type="number"
                min={formData.minSelections ? formData.minSelections : 1}
                max={formData.options?.length || 0}
                value={formData.maxSelections || ''}
                onChange={(e) => {
                  const value =
                    e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                  setFormData((prev) => {
                    const next: Partial<Question> = { ...prev };
                    if (value !== undefined) { next.maxSelections = value; } else { delete next.maxSelections; }
                    return next;
                  });
                }}
                placeholder="제한 없음"
                className="w-full"
              />
              <p className="text-xs text-gray-500">
                {formData.options?.length || 0}개 옵션 중 최대 선택 개수
              </p>
            </div>
          </div>

          {formData.minSelections !== undefined &&
            formData.maxSelections !== undefined &&
            formData.minSelections > formData.maxSelections && (
              <p className="text-sm text-red-500">
                최소 선택 개수는 최대 선택 개수보다 작거나 같아야 합니다.
              </p>
            )}

          {formData.minSelections !== undefined &&
            formData.minSelections > (formData.options?.length || 0) && (
              <p className="text-sm text-red-500">
                최소 선택 개수는 옵션 개수보다 작거나 같아야 합니다.
              </p>
            )}

          {formData.maxSelections !== undefined &&
            formData.maxSelections > (formData.options?.length || 0) && (
              <p className="text-sm text-red-500">
                최대 선택 개수는 옵션 개수보다 작거나 같아야 합니다.
              </p>
            )}
        </div>
      )}

      {/* 다단계 Select 설정 */}
      {needsSelectLevels && (
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
                              const parentOptions = getParentLevelOptions(formData.selectLevels, index);
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
                                          <option
                                            key={parentOption.id}
                                            value={parentOption.value}
                                          >
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
                              <strong>💡 자동 연동:</strong> 하위 레벨에서 &ldquo;연동할
                              상위 옵션&rdquo;을 선택하면 한글 값이 자동 생성됩니다.
                              <br />
                              예: 상위 &ldquo;한식&rdquo; 선택 + 하위 &ldquo;김치찌개&rdquo;
                              → 값: &ldquo;한식-김치찌개&rdquo; (한글 그대로 저장)
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

              {/* 미리보기 */}
              <div className="rounded-lg bg-gray-50 p-4">
                <Label className="mb-3 block text-sm font-medium text-gray-700">
                  미리보기
                </Label>
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
      )}

      {/* 공지사항 설정 */}
      {question.type === 'notice' && (
        <div className="space-y-6">
          <div>
            <Label className="mb-3 block text-base font-medium">공지사항 내용 편집</Label>
            <RichTextEditor
              ref={noticeEditorRef}
              kind="survey"
              initialHtml={formData.noticeContent || ''}
              onChange={(html) =>
                setFormData((prev) => ({ ...prev, noticeContent: html }))
              }
              variableCatalog={variableCatalog}
              minHeight={300}
            />
          </div>

          {/* 이해 확인 체크 옵션 */}
          <div className="flex items-center space-x-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <Switch
              id="requires-acknowledgment"
              checked={formData.requiresAcknowledgment || false}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, requiresAcknowledgment: checked }))
              }
            />
            <Label htmlFor="requires-acknowledgment" className="cursor-pointer">
              이해했다는 체크 필요 (필수 확인)
            </Label>
          </div>

          {/* 미리보기 */}
          {formData.noticeContent && (
            <div className="space-y-3">
              <Label className="text-base font-medium">미리보기</Label>
              <NoticeRenderer
                content={formData.noticeContent}
                requiresAcknowledgment={formData.requiresAcknowledgment}
                isTestMode={true}
              />
            </div>
          )}
        </div>
      )}

      {/* 테이블 설정 */}
      {showTableEditor && (
        <div className="space-y-6">
          <Label className="text-lg font-medium">
            {isRankingTableSource ? '순위 옵션 테이블' : '테이블 설정'}
          </Label>

          <div className="rounded bg-blue-50 p-2 text-xs text-blue-600">
            {isRankingTableSource
              ? '💡 이 랭킹 질문 안에 표시될 설명 테이블입니다. 옵션으로 쓸 셀은 편집 모달의 "순위 옵션" 탭으로 저장하세요.'
              : '💡 테이블 질문은 매트리스(고정 행) 패턴으로 자동 설정됩니다. 엑셀 내보내기 시 각 셀의 코드가 열 이름에 반영됩니다.'}
          </div>

          <DynamicTableEditor
            tableTitle={formData.tableTitle}
            columns={formData.tableColumns}
            rows={formData.tableRowsData}
            tableHeaderGrid={formData.tableHeaderGrid}
            currentQuestionId={questionId || ''}
            questionCode={formData.questionCode}
            questionTitle={formData.title}
            dynamicRowConfigs={formData.dynamicRowConfigs}
            onTableChange={(data) => {
              setFormData((prev) => {
                const next: Partial<Question> = {
                  ...prev,
                  tableTitle: data.tableTitle,
                  tableColumns: data.tableColumns,
                  tableRowsData: data.tableRowsData,
                };
                if (data.tableHeaderGrid !== undefined) {
                  next.tableHeaderGrid = data.tableHeaderGrid;
                } else {
                  delete next.tableHeaderGrid;
                }
                return next;
              });
            }}
            onDynamicRowConfigsChange={(configs) => {
              setFormData((prev) => {
                const next: Partial<Question> = { ...prev };
                if (configs !== undefined) {
                  next.dynamicRowConfigs = configs;
                } else {
                  delete next.dynamicRowConfigs;
                }
                return next;
              });
            }}
          />

          {/* 미리보기 */}
          {formData.tableColumns && formData.tableColumns.length > 0 && (
            <div className="space-y-3">
              <Label className="text-base font-medium">미리보기</Label>
              <TablePreview
                tableTitle={formData.tableTitle}
                columns={formData.tableColumns}
                rows={formData.tableRowsData}
                tableHeaderGrid={formData.tableHeaderGrid}
                className="border-2 border-dashed border-gray-300"
                hideColumnLabels={questions.find((q) => q.id === questionId)?.hideColumnLabels}
              />
            </div>
          )}
        </div>
      )}

      {/* 미디어 설정 */}
      <div className="space-y-4">
        <Label>미디어 첨부</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex w-full items-center justify-center space-x-1 sm:w-auto"
            disabled
          >
            <Image className="h-4 w-4" />
            <span>이미지 추가</span>
            <span className="ml-1 text-xs text-gray-400">(준비 중)</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex w-full items-center justify-center space-x-1 sm:w-auto"
            disabled
          >
            <Video className="h-4 w-4" />
            <span>동영상 추가</span>
            <span className="ml-1 text-xs text-gray-400">(준비 중)</span>
          </Button>
        </div>
      </div>
    </>
  );
}

// --- Sortable Option Item ---

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
  showBranchSettings: boolean;
  questions: Question[];
  questionId: string;
}

function SortableOptionItem({
  option,
  index,
  totalCount,
  updateOption,
  removeOption,
  showBranchSettings,
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
            <Input
              value={option.label}
              onChange={(e) => updateOption(option.id, { label: e.target.value })}
              placeholder={`선택지 ${index + 1}`}
              className="h-8 border-none bg-transparent px-0 focus:border focus:border-blue-200 focus:bg-white"
            />
            {option.allowTextInput && (
              <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                주관식
              </span>
            )}
          </div>
          {option.id === OTHER_OPTION_ID && (
            <p className="mt-0.5 px-0 text-xs text-blue-600">
              기타 선택지 (수정 가능)
            </p>
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
            value={option.optionCode ?? generateOptionCode(index, totalCount)}
            onChange={(e) => updateOption(option.id, {
              optionCode: e.target.value,
              isCustomOptionCode: true,
            } as Partial<QuestionOption>)}
            className="h-8 w-16 text-center text-xs"
          />
        </div>
        {option.isCustomOptionCode && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              updateOption(option.id, { isCustomOptionCode: false }, [
                'optionCode',
              ])
            }
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

      {showBranchSettings && (
        <div className="px-3 pb-3">
          <BranchRuleEditor
            branchRule={option.branchRule}
            allQuestions={questions}
            currentQuestionId={questionId || ''}
            onChange={(branchRule) => updateOption(option.id, {
              ...(branchRule !== undefined ? { branchRule } : {}),
            } as Partial<QuestionOption>)}
          />
        </div>
      )}
    </div>
  );
}
