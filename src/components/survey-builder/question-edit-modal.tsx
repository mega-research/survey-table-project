'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  AlertTriangle,
  CheckSquare,
  ChevronDown,
  Circle,
  Eye,
  FileText,
  Info,
  ListOrdered,
  Settings,
  Table,
  Type,
} from 'lucide-react';

import {
  createQuestion as createQuestionAction,
  updateQuestion as updateQuestionAction,
} from '@/actions/question-actions';
import { Button } from '@/components/ui/button';
import { useEnsureSurveyInDb } from '@/hooks/use-ensure-survey-in-db';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { extractImageUrlsFromQuestion } from '@/lib/image-extractor';
import { deleteImagesFromR2 } from '@/lib/image-utils';
import { isValidUUID } from '@/lib/utils';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { Question } from '@/types/survey';
import { collectRankingOptCells } from '@/utils/ranking-source';
import { useShallow } from 'zustand/react/shallow';

import { QuestionBasicTab } from './question-basic-tab';
import { QuestionConditionEditor } from './question-condition-editor';
import { TableValidationEditor } from './table-validation-editor';
import {
  createAddOption,
  createUpdateOption,
  createRemoveOption,
  createHandleOtherOptionToggle,
  createAddSelectLevel,
  createUpdateSelectLevel,
  createRemoveSelectLevel,
  createAddLevelOption,
  createUpdateOptionWithParent,
  createUpdateLevelOption,
  createRemoveLevelOption,
} from './question-option-helpers';

interface QuestionEditModalProps {
  questionId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function QuestionEditModal({ questionId, isOpen, onClose }: QuestionEditModalProps) {
  const { updateQuestion, setEditingQuestionId, silentUpdateQuestion } = useSurveyBuilderStore(
    useShallow((s) => ({
      updateQuestion: s.updateQuestion,
      setEditingQuestionId: s.setEditingQuestionId,
      silentUpdateQuestion: s.silentUpdateQuestion,
    })),
  );
  const questions = useSurveyBuilderStore(useShallow((s) => s.currentSurvey.questions));
  const question = questions.find((q) => q.id === questionId);
  const ensureSurvey = useEnsureSurveyInDb();

  const [formData, setFormData] = useState<Partial<Question>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [showBranchSettings, setShowBranchSettings] = useState(false);

  // hideColumnLabels 롤백용 refs
  const originalHideColumnLabelsRef = useRef(false);

  const didSaveRef = useRef(false);

  // ── 로컬 state: 타이핑 성능을 위해 formData와 분리 ──
  const [localTitle, setLocalTitle] = useState('');
  const [localExportLabel, setLocalExportLabel] = useState('');
  const debouncedTitleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedExportLabelRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTitleRef = useRef(localTitle);
  localTitleRef.current = localTitle;
  const localExportLabelRef = useRef(localExportLabel);
  localExportLabelRef.current = localExportLabel;

  // handleSave에서 formData를 ref로 읽기 (이벤트 리스너 체인 안정화)
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // 모달 닫힐 때 debounce 타이머 cleanup
  useEffect(() => {
    return () => {
      if (debouncedTitleRef.current) clearTimeout(debouncedTitleRef.current);
      if (debouncedExportLabelRef.current) clearTimeout(debouncedExportLabelRef.current);
    };
  }, []);

  // editingQuestionId 라이프사이클 + hideColumnLabels 롤백
  const questionIdRef = useRef(questionId);
  questionIdRef.current = questionId;
  useEffect(() => {
    if (isOpen && questionId) {
      setEditingQuestionId(questionId);
      const q = useSurveyBuilderStore.getState().currentSurvey.questions.find((q) => q.id === questionId);
      originalHideColumnLabelsRef.current = q?.hideColumnLabels ?? false;
      didSaveRef.current = false;
    }
    return () => {
      const qId = questionIdRef.current;
      if (qId) {
        if (!didSaveRef.current) {
          useSurveyBuilderStore.getState().silentUpdateQuestion(qId, { hideColumnLabels: originalHideColumnLabelsRef.current });
        }
        useSurveyBuilderStore.getState().setEditingQuestionId(null);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, questionId]);

  useEffect(() => {
    if (question) {
      // options의 각 항목과 branchRule을 깊은 복사
      const optionsWithDeepBranchRule = question.options
        ? question.options.map((option) => ({
            ...option,
            branchRule: option.branchRule
              ? {
                  ...option.branchRule,
                }
              : undefined,
          }))
        : [];

      setFormData({
        title: question.title,
        description: question.description,
        required: question.required,
        groupId: question.groupId,
        questionCode: (question as any).questionCode || '',
        isCustomSpssVarName: (question as any).isCustomSpssVarName || false,
        exportLabel: (question as any).exportLabel || '',
        tableType: (question as any).tableType,
        loopConfig: (question as any).loopConfig,
        options: optionsWithDeepBranchRule,
        selectLevels: (question as any).selectLevels ? [...(question as any).selectLevels] : [],
        tableTitle: (question as any).tableTitle,
        tableColumns: (question as any).tableColumns ? [...(question as any).tableColumns] : [],
        tableRowsData: (question as any).tableRowsData ? [...(question as any).tableRowsData] : [],
        tableHeaderGrid: (question as any).tableHeaderGrid || undefined,
        allowOtherOption: (question as any).allowOtherOption || false,
        optionsColumns: (question as any).optionsColumns,
        rankingConfig: (question as any).rankingConfig,
        minSelections: (question as any).minSelections,
        maxSelections: (question as any).maxSelections,
        noticeContent: (question as any).noticeContent || '',
        requiresAcknowledgment: (question as any).requiresAcknowledgment || false,
        placeholder: question.placeholder || '',
        defaultValueTemplate: question.defaultValueTemplate ?? null,
        tableValidationRules: (question as any).tableValidationRules || [],
        dynamicRowConfigs: (question as any).dynamicRowConfigs || undefined,
        displayCondition: question.displayCondition,
        spssVarType: (question as any).spssVarType,
        spssMeasure: (question as any).spssMeasure,
      });

      // 로컬 state 동기화 (이전 질문의 pending debounce 취소)
      if (debouncedTitleRef.current) {
        clearTimeout(debouncedTitleRef.current);
        debouncedTitleRef.current = null;
      }
      if (debouncedExportLabelRef.current) {
        clearTimeout(debouncedExportLabelRef.current);
        debouncedExportLabelRef.current = null;
      }
      setLocalTitle(question.title || '');
      setLocalExportLabel((question as any).exportLabel || '');

      // 옵션들 중 하나라도 branchRule이 있으면 조건부 분기 설정 표시
      const hasBranchRule = question.options?.some((option) => option.branchRule) || false;
      setShowBranchSettings(hasBranchRule);
    }
  }, [question]);

  // 검증 로직 (formDataRef로 최신 값 참조 — deps에서 formData 제거)
  const validateForm = useCallback(() => {
    if (!question) return false;

    const currentFormData = formDataRef.current;
    // Case 2 (ranking + optionsSource='table') 는 manual options 검증 스킵
    const isRankingTableSource =
      question.type === 'ranking' && currentFormData.rankingConfig?.optionsSource === 'table';
    const needsOptions =
      ['radio', 'checkbox', 'select', 'ranking'].includes(question.type) && !isRankingTableSource;
    const needsSelectLevels = question.type === 'multiselect';
    const errors: Record<string, string> = {};

    if (!currentFormData.title?.trim()) {
      errors.title = '질문 제목은 필수입니다.';
    }

    if (needsOptions && (!currentFormData.options || currentFormData.options.length === 0)) {
      errors.options = '최소 하나의 선택 옵션이 필요합니다.';
    }

    if (needsSelectLevels && (!currentFormData.selectLevels || currentFormData.selectLevels.length === 0)) {
      errors.selectLevels = '최소 하나의 선택 레벨이 필요합니다.';
    }

    // 질문 내장 테이블 옵션: tableRowsData 에 ranking_opt 셀이 최소 1개는 있어야 함
    if (isRankingTableSource) {
      const hasRankingOpt = collectRankingOptCells(currentFormData.tableRowsData).length > 0;
      if (!hasRankingOpt) {
        errors.rankingOptions =
          '질문 내장 테이블에 "순위 옵션" 셀이 최소 1개는 있어야 합니다. 테이블 편집기에서 옵션으로 쓸 셀을 클릭 → 셀 편집 모달의 "순위 옵션" 탭으로 저장하세요.';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [question]);

  // 저장 핸들러 (formDataRef로 최신 값 참조 — deps에서 formData 제거)
  const handleSave = useCallback(async () => {
    // debounce 중인 로컬 state를 formData에 flush
    if (debouncedTitleRef.current) {
      clearTimeout(debouncedTitleRef.current);
      debouncedTitleRef.current = null;
    }
    if (debouncedExportLabelRef.current) {
      clearTimeout(debouncedExportLabelRef.current);
      debouncedExportLabelRef.current = null;
    }
    // 로컬 state의 최신 값을 formData에 즉시 반영 (ref로 읽어 deps 분리)
    const currentTitle = localTitleRef.current;
    const currentExportLabel = localExportLabelRef.current;
    setFormData((prev) => ({ ...prev, title: currentTitle, exportLabel: currentExportLabel }));
    // formDataRef를 직접 업데이트하여 아래 로직에서 최신 값 사용
    formDataRef.current = { ...formDataRef.current, title: currentTitle, exportLabel: currentExportLabel };

    if (!questionId || !validateForm()) return;

    // store에서 hideColumnLabels 최신값 머지 (silentUpdateQuestion으로 토글한 값)
    const storeQuestion = useSurveyBuilderStore.getState()
      .currentSurvey.questions.find((q) => q.id === questionId);
    const currentFormData = { ...formDataRef.current, hideColumnLabels: storeQuestion?.hideColumnLabels };
    didSaveRef.current = true;
    setIsSaving(true);
    try {
      const updatedQuestion = {
        ...question,
        ...currentFormData,
      } as Question;
      const usedImages = extractImageUrlsFromQuestion(updatedQuestion);

      if (question) {
        const previousImages = extractImageUrlsFromQuestion(question);
        const unusedImages = previousImages.filter((url) => !usedImages.includes(url));

        if (unusedImages.length > 0) {
          await deleteImagesFromR2(unusedImages);
        }
      }

      updateQuestion(questionId, currentFormData);

      const store = useSurveyBuilderStore.getState();
      if (store.currentSurvey.id && questionId) {
        // 새 질문 판별: questionChanges.added에 있으면 아직 DB에 없는 질문
        const isNewQuestion = !!store.questionChanges.added[questionId];

        try {
          await ensureSurvey();

          if (!isNewQuestion) {
            // 기존 질문: UPDATE 경로
            const updateData = {
              ...currentFormData,
              placeholder:
                currentFormData.placeholder !== undefined ? currentFormData.placeholder : question?.placeholder,
            };
            await updateQuestionAction(questionId, updateData);
          } else {
            // 새 질문: CREATE 경로
            const createdQuestion = await createQuestionAction({
              id: questionId,
              surveyId: store.currentSurvey.id,
              groupId: question?.groupId,
              type: currentFormData.type || question?.type || 'text',
              title: currentFormData.title || question?.title || '',
              description: currentFormData.description || question?.description,
              required: currentFormData.required ?? question?.required ?? false,
              order: question?.order ?? 0,
              options: currentFormData.options || question?.options,
              selectLevels: currentFormData.selectLevels || question?.selectLevels,
              tableTitle: currentFormData.tableTitle || question?.tableTitle,
              tableColumns: currentFormData.tableColumns || question?.tableColumns,
              tableRowsData: currentFormData.tableRowsData || question?.tableRowsData,
              tableHeaderGrid: currentFormData.tableHeaderGrid ?? question?.tableHeaderGrid,
              imageUrl: currentFormData.imageUrl || question?.imageUrl,
              videoUrl: currentFormData.videoUrl || question?.videoUrl,
              allowOtherOption: currentFormData.allowOtherOption ?? question?.allowOtherOption,
              optionsColumns: currentFormData.optionsColumns ?? question?.optionsColumns,
              minSelections: currentFormData.minSelections ?? question?.minSelections,
              maxSelections: currentFormData.maxSelections ?? question?.maxSelections,
              noticeContent: currentFormData.noticeContent || question?.noticeContent,
              requiresAcknowledgment:
                currentFormData.requiresAcknowledgment ?? question?.requiresAcknowledgment,
              placeholder:
                currentFormData.placeholder !== undefined ? currentFormData.placeholder : question?.placeholder,
              tableValidationRules: currentFormData.tableValidationRules || question?.tableValidationRules,
              displayCondition: currentFormData.displayCondition || question?.displayCondition,
              dynamicRowConfigs: currentFormData.dynamicRowConfigs || question?.dynamicRowConfigs,
              rankingConfig: currentFormData.rankingConfig || question?.rankingConfig,
              questionCode: currentFormData.questionCode || question?.questionCode,
              isCustomSpssVarName: currentFormData.isCustomSpssVarName ?? question?.isCustomSpssVarName,
              exportLabel: currentFormData.exportLabel || question?.exportLabel,
              spssVarType: currentFormData.spssVarType ?? question?.spssVarType,
              spssMeasure: currentFormData.spssMeasure ?? question?.spssMeasure,
            });

            if (createdQuestion?.id) {
              // DB에 생성 완료 → added에서 제거 (다음 모달 저장 시 UPDATE 경로 사용)
              const { [questionId]: _, ...remainingAdded } = useSurveyBuilderStore.getState().questionChanges.added;
              useSurveyBuilderStore.setState((state) => ({
                questionChanges: {
                  ...state.questionChanges,
                  added: remainingAdded,
                },
              }));
            }
            if (createdQuestion?.id && createdQuestion.id !== questionId) {
              const newId = createdQuestion.id;
              useSurveyBuilderStore.setState((state) => ({
                currentSurvey: {
                  ...state.currentSurvey,
                  questions: state.currentSurvey.questions.map((q) =>
                    q.id === questionId ? { ...q, id: newId } : q,
                  ),
                },
              }));
            }
          }
        } catch (error) {
          console.error('질문 저장/업데이트 실패:', error);
        }
      }

      onClose();
    } catch (error) {
      console.error('저장 중 오류가 발생했습니다:', error);
    } finally {
      setIsSaving(false);
    }
  }, [questionId, validateForm, updateQuestion, onClose, question]);

  // 키보드 이벤트 핸들러
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSave();
      }
    },
    [onClose, handleSave],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  // Option helpers (setFormData를 바인딩, useMemo로 안정화하여 자식 리렌더 방지)
  const addOption = useMemo(() => createAddOption(setFormData), []);
  const updateOption = useMemo(() => createUpdateOption(setFormData), []);
  const removeOption = useMemo(() => createRemoveOption(setFormData), []);
  const handleOtherOptionToggle = useMemo(() => createHandleOtherOptionToggle(setFormData), []);
  const addSelectLevel = useMemo(() => createAddSelectLevel(setFormData), []);
  const updateSelectLevel = useMemo(() => createUpdateSelectLevel(setFormData), []);
  const removeSelectLevel = useMemo(() => createRemoveSelectLevel(setFormData), []);
  const addLevelOption = useMemo(() => createAddLevelOption(setFormData), []);
  const updateOptionWithParent = useMemo(() => createUpdateOptionWithParent(setFormData), []);
  const updateLevelOption = useMemo(() => createUpdateLevelOption(setFormData), []);
  const removeLevelOption = useMemo(() => createRemoveLevelOption(setFormData), []);

  if (!question) return null;

  // 모달 크기 결정 (테이블 편집시 큰 화면 사용)
  const isTableType = question.type === 'table';
  const modalSize = isTableType ? 'max-w-6xl' : 'max-w-3xl';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        // X 버튼이나 ESC만 닫기 가능 (배경 클릭은 onInteractOutside에서 막음)
        if (!open && !isSaving) {
          onClose();
        }
      }}
    >
      <DialogContent
        className={`${modalSize} flex max-h-[95vh] flex-col p-0`}
        onInteractOutside={(e) => {
          e.preventDefault();
        }}
      >
        {/* 고정 헤더 */}
        <DialogHeader className="flex-shrink-0 border-b border-gray-200 px-6 py-4">
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {getQuestionTypeIcon(question.type)}
              <span>{getQuestionTypeLabel(question.type)} 편집</span>
            </div>
            {/* 키보드 단축키 안내 */}
            <div className="hidden items-center space-x-4 text-xs text-gray-500 sm:flex">
              <span>저장: Ctrl+S</span>
              <span>닫기: ESC</span>
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* 스크롤 가능한 본문 */}
        <div className="flex-1 overflow-y-auto">
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="w-full justify-start rounded-none border-b px-6">
              <TabsTrigger value="basic" className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                기본 설정
              </TabsTrigger>
              {isTableType && (
                <TabsTrigger value="validation" className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  검증 규칙
                </TabsTrigger>
              )}
              <TabsTrigger value="display-condition" className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                표시 조건
              </TabsTrigger>
            </TabsList>

            {/* 기본 설정 탭 */}
            <TabsContent value="basic" className="space-y-6 px-6 py-4">
              <QuestionBasicTab
                question={question}
                questionId={questionId || ''}
                questions={questions}
                formData={formData}
                setFormData={setFormData}
                validationErrors={validationErrors}
                setValidationErrors={setValidationErrors}
                showBranchSettings={showBranchSettings}
                setShowBranchSettings={setShowBranchSettings}
                localTitle={localTitle}
                setLocalTitle={setLocalTitle}
                localExportLabel={localExportLabel}
                setLocalExportLabel={setLocalExportLabel}
                debouncedTitleRef={debouncedTitleRef}
                debouncedExportLabelRef={debouncedExportLabelRef}
                addOption={addOption}
                updateOption={updateOption}
                removeOption={removeOption}
                handleOtherOptionToggle={handleOtherOptionToggle}
                addSelectLevel={addSelectLevel}
                updateSelectLevel={updateSelectLevel}
                removeSelectLevel={removeSelectLevel}
                addLevelOption={addLevelOption}
                updateOptionWithParent={updateOptionWithParent}
                updateLevelOption={updateLevelOption}
                removeLevelOption={removeLevelOption}
              />
            </TabsContent>

            {/* 검증 규칙 탭 (테이블 타입만) */}
            {isTableType && (
              <TabsContent value="validation" className="px-6 py-4">
                <TableValidationEditor
                  question={question}
                  onUpdate={(rules) =>
                    setFormData((prev) => ({ ...prev, tableValidationRules: rules }))
                  }
                  allQuestions={questions}
                />
              </TabsContent>
            )}

            {/* 표시 조건 탭 */}
            <TabsContent value="display-condition" className="px-6 py-4">
              <QuestionConditionEditor
                question={question}
                onUpdate={async (conditionGroup) => {
                  setFormData((prev) => ({ ...prev, displayCondition: conditionGroup }));

                  // 조건 변경 시 즉시 DB에 저장 (질문 ID가 UUID이고 이미 DB에 존재하는 경우에만)
                  const store = useSurveyBuilderStore.getState();
                  const isNewQuestion = !!store.questionChanges.added[questionId || ''];
                  if (questionId && store.currentSurvey.id && isValidUUID(questionId) && !isNewQuestion) {
                    try {
                      await updateQuestionAction(questionId, {
                        displayCondition: conditionGroup,
                      });
                    } catch (error) {
                      console.error('조건 저장 실패:', error);
                    }
                  }
                }}
                allQuestions={questions}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* 고정 푸터 (액션 버튼) */}
        <div className="flex-shrink-0 border-t border-gray-200 bg-gray-50 px-6 py-4">
          <div className="flex items-center justify-between">
            {/* 저장 상태 표시 */}
            <div className="flex items-center text-sm text-gray-600">
              {isSaving && (
                <div className="flex items-center space-x-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-blue-600"></div>
                  <span>저장 중...</span>
                </div>
              )}
              {Object.keys(validationErrors).length > 0 && !isSaving && (
                <div className="space-y-0.5">
                  <div className="text-sm font-medium text-red-600">입력 정보를 확인해주세요</div>
                  {Object.entries(validationErrors).map(([key, msg]) => (
                    <div key={key} className="text-xs text-red-600">
                      • {msg}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 액션 버튼 */}
            <div className="flex space-x-2">
              <Button variant="outline" onClick={onClose} disabled={isSaving}>
                취소
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || Object.keys(validationErrors).length > 0}
                className="min-w-[80px]"
              >
                {isSaving ? (
                  <div className="flex items-center space-x-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                    <span>저장</span>
                  </div>
                ) : (
                  '저장'
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getQuestionTypeIcon(type: string) {
  const icons = {
    notice: Info,
    text: Type,
    textarea: FileText,
    radio: Circle,
    checkbox: CheckSquare,
    select: ChevronDown,
    multiselect: Settings,
    ranking: ListOrdered,
    table: Table,
  };
  const IconComponent = icons[type as keyof typeof icons] || Type;
  return <IconComponent className="h-5 w-5" />;
}

function getQuestionTypeLabel(type: string): string {
  const labels = {
    notice: '공지사항',
    text: '단답형',
    textarea: '장문형',
    radio: '단일선택',
    checkbox: '다중선택',
    select: '드롭다운',
    multiselect: '다단계선택',
    ranking: '순위형',
    table: '테이블',
  };
  return labels[type as keyof typeof labels] || type;
}
