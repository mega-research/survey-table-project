'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
} from '@dnd-kit/sortable';
import { Image as ImageIcon, Table, Video } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichTextEditor, type RichTextEditorHandle } from '@/components/ui/rich-text-editor';
import { Switch } from '@/components/ui/switch';
import { NoticeRenderer } from '@/features/question-renderer/notice-renderer';
import {
  AnswerQuoteQuestionControl,
  supportsAnswerQuote,
} from '@/features/survey-builder/answer-quote-fields';
import {
  type OptionalOptionKey,
} from '@/features/survey-builder/question-option-helpers';
import { MultiLevelSelectFields } from './multi-level-select-fields';
import { QuestionOptionsFields } from './question-options-fields';
import { QuestionPlaceholderFields } from './question-placeholder-fields';
import { QuestionSpssFields } from './question-spss-fields';
import { QuestionSelectionLimitFields } from './question-selection-limit-fields';
import { QuestionTableFields } from './question-table-fields';
import { RankingConfigEditorForQuestion } from '@/features/survey-builder/ranking-config-editor';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import { useSurveyUIStore } from '@/features/survey-builder/stores/ui-store';
import { VariableButton } from '@/features/survey-builder/variable-button';
import { generateId } from '@/lib/utils';
import { isOptionListType } from '@/types/question-types';
import { Question, QuestionOption, SelectLevel } from '@/types/survey';
import { commitOptionCode } from '@/utils/option-code-generator';
import { DEFAULT_REQUIRED_MESSAGE } from '@/utils/required-message';


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
  /**
   * 질문 레벨 옵션의 optionCode Input blur 커밋으로 value가 동기화되면 상위(question-edit-modal)에 통보한다.
   * 상위는 저장(Save) 시점에 이 questionId를 sourceQuestionId로 참조하는 다른 질문/그룹/
   * 행/열의 displayCondition을 remapOptionValueInConditions로 일괄 리매핑하는 데 사용한다.
   * (표 셀 옵션은 셀 저장이 곧 DB 커밋이라 셀 모달이 직접 리매핑한다 — 이 통로를 쓰지 않는다)
   */
  onOptionValueChange?: (change: { oldValue: string; newValue: string }) => void;
  // select level helpers
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

// 렌더 중 스토어 훅을 값으로 참조(useX.getState())하면 React Compiler 가 컴포넌트를 건너뛴다 — 모듈 최상위에서 읽는다.
function readBuilderGroups() {
  return useSurveyBuilderStore.getState().currentSurvey.groups || [];
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
  onOptionValueChange,
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

  // optionCode Input의 blur 커밋 후 다른 옵션과 응답값이 중복되는 옵션 id 집합 (경고 표시용)
  const [conflictOptionIds, setConflictOptionIds] = useState<Set<string>>(new Set());

  /**
   * "변수번호"(optionCode) Input의 blur 커밋 — commitOptionCode 로 value 동기화를 시도한다.
   * onChange 는 타이핑마다 optionCode 필드만 갱신(제어 컴포넌트 유지)하고, value 동기화는
   * 여기(blur)에서만 일어난다 — 타이핑 중간값이 응답 키(value)로 새는 것을 막기 위함.
   * cell-choice-editor.tsx 의 commitCode 와 동일 패턴(Task 3).
   */
  const commitOptionCodeAt = useCallback(
    (index: number, code: string) => {
      const options = formData.options ?? [];
      const target = options[index];
      if (!target) return;
      const { options: next, valueChange, conflict } = commitOptionCode(options, index, code);
      setFormData((prev) => ({ ...prev, options: next }));
      setConflictOptionIds((prev) => {
        if (prev.has(target.id) === conflict) return prev;
        const nextSet = new Set(prev);
        if (conflict) nextSet.add(target.id);
        else nextSet.delete(target.id);
        return nextSet;
      });
      if (valueChange) onOptionValueChange?.(valueChange);
    },
    [formData.options, setFormData, onOptionValueChange],
  );

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
    (question.type === 'radio' || question.type === 'checkbox') &&
    (formData.tableColumns?.length ?? 0) > 0;
  const needsOptions =
    isOptionListType(question.type) && !isRankingTableSource && !isChoiceTableMode;
  // 자체 내장 테이블 편집기 노출 조건: table 타입 자체 OR ranking 테이블 소스 OR radio/checkbox 설명 테이블 모드
  const showTableEditor = question.type === 'table' || isRankingTableSource || isChoiceTableMode;

  // 토큰 prefill(defaultValueTemplate)이 설정되면 숫자 초기값(emptyDefault)은 비활성 — prefill 우선
  const hasTokenPrefill = (formData.defaultValueTemplate ?? '').trim().length > 0;

  // 응답 인용 — 기본 꺼짐. 켜졌을 때만 옵션·셀 단위 문구 입력칸이 추가로 등장한다.
  const answerQuoteEnabled = formData.answerQuoteEnabled ?? false;
  // 표 질문은 인용 이름을 셀이 소유한다(셀 모달 헤더 토글) — 질문 레벨 토글을 함께 보이면
  // 한 기능에 토글이 둘로 보인다. supportsAnswerQuote 자체는 수집기 대상 유형과 1:1 이라
  // 건드리지 않고, 렌더 조건만 좁힌다.
  const showAnswerQuoteControl = supportsAnswerQuote(question.type) && question.type !== 'table';

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const optionIds = useMemo(() => (formData.options ?? []).map((o) => o.id), [formData.options]);

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
        <QuestionSpssFields
          question={question}
          questionId={questionId}
          questions={questions}
          formData={formData}
          setFormData={setFormData}
          localExportLabel={localExportLabel}
          setLocalExportLabel={setLocalExportLabel}
          debouncedExportLabelRef={debouncedExportLabelRef}
        />

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
              const groups = readBuilderGroups();
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
          <p className="mt-1 text-xs text-gray-500">이 질문을 특정 그룹에 포함시킬 수 있습니다.</p>
        </div>

        <div>
          <Label htmlFor="description">설명 (선택사항)</Label>
          <div className="mt-2">
            <RichTextEditor
              kind="survey"
              initialHtml={formData.description || ''}
              onChange={(html) => setFormData((prev) => ({ ...prev, description: html }))}
              variableCatalog={variableCatalog}
              minHeight={80}
              editorClassName="text-sm"
              placeholder="질문에 대한 추가 설명을 입력하세요..."
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="required"
            checked={formData.required || false}
            onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, required: checked }))}
          />
          <Label htmlFor="required" className="shrink-0">
            필수 질문
          </Label>
          {formData.required && (
            <Input
              id="requiredMessage"
              value={formData.requiredMessage ?? ''}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  requiredMessage: e.target.value || null,
                }))
              }
              placeholder={DEFAULT_REQUIRED_MESSAGE}
              className="ml-2 flex-1"
            />
          )}
        </div>

        {/* 단답형 질문용 placeholder 설정 */}
        <QuestionPlaceholderFields
          question={question}
          formData={formData}
          setFormData={setFormData}
          defaultTemplateRef={defaultTemplateRef}
          hasTokenPrefill={hasTokenPrefill}
          variableCatalog={variableCatalog}
        />

        {/* 단답형·장문형 개인정보 암호화 토글 */}
        {(question.type === 'text' || question.type === 'textarea') && (
          <div className="flex items-start space-x-2">
            <Switch
              id="pii-encrypted"
              checked={formData.piiEncrypted || false}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, piiEncrypted: checked }))
              }
            />
            <div className="space-y-1">
              <Label htmlFor="pii-encrypted">개인정보 암호화</Label>
              <p className="text-xs text-gray-500">
                성명, 전화번호, 주소 같은 개인정보 응답을 암호화해 저장합니다. 설정 저장 후 새로
                저장되는 응답값부터 암호화되며, 관리자 화면과 다운로드에서는 자동으로 복호화되어
                표시됩니다.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 응답 인용 설정 — 옵션/셀 블록 위에 두어 토글과 옵션별 문구가 한눈에 이어지도록 */}
      {showAnswerQuoteControl && (
        <AnswerQuoteQuestionControl
          enabled={answerQuoteEnabled}
          onEnabledChange={(checked) =>
            // 끌 때 옵션·셀의 문구는 지우지 않는다 — 다시 켜면 그대로 돌아와야 한다.
            setFormData((prev) => ({ ...prev, answerQuoteEnabled: checked }))
          }
          name={formData.answerQuoteName ?? ''}
          onNameChange={(name) => setFormData((prev) => ({ ...prev, answerQuoteName: name }))}
          {...(question.type === 'text'
            ? {
                questionText: {
                  value: formData.answerQuoteText,
                  onChange: (value: string) =>
                    setFormData((prev) => ({ ...prev, answerQuoteText: value })),
                },
              }
            : {})}
        />
      )}

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
      <QuestionOptionsFields
        question={question}
        questionId={questionId}
        questions={questions}
        formData={formData}
        setFormData={setFormData}
        validationErrors={validationErrors}
        setValidationErrors={setValidationErrors}
        showBranchSettings={showBranchSettings}
        setShowBranchSettings={setShowBranchSettings}
        answerQuoteEnabled={answerQuoteEnabled}
        needsOptions={needsOptions}
        sensors={sensors}
        optionIds={optionIds}
        conflictOptionIds={conflictOptionIds}
        commitOptionCodeAt={commitOptionCodeAt}
        handleOptionDragEnd={handleOptionDragEnd}
        addOption={addOption}
        updateOption={updateOption}
        removeOption={removeOption}
      />

      {/* 선택 개수 제한 (checkbox 타입 전용) */}
      <QuestionSelectionLimitFields
        question={question}
        formData={formData}
        setFormData={setFormData}
      />

      {/* 다단계 Select 설정 */}
      {needsSelectLevels && (
        <MultiLevelSelectFields
          formData={formData}
          answerQuoteEnabled={answerQuoteEnabled}
          validationErrors={validationErrors}
          setValidationErrors={setValidationErrors}
          addSelectLevel={addSelectLevel}
          updateSelectLevel={updateSelectLevel}
          removeSelectLevel={removeSelectLevel}
          addLevelOption={addLevelOption}
          updateLevelOption={updateLevelOption}
          updateOptionWithParent={updateOptionWithParent}
          removeLevelOption={removeLevelOption}
        />
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
              onChange={(html) => setFormData((prev) => ({ ...prev, noticeContent: html }))}
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
                mode="preview"
              />
            </div>
          )}
        </div>
      )}

      {/* 테이블 설정 */}
      <QuestionTableFields
        question={question}
        questionId={questionId}
        questions={questions}
        formData={formData}
        setFormData={setFormData}
        answerQuoteEnabled={answerQuoteEnabled}
        isRankingTableSource={isRankingTableSource}
        showTableEditor={showTableEditor}
      />

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
            <ImageIcon className="h-4 w-4" />
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
