'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { toast } from 'sonner';

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
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CompleteQuestionWrite } from '@/db/schema/question-persisted-fields';
import { useEnsureSurveyInDb } from '@/hooks/use-ensure-survey-in-db';
import { useSurveySync } from '@/hooks/use-survey-sync';
import { isValidUUID } from '@/lib/utils';
import { client } from '@/shared/lib/rpc';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { useSurveyUIStore } from '@/stores/ui-store';
import { isOptionListType } from '@/types/question-types';
import { Question } from '@/types/survey';
import { collectChoiceOptCells, resolveChoiceOptions } from '@/utils/choice-source';
import { collectRankingOptCells } from '@/utils/ranking-source';

import { QuestionBasicTab } from './question-basic-tab';
import { QuestionConditionEditor } from './question-condition-editor';
import {
  createAddLevelOption,
  createAddOption,
  createAddSelectLevel,
  createRemoveLevelOption,
  createRemoveOption,
  createRemoveSelectLevel,
  createUpdateLevelOption,
  createUpdateOption,
  createUpdateOptionWithParent,
  createUpdateSelectLevel,
} from './question-option-helpers';
import { SumConstraintEditor } from './sum-constraint-editor';
import { TableValidationEditor } from './table-validation-editor';

interface QuestionEditModalProps {
  questionId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function QuestionEditModal({ questionId, isOpen, onClose }: QuestionEditModalProps) {
  const updateQuestion = useSurveyBuilderStore((s) => s.updateQuestion);
  const remapOptionValueInConditions = useSurveyBuilderStore(
    (s) => s.remapOptionValueInConditions,
  );
  const remapQuestionRefs = useSurveyBuilderStore((s) => s.remapQuestionRefs);
  const setEditingQuestionId = useSurveyUIStore((s) => s.setEditingQuestionId);
  const questions = useSurveyBuilderStore(useShallow((s) => s.currentSurvey.questions));
  const question = questions.find((q) => q.id === questionId);
  const ensureSurvey = useEnsureSurveyInDb();
  // 옵션 value 리매핑은 편집 중인 질문 밖(다른 질문/그룹)까지 스토어를 바꾸므로,
  // 이 모달의 단일 질문 저장만으로는 DB 에 남지 않는다 — 리매핑이 있으면 설문 저장까지 함께 돌린다.
  const { saveSurveyScoped } = useSurveySync();

  const [formData, setFormData] = useState<Partial<Question>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [showBranchSettings, setShowBranchSettings] = useState(false);

  // 저장 없이 모달이 닫히면 silentUpdateQuestion 경로로 바꾼 설정을 롤백한다.
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

  // 질문 레벨 옵션의 optionCode blur 커밋으로 발생한 value 변경(oldValue→newValue) 누적.
  // 저장(handleSave) 시점에 한 번에 remapOptionValueInConditions 로 다른 질문/그룹/행/열의
  // 표시조건에 반영한다 — blur 즉시 반영하면 모달을 "취소"했을 때도 다른 질문의 표시조건이
  // 이미 새 값을 참조해 불일치가 생긴다(Task 3과 동일한 원자성 원칙).
  const pendingOptionValueChangesRef = useRef<{ oldValue: string; newValue: string }[]>([]);

  // 모달 닫힐 때 debounce 타이머 cleanup
  useEffect(() => {
    return () => {
      if (debouncedTitleRef.current) clearTimeout(debouncedTitleRef.current);
      if (debouncedExportLabelRef.current) clearTimeout(debouncedExportLabelRef.current);
    };
  }, []);

  // editingQuestionId 라이프사이클 + store-only 설정 롤백
  useEffect(() => {
    // 이 effect 가 set up 한 질문 id 와 원래값을 렌더별 closure 로 캡처한다.
    // cleanup 에서 ref(questionIdRef.current)를 읽으면 React 가 새 effect setup 직전
    // 이미 "다음에 여는 질문 id" 로 갱신해둔 값을 읽게 되어, 직전 질문의 original 을
    // 새 질문에 덮어써 hideColumnLabels(열 라벨 숨김)가 풀리는 회귀가 난다.
    let originalHidden = false;
    let originalMobileTableDisplayMode: Question['mobileTableDisplayMode'];
    let originalMobileDrilldownOmitLeadingColumns: Question['mobileDrilldownOmitLeadingColumns'];
    let originalMobileDrilldownRepeatHeaderStartRow: Question['mobileDrilldownRepeatHeaderStartRow'];
    let originalMobileDrilldownRepeatHeaderEndRow: Question['mobileDrilldownRepeatHeaderEndRow'];
    let originalExportCellOrder: Question['exportCellOrder'];
    if (isOpen && questionId) {
      setEditingQuestionId(questionId);
      const q = useSurveyBuilderStore
        .getState()
        .currentSurvey.questions.find((q) => q.id === questionId);
      originalHidden = q?.hideColumnLabels ?? false;
      originalMobileTableDisplayMode = q?.mobileTableDisplayMode;
      originalMobileDrilldownOmitLeadingColumns = q?.mobileDrilldownOmitLeadingColumns;
      originalMobileDrilldownRepeatHeaderStartRow = q?.mobileDrilldownRepeatHeaderStartRow;
      originalMobileDrilldownRepeatHeaderEndRow = q?.mobileDrilldownRepeatHeaderEndRow;
      originalExportCellOrder = q?.exportCellOrder;
      didSaveRef.current = false;
    }
    return () => {
      // setup 과 동일 조건일 때만 — 즉 이 effect 가 실제로 연 질문에 대해서만 롤백한다.
      if (isOpen && questionId) {
        if (!didSaveRef.current) {
          useSurveyBuilderStore.setState((state) => ({
            currentSurvey: {
              ...state.currentSurvey,
              questions: state.currentSurvey.questions.map((question) => {
                if (question.id !== questionId) return question;

                const restoredQuestion = { ...question, hideColumnLabels: originalHidden };
                if (originalMobileTableDisplayMode === undefined) {
                  delete restoredQuestion.mobileTableDisplayMode;
                } else {
                  restoredQuestion.mobileTableDisplayMode = originalMobileTableDisplayMode;
                }
                if (originalMobileDrilldownOmitLeadingColumns === undefined) {
                  delete restoredQuestion.mobileDrilldownOmitLeadingColumns;
                } else {
                  restoredQuestion.mobileDrilldownOmitLeadingColumns =
                    originalMobileDrilldownOmitLeadingColumns;
                }
                if (originalMobileDrilldownRepeatHeaderStartRow === undefined) {
                  delete restoredQuestion.mobileDrilldownRepeatHeaderStartRow;
                } else {
                  restoredQuestion.mobileDrilldownRepeatHeaderStartRow =
                    originalMobileDrilldownRepeatHeaderStartRow;
                }
                if (originalMobileDrilldownRepeatHeaderEndRow === undefined) {
                  delete restoredQuestion.mobileDrilldownRepeatHeaderEndRow;
                } else {
                  restoredQuestion.mobileDrilldownRepeatHeaderEndRow =
                    originalMobileDrilldownRepeatHeaderEndRow;
                }
                if (originalExportCellOrder === undefined) {
                  delete restoredQuestion.exportCellOrder;
                } else {
                  restoredQuestion.exportCellOrder = originalExportCellOrder;
                }
                return restoredQuestion;
              }),
            },
          }));
        }
        useSurveyUIStore.getState().setEditingQuestionId(null);
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
            ...(option.branchRule !== undefined ? { branchRule: { ...option.branchRule } } : {}),
          }))
        : [];

      setFormData({
        title: question.title,
        ...(question.description !== undefined ? { description: question.description } : {}),
        required: question.required,
        ...(question.requiredMessage !== undefined
          ? { requiredMessage: question.requiredMessage }
          : {}),
        ...(question.groupId !== undefined ? { groupId: question.groupId } : {}),
        questionCode: question.questionCode || '',
        isCustomSpssVarName: question.isCustomSpssVarName || false,
        exportLabel: question.exportLabel || '',
        options: optionsWithDeepBranchRule,
        selectLevels: question.selectLevels ? [...question.selectLevels] : [],
        // exactOptionalPropertyTypes 하에서 undefined 명시 대입이 불가하므로
        // 값이 있을 때만 키를 싣는다 (없으면 키 부재 = 기존 undefined 와 동등).
        ...(question.tableTitle !== undefined ? { tableTitle: question.tableTitle } : {}),
        tableColumns: question.tableColumns ? [...question.tableColumns] : [],
        tableRowsData: question.tableRowsData ? [...question.tableRowsData] : [],
        ...(question.tableHeaderGrid !== undefined
          ? { tableHeaderGrid: question.tableHeaderGrid }
          : {}),
        allowOtherOption: question.allowOtherOption || false,
        ...(question.optionsColumns !== undefined
          ? { optionsColumns: question.optionsColumns }
          : {}),
        ...(question.optionsAlign !== undefined ? { optionsAlign: question.optionsAlign } : {}),
        ...(question.mobileOptionsColumns !== undefined
          ? { mobileOptionsColumns: question.mobileOptionsColumns }
          : {}),
        ...(question.rankingConfig !== undefined ? { rankingConfig: question.rankingConfig } : {}),
        ...(question.minSelections !== undefined ? { minSelections: question.minSelections } : {}),
        ...(question.maxSelections !== undefined ? { maxSelections: question.maxSelections } : {}),
        noticeContent: question.noticeContent || '',
        requiresAcknowledgment: question.requiresAcknowledgment || false,
        placeholder: question.placeholder || '',
        piiEncrypted: question.piiEncrypted ?? false,
        defaultValueTemplate: question.defaultValueTemplate ?? null,
        inputType: question.inputType ?? 'text',
        ...(question.emptyDefault !== undefined ? { emptyDefault: question.emptyDefault } : {}),
        ...(question.numberFormat !== undefined ? { numberFormat: question.numberFormat } : {}),
        tableValidationRules: question.tableValidationRules || [],
        ...(question.dynamicRowConfigs !== undefined
          ? { dynamicRowConfigs: question.dynamicRowConfigs }
          : {}),
        hideTitle: question.hideTitle ?? false,
        ...(question.displayCondition !== undefined
          ? { displayCondition: question.displayCondition }
          : {}),
        ...(question.spssVarType !== undefined ? { spssVarType: question.spssVarType } : {}),
        ...(question.spssMeasure !== undefined ? { spssMeasure: question.spssMeasure } : {}),
        // 응답 인용 — hydrate 를 빠뜨리면 UPDATE 페이로드에서 키가 사라져 편집 화면은
        // 멀쩡한데 재진입 시 값이 비는 formData/store 이중상태 silent drop 이 된다.
        answerQuoteEnabled: question.answerQuoteEnabled ?? false,
        answerQuoteName: question.answerQuoteName ?? '',
        answerQuoteText: question.answerQuoteText ?? '',
      });

      // 이전 질문(또는 저장 없이 닫힌 이전 세션)의 pending value 변경이 새 세션으로 새지 않게 리셋.
      pendingOptionValueChangesRef.current = [];

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
      setLocalExportLabel(question.exportLabel || '');

      // 옵션들 중 하나라도 branchRule이 있으면 조건부 분기 설정 표시
      // resolveChoiceOptions 는 manual 은 question.options, table-source 는 choice_opt 셀 파생
      // 옵션을 반환하므로 테이블 보기 옵션 셀의 분기 규칙도 함께 집계된다.
      const hasBranchRule = resolveChoiceOptions(question).some((option) => option.branchRule);
      setShowBranchSettings(hasBranchRule);
    }
    // deps 를 question?.id 로 좁힘 — question 객체 reference 가 바뀐다고 formData 를 reset 하면
    // 모달 안에서 편집한 열/라벨/옵션이 zustand store 의 옛 값으로 덮어씌워진다.
    // (cell-content-modal 이 셀 저장 시 store 를 부분 갱신 → question reference 변경 → 이 effect 재발화 회귀)
    // 모달을 닫았다 다시 같은 질문으로 열면 새로 hydrate 되도록 isOpen 도 deps 에 포함.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id, isOpen]);

  // 검증 로직 (formDataRef로 최신 값 참조 — deps에서 formData 제거)
  const validateForm = useCallback(() => {
    if (!question) return false;

    const currentFormData = formDataRef.current;
    // Case 2 (ranking + optionsSource='table') 는 manual options 검증 스킵
    const isRankingTableSource =
      question.type === 'ranking' && currentFormData.rankingConfig?.optionsSource === 'table';
    // Case A (radio/checkbox 설명 테이블 모드) 도 manual options 검증 스킵
    const isChoiceTableSource =
      (question.type === 'radio' || question.type === 'checkbox') &&
      collectChoiceOptCells(currentFormData.tableRowsData).length > 0;
    const needsOptions =
      isOptionListType(question.type) && !isRankingTableSource && !isChoiceTableSource;
    const needsSelectLevels = question.type === 'multiselect';
    const errors: Record<string, string> = {};

    if (!currentFormData.title?.trim()) {
      errors['title'] = '질문 제목은 필수입니다.';
    }

    if (needsOptions && (!currentFormData.options || currentFormData.options.length === 0)) {
      errors['options'] = '최소 하나의 선택 옵션이 필요합니다.';
    }

    if (
      needsSelectLevels &&
      (!currentFormData.selectLevels || currentFormData.selectLevels.length === 0)
    ) {
      errors['selectLevels'] = '최소 하나의 선택 레벨이 필요합니다.';
    }

    // 질문 내장 테이블 옵션: tableRowsData 에 ranking_opt 셀이 최소 1개는 있어야 함
    if (isRankingTableSource) {
      const hasRankingOpt = collectRankingOptCells(currentFormData.tableRowsData).length > 0;
      if (!hasRankingOpt) {
        errors['rankingOptions'] =
          '질문 내장 테이블에 "순위 옵션" 셀이 최소 1개는 있어야 합니다. 테이블 편집기에서 옵션으로 쓸 셀을 클릭 → 셀 편집 모달의 "순위 옵션" 탭으로 저장하세요.';
      }
    }

    // 설명 테이블 모드(radio/checkbox)인데 choice_opt 셀이 하나도 없으면 옵션 소스가 비어있음
    const choiceTableModeButEmpty =
      (question.type === 'radio' || question.type === 'checkbox') &&
      (currentFormData.tableColumns?.length ?? 0) > 0 &&
      collectChoiceOptCells(currentFormData.tableRowsData).length === 0;
    if (choiceTableModeButEmpty) {
      errors['options'] =
        '설명 테이블에 "보기 옵션" 셀이 최소 1개는 있어야 합니다. 선택 열 셀을 클릭 → "보기 옵션" 탭으로 저장하세요.';
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
    formDataRef.current = {
      ...formDataRef.current,
      title: currentTitle,
      exportLabel: currentExportLabel,
    };

    if (!questionId || !validateForm()) return;

    // store에서 hideColumnLabels 최신값 머지 (silentUpdateQuestion으로 토글한 값)
    // choiceGroups(보기 옵션 그룹)도 formData 가 아닌 셀 모달의 silentUpdateQuestion 경로로
    // 스토어에만 반영되므로, 저장 페이로드(formData)가 누락해 CREATE 시 그룹이 사라진다.
    // hideColumnLabels 와 동일하게 저장 직전 스토어 값을 머지해 동기화한다.
    const storeQuestion = useSurveyBuilderStore
      .getState()
      .currentSurvey.questions.find((q) => q.id === questionId);
    const currentFormData: Partial<Question> = {
      ...formDataRef.current,
      ...(storeQuestion?.hideColumnLabels !== undefined
        ? { hideColumnLabels: storeQuestion.hideColumnLabels }
        : {}),
      ...(storeQuestion?.exportCellOrder !== undefined
        ? { exportCellOrder: storeQuestion.exportCellOrder }
        : {}),
      // 모바일 표 표시 설정도 표 에디터의 silentUpdateQuestion 경로로 store에만 쓰인다.
      ...(storeQuestion?.mobileOriginalTable !== undefined
        ? { mobileOriginalTable: storeQuestion.mobileOriginalTable }
        : {}),
      ...(storeQuestion?.mobileTableDisplayMode !== undefined
        ? { mobileTableDisplayMode: storeQuestion.mobileTableDisplayMode }
        : {}),
      ...(storeQuestion?.mobileDrilldownOmitLeadingColumns !== undefined
        ? { mobileDrilldownOmitLeadingColumns: storeQuestion.mobileDrilldownOmitLeadingColumns }
        : {}),
      ...(storeQuestion?.mobileDrilldownRepeatHeaderStartRow !== undefined
        ? { mobileDrilldownRepeatHeaderStartRow: storeQuestion.mobileDrilldownRepeatHeaderStartRow }
        : {}),
      ...(storeQuestion?.mobileDrilldownRepeatHeaderEndRow !== undefined
        ? { mobileDrilldownRepeatHeaderEndRow: storeQuestion.mobileDrilldownRepeatHeaderEndRow }
        : {}),
      ...(storeQuestion?.choiceGroups !== undefined
        ? { choiceGroups: storeQuestion.choiceGroups }
        : {}),
    };
    setIsSaving(true);
    try {
      // R2 삭제 제거 — 발행 스냅샷·복제·보관함이 같은 URL 을 참조하므로 즉시 삭제는
      // 소실 사고를 유발 (2026-07-27 orphan 감사). 정리는 후속 GC 과제.
      updateQuestion(questionId, currentFormData);

      // 옵션 optionCode blur 로 발생한 value 변경을 저장 시점에 한 번에 리매핑한다.
      // 이 질문 자신의 options 는 위 updateQuestion 이 이미 반영했으므로, 여기서는
      // 이 질문을 sourceQuestionId 로 참조하는 다른 질문/그룹/행/열의 표시조건만 대상.
      const remapScopes: Array<{ questionIds: string[]; groupsChanged: boolean }> = [];
      if (pendingOptionValueChangesRef.current.length > 0) {
        for (const change of pendingOptionValueChangesRef.current) {
          remapScopes.push(
            remapOptionValueInConditions(questionId, change.oldValue, change.newValue),
          );
        }
        pendingOptionValueChangesRef.current = [];
      }

      const store = useSurveyBuilderStore.getState();
      if (store.currentSurvey.id && questionId) {
        // 새 질문 판별: questionChanges.added에 있으면 아직 DB에 없는 질문
        const isNewQuestion = !!store.questionChanges.added[questionId];

        try {
          await ensureSurvey();

          if (!isNewQuestion) {
            // 기존 질문: UPDATE 경로
            const resolvedPlaceholder =
              currentFormData.placeholder !== undefined
                ? currentFormData.placeholder
                : question?.placeholder;
            const updateData: Partial<Question> = { ...currentFormData };
            if (resolvedPlaceholder !== undefined) {
              updateData.placeholder = resolvedPlaceholder;
            }
            await client.surveyBuilder.questions.update({
              questionId,
              surveyId: store.currentSurvey.id,
              data: updateData,
            });
          } else {
            // 새 질문: CREATE 경로.
            // 가드: PERSISTED_QUESTION_FIELDS 를 모두 포함하도록 satisfies 로 강제한다.
            // 신규 영속 컬럼이 SSOT 에 추가되면 여기 누락이 컴파일 에러로 호명되어
            // hideColumnLabels/choiceGroups 류 silent create-drop 회귀를 봉인한다.
            // (id/surveyId 는 CompleteQuestionWrite 의 index signature 가 흡수)
            const createPayload = {
              id: questionId,
              surveyId: store.currentSurvey.id,
              groupId: currentFormData.groupId ?? question?.groupId,
              type: currentFormData.type || question?.type || 'text',
              title: currentFormData.title || question?.title || '',
              description: currentFormData.description || question?.description,
              required: currentFormData.required ?? question?.required ?? false,
              requiredMessage: currentFormData.requiredMessage ?? question?.requiredMessage ?? null,
              order: question?.order ?? 0,
              options: currentFormData.options || question?.options,
              selectLevels: currentFormData.selectLevels || question?.selectLevels,
              tableTitle: currentFormData.tableTitle || question?.tableTitle,
              tableColumns: currentFormData.tableColumns || question?.tableColumns,
              tableRowsData: currentFormData.tableRowsData || question?.tableRowsData,
              // null = 다단계 헤더 해제 — ?? 로 폴백하면 해제가 question 값으로 되살아난다.
              tableHeaderGrid:
                currentFormData.tableHeaderGrid !== undefined
                  ? currentFormData.tableHeaderGrid
                  : question?.tableHeaderGrid,
              allowOtherOption: currentFormData.allowOtherOption ?? question?.allowOtherOption,
              optionsColumns: currentFormData.optionsColumns ?? question?.optionsColumns,
              optionsAlign: currentFormData.optionsAlign ?? question?.optionsAlign,
              mobileOptionsColumns:
                currentFormData.mobileOptionsColumns !== undefined
                  ? currentFormData.mobileOptionsColumns
                  : question?.mobileOptionsColumns,
              minSelections: currentFormData.minSelections ?? question?.minSelections,
              maxSelections: currentFormData.maxSelections ?? question?.maxSelections,
              noticeContent: currentFormData.noticeContent || question?.noticeContent,
              requiresAcknowledgment:
                currentFormData.requiresAcknowledgment ?? question?.requiresAcknowledgment,
              placeholder:
                currentFormData.placeholder !== undefined
                  ? currentFormData.placeholder
                  : question?.placeholder,
              defaultValueTemplate:
                currentFormData.defaultValueTemplate !== undefined
                  ? currentFormData.defaultValueTemplate
                  : question?.defaultValueTemplate,
              inputType:
                currentFormData.inputType !== undefined
                  ? currentFormData.inputType
                  : question?.inputType,
              emptyDefault:
                currentFormData.emptyDefault !== undefined
                  ? currentFormData.emptyDefault
                  : question?.emptyDefault,
              piiEncrypted:
                currentFormData.piiEncrypted !== undefined
                  ? currentFormData.piiEncrypted
                  : question?.piiEncrypted,
              tableValidationRules:
                currentFormData.tableValidationRules || question?.tableValidationRules,
              numberFormat:
                currentFormData.numberFormat !== undefined
                  ? currentFormData.numberFormat
                  : question?.numberFormat,
              sumConstraints: currentFormData.sumConstraints || question?.sumConstraints,
              displayCondition: currentFormData.displayCondition || question?.displayCondition,
              dynamicRowConfigs: currentFormData.dynamicRowConfigs || question?.dynamicRowConfigs,
              hideTitle: currentFormData.hideTitle ?? question?.hideTitle,
              // pageBreakBefore 는 질문 목록의 가위 토글로 store 에만 쓰여 formData 가
              // 소유하지 않는다 — hideColumnLabels 와 동일한 silent drop 방지 머지.
              pageBreakBefore: currentFormData.pageBreakBefore ?? question?.pageBreakBefore,
              rankingConfig: currentFormData.rankingConfig || question?.rankingConfig,
              choiceGroups: currentFormData.choiceGroups ?? question?.choiceGroups,
              // hideColumnLabels 도 silentUpdateQuestion(표 에디터 토글)으로 store 에만 쓰여
              // formData 가 소유하지 않는다. currentFormData 머지값을 CREATE 에 전달해
              // 신규 질문에서 ON 토글이 default(false)로 silent drop 되는 회귀를 막는다.
              hideColumnLabels: currentFormData.hideColumnLabels ?? question?.hideColumnLabels,
              exportCellOrder: currentFormData.exportCellOrder ?? question?.exportCellOrder,
              mobileOriginalTable:
                currentFormData.mobileOriginalTable ?? question?.mobileOriginalTable,
              mobileTableDisplayMode:
                currentFormData.mobileTableDisplayMode ?? question?.mobileTableDisplayMode,
              mobileDrilldownOmitLeadingColumns:
                currentFormData.mobileDrilldownOmitLeadingColumns ??
                question?.mobileDrilldownOmitLeadingColumns,
              mobileDrilldownRepeatHeaderStartRow:
                currentFormData.mobileDrilldownRepeatHeaderStartRow !== undefined
                  ? currentFormData.mobileDrilldownRepeatHeaderStartRow
                  : question?.mobileDrilldownRepeatHeaderStartRow,
              mobileDrilldownRepeatHeaderEndRow:
                currentFormData.mobileDrilldownRepeatHeaderEndRow !== undefined
                  ? currentFormData.mobileDrilldownRepeatHeaderEndRow
                  : question?.mobileDrilldownRepeatHeaderEndRow,
              questionCode: currentFormData.questionCode || question?.questionCode,
              isCustomSpssVarName:
                currentFormData.isCustomSpssVarName ?? question?.isCustomSpssVarName,
              exportLabel: currentFormData.exportLabel || question?.exportLabel,
              spssVarType: currentFormData.spssVarType ?? question?.spssVarType,
              spssMeasure: currentFormData.spssMeasure ?? question?.spssMeasure,
              answerQuoteEnabled:
                currentFormData.answerQuoteEnabled ?? question?.answerQuoteEnabled,
              answerQuoteName: currentFormData.answerQuoteName ?? question?.answerQuoteName,
              answerQuoteText: currentFormData.answerQuoteText ?? question?.answerQuoteText,
            } satisfies CompleteQuestionWrite;
            const createdQuestion = await client.surveyBuilder.questions.create(createPayload);

            if (createdQuestion?.id) {
              // DB에 생성 완료 → added에서 제거 (다음 모달 저장 시 UPDATE 경로 사용)
              const { [questionId]: _, ...remainingAdded } =
                useSurveyBuilderStore.getState().questionChanges.added;
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
              // 스왑 직후 이 질문을 참조하는 조건(sourceQuestionId·expression 피연산자·
              // branchRule goto 대상)도 새 id 로 갱신 — 안 하면 참조가 temp id 로 끊긴다
              remapScopes.push(remapQuestionRefs(questionId, newId));
            }
          }
        } catch (error) {
          console.error('질문 저장/업데이트 실패:', error);
          throw error;
        }
      }

      // 리매핑된 다른 질문/그룹은 스토어 dirty 로만 남아 있다 — 리매핑 범위만 스코프
      // 저장으로 이어붙여, 모달만 닫고 이탈해도 DB 가 구 value/구 id 를 참조하지 않도록
      // 한다. 빌더에 대기 중인 무관한 pending(질문 추가/삭제, 그룹 삭제 등)은 건드리지
      // 않는다 (saveSurveyScoped).
      const remapQuestionIds = [...new Set(remapScopes.flatMap((s) => s.questionIds))];
      const remapGroupsChanged = remapScopes.some((s) => s.groupsChanged);
      if (remapQuestionIds.length > 0 || remapGroupsChanged) {
        try {
          await saveSurveyScoped({
            questionIds: remapQuestionIds,
            includeMetadata: remapGroupsChanged,
          });
        } catch (error) {
          console.error('표시조건 리매핑 반영을 위한 설문 저장 실패:', error);
          toast.error('조건 리매핑 저장에 실패했습니다. 설문 저장 버튼으로 다시 저장해 주세요.');
        }
      }

      didSaveRef.current = true;
      onClose();
    } catch (error) {
      console.error('저장 중 오류가 발생했습니다:', error);
    } finally {
      setIsSaving(false);
    }
  }, [
    ensureSurvey,
    questionId,
    validateForm,
    updateQuestion,
    remapOptionValueInConditions,
    remapQuestionRefs,
    saveSurveyScoped,
    onClose,
    question,
  ]);

  // Option helpers (setFormData를 바인딩, useMemo로 안정화하여 자식 리렌더 방지)
  const addOption = useMemo(() => createAddOption(setFormData), []);
  const updateOption = useMemo(() => createUpdateOption(setFormData), []);
  const removeOption = useMemo(() => createRemoveOption(setFormData), []);
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
  // 모든 질문 편집 모달 폭을 테이블 편집 모달과 동일하게 통일
  const modalSize = 'max-w-6xl';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        // X 버튼으로만 닫기 가능 (배경 클릭과 Escape는 차단)
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
        onEscapeKeyDown={(event) => {
          event.preventDefault();
        }}
      >
        {/* 고정 헤더 */}
        <DialogHeader className="flex-shrink-0 border-b border-gray-200 px-6 py-4">
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {getQuestionTypeIcon(question.type)}
              <span>{getQuestionTypeLabel(question.type)} 편집</span>
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
                onOptionValueChange={(change) => {
                  pendingOptionValueChangesRef.current = [
                    ...pendingOptionValueChangesRef.current,
                    change,
                  ];
                }}
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

                <div className="mt-8 border-t border-gray-200 pt-6">
                  <SumConstraintEditor
                    constraints={formData.sumConstraints ?? question.sumConstraints ?? []}
                    tableColumns={formData.tableColumns ?? question.tableColumns ?? []}
                    tableRowsData={formData.tableRowsData ?? question.tableRowsData ?? []}
                    tableHeaderGrid={
                      // null = 편집 중 해제 — question 값으로 되살리면 안 된다.
                      (formData.tableHeaderGrid !== undefined
                        ? formData.tableHeaderGrid
                        : question.tableHeaderGrid) ?? undefined
                    }
                    hideColumnLabels={formData.hideColumnLabels ?? question.hideColumnLabels}
                    onUpdate={(sumConstraints) =>
                      setFormData((prev) => ({ ...prev, sumConstraints }))
                    }
                  />
                </div>
              </TabsContent>
            )}

            {/* 표시 조건 탭 */}
            <TabsContent value="display-condition" className="px-6 py-4">
              <QuestionConditionEditor
                question={question}
                onUpdate={async (conditionGroup) => {
                  setFormData((prev) => {
                    const next: Partial<Question> = { ...prev };
                    if (conditionGroup !== undefined) {
                      next.displayCondition = conditionGroup;
                    } else {
                      delete next.displayCondition;
                    }
                    return next;
                  });

                  // 조건 변경 시 즉시 DB에 저장 (질문 ID가 UUID이고 이미 DB에 존재하는 경우에만)
                  const store = useSurveyBuilderStore.getState();
                  const isNewQuestion = !!store.questionChanges.added[questionId || ''];
                  if (
                    questionId &&
                    store.currentSurvey.id &&
                    isValidUUID(questionId) &&
                    !isNewQuestion
                  ) {
                    try {
                      await client.surveyBuilder.questions.update({
                        questionId,
                        surveyId: store.currentSurvey.id,
                        data: { displayCondition: conditionGroup },
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
