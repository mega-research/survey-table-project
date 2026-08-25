'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  CheckSquare,
  ChevronDown,
  Circle,
  Image as ImageIcon,
  ListOrdered,
  PenLine,
  Tag,
  Type,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getYouTubeEmbedUrl } from '@/features/question-renderer/table-cell-renderers';
import {
  AnswerQuoteQuestionControl,
} from '@/features/survey-builder/answer-quote-fields';
import { CellImageEditor } from '@/features/survey-builder/cell-image-editor';
import { FormulaExprEditor } from '@/features/survey-builder/formula/formula-expr-editor';
import { useEnsureSurveyInDb } from '@/features/survey-builder/hooks/use-ensure-survey-in-db';
import { useSurveySync } from '@/features/survey-builder/hooks/use-survey-sync';
import { NumberFormatFields } from '@/features/survey-builder/number-format-fields';
import { OptionsLayoutSelector } from '@/features/survey-builder/options-layout-selector';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import { useSurveyUIStore } from '@/features/survey-builder/stores/ui-store';
import {
  type ContentType,
  MOBILE_DISPLAY_CELL_TYPES,
  MOBILE_LABEL_CELL_TYPES,
} from '@/features/survey-builder/table-editor/cell-editor/utils/serialize-cell';
import { REQUIRED_CELL_TYPES } from '@/utils/table-cell-semantics';
import { CellStyleFields } from '@/features/survey-builder/table-editor/cell-style-fields';
import { runAsyncAction } from '@/utils/run-async-action';
import { GATABLE_CELL_TYPES } from '@/lib/survey/cell-gating';
import { generateId } from '@/lib/utils';
import {
  CalcCellValidation,
  ChoiceGroup,
  HeaderCell,
  Question,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';
import { collectChoiceOptCells } from '@/utils/choice-source';
import { isPartialNumericInput } from '@/utils/numeric-input';
import { getMaxSpssCode } from '@/utils/option-code-generator';
import { collectRankingOptCells } from '@/utils/ranking-source';
import { DEFAULT_REQUIRED_CELL_MESSAGE } from '@/utils/required-message';
import {
  INTERACTIVE_CELL_TYPES,
  generateCellCode,
  generateExportLabel,
  inferSpssMeasure,
  inferSpssVarType,
} from '@/utils/table-cell-code-generator';

import { CellChoiceEditor } from './cell-choice-editor';
import { CellGatingEditor } from './cell-gating-editor';
import { ChoiceOptCellTab } from './choice-opt-cell-tab';
import { useCellForm } from './hooks/use-cell-form';
import { CellAlignFields } from './cell-align-fields';
import { commitCellEdit } from './commit-cell-edit';
import { validateCellEdit } from './validate-cell-edit';
import { CellIdentityFields } from './cell-identity-fields';
import { CellMergeFields } from './cell-merge-fields';
import { CellMobileFields } from './cell-mobile-fields';
import { InputCellTab } from './input-cell-tab';
import { RankingCellTab } from './ranking-cell-tab';
import { RankingOptCellTab } from './ranking-opt-cell-tab';

interface CellContentModalProps {
  isOpen: boolean;
  onClose: () => void;
  cell: TableCell;
  /**
   * 셀 저장 콜백. valueChanges 는 이번 편집 세션 중 옵션 optionCode 편집이 value 를
   * 동기화시킨 변경 쌍들(순서대로) — 상위(dynamic-table-editor/use-table-editor)가
   * 같은 커밋 안에서 이 셀을 controllerCellId 로 참조하는 게이팅을 리매핑하는 데 쓴다.
   */
  onSave: (cell: TableCell, valueChanges?: { oldValue: string; newValue: string }[]) => void;
  /**
   * 이 셀을 소유한 질문(표) — 계산 탭·검증 토글의 FormulaExprEditor 가 같은 질문 셀 참조 픽커에
   * 사용한다. 에디터의 실시간 편집 상태(currentQuestionAsQuestion)를 그대로 받아야
   * 아직 저장 전인 열/행 추가도 픽커에 즉시 보인다 (store 는 저장 전까지 stale).
   */
  ownQuestion: Question;
  currentQuestionId?: string | undefined;
  questionCode?: string | undefined;
  questionTitle?: string | undefined;
  rowCode?: string | undefined;
  rowLabel?: string | undefined;
  columnCode?: string | undefined;
  columnLabel?: string | undefined;
  /**
   * 질문 단위 응답 인용 토글. 켜졌을 때만 셀·옵션별 인용 문구 입력칸이 등장한다.
   * (질문 편집 모달의 formData 에서 내려오므로 저장 전 토글도 즉시 반영된다)
   */
  answerQuoteEnabled?: boolean | undefined;
  /** choice_opt 탭용: 질문 레벨 옵션 그룹 목록 (표시/편집용). 없으면 그룹 기능 비활성. */
  choiceGroups?: ChoiceGroup[] | undefined;
  /** choice_opt 그룹 변경 시 부모에게 통보 (prune 후 저장은 부모 책임) */
  onChoiceGroupsChange?: ((groups: ChoiceGroup[]) => void) | undefined;
  /**
   * 에디터의 권위 있는 최신 행(currentRowsRef). DB 저장/그룹 prune 의 베이스로 쓴다.
   * store 의 tableRowsData 는 구조 편집(열/행 추가 등)이 formData 에만 반영되어 편집 중
   * stale 할 수 있으므로, onSave 반영 직후의 에디터 행을 그대로 사용해야
   * prune 이 멤버를 놓쳐 그룹이 풀리는 회귀를 막는다.
   */
  getLatestRows?: (() => TableRow[] | undefined) | undefined;
  /**
   * 에디터의 권위 있는 최신 열(currentColumnsRef)·다단계 헤더(headerGridRef).
   * 셀 저장은 tableRowsData 를 DB 에 즉시 커밋하는데, 행은 편집 세션의 열 구조 변경
   * (formData 에만 반영)을 업고 간다 — rows 만 커밋하면 스토어/DB 가 "columns N개 +
   * 행당 셀 N+1개" 혼합 상태가 되고, 질문 모달 취소 후 재진입 시 편집 그리드가
   * 행마다 밀리는 스크램블이 된다 (2026-08-19 실사고). rows 와 항상 짝으로 커밋한다.
   */
  getLatestColumns?: (() => TableColumn[] | undefined) | undefined;
  getLatestHeaderGrid?: (() => HeaderCell[][] | undefined) | undefined;
}

// 컴포넌트 안에서 use* 식별자를 값으로 참조하면 React Compiler 가 컴포넌트 전체를 건너뛴다.
// 스토어 인스턴스 API 는 훅이 아니므로 모듈 최상위에서 한 번 집어 별칭으로 쓴다.
const readBuilderState = useSurveyBuilderStore.getState;

export function CellContentModal({
  isOpen,
  onClose,
  cell,
  onSave,
  ownQuestion,
  currentQuestionId = '',
  questionCode,
  rowCode,
  rowLabel,
  columnCode,
  columnLabel,
  answerQuoteEnabled = false,
  choiceGroups: choiceGroupsProp,
  onChoiceGroupsChange,
  getLatestRows,
  getLatestColumns,
  getLatestHeaderGrid,
}: CellContentModalProps) {
  const questions = useSurveyBuilderStore(useShallow((s) => s.currentSurvey.questions));
  const variableCatalog = useSurveyUIStore((s) => s.variableCatalog);
  const ensureSurvey = useEnsureSurveyInDb();
  // 셀 저장은 tableRowsData 를 DB 에 즉시 커밋하는 비가역 지점이다 — 옵션 value 가 바뀌었으면
  // 이 표 질문을 참조하는 표시조건 리매핑과 그 영속(설문 저장)도 같은 지점에서 끝내야 한다.
  const remapOptionValueInConditions = useSurveyBuilderStore((s) => s.remapOptionValueInConditions);
  const { saveSurveyScoped } = useSurveySync();
  const [isSaving, setIsSaving] = useState(false);
  const inputTemplateRef = useRef<HTMLInputElement>(null);
  const textContentRef = useRef<HTMLTextAreaElement>(null);
  // 숫자 모드 진입 시 emptyDefault 기본 ON 을 "이 편집 세션에서 한 번만" 적용하기 위한 가드.
  // 사용자가 초기값 옵션을 끈 뒤 숫자 모드를 다시 토글해도 강제로 켜지지 않도록 한다.
  // (모달 오픈/cell.id 변경 시 리셋)
  const emptyDefaultAutoAppliedRef = useRef(false);
  // 이번 편집 세션 중 옵션 optionCode blur 커밋이 value 를 동기화시킨 변경 쌍 누적.
  // Save 시점에 onSave 로 함께 전달해 게이팅 리매핑을 셀 저장과 같은 커밋에 묶는다
  // (blur 마다 즉시 리매핑하면 이후 취소 시 다른 셀의 게이팅만 남는 불일치가 생긴다).
  const pendingOptionValueChangesRef = useRef<{ oldValue: string; newValue: string }[]>([]);

  // 35개 편집 필드를 단일 폼 상태로 통합. hydrate(모달 오픈/cell.id 변경)와
  // reset(취소 롤백)이 한 소스(cellToFormState)를 공유해 필드 누락 drift 가 없다.
  // (ranking 은 8번째 탭, ranking_opt 는 9번째 탭, choice_opt 는 10번째 탭)
  const { form, setters, reset } = useCellForm(cell, isOpen);
  const {
    contentType,
    textContent,
    imageUrl,
    videoUrl,
    checkboxOptions,
    radioOptions,
    radioGroupName,
    selectOptions,
    allowOtherOption,
    cellOptionsColumns,
    cellMobileOptionsColumns,
    inputDefaultValueTemplate,
    cellNumberFormat,
    cellRequired,
    cellRequiredMessage,
    gatingCondition,
    gatingRequiredWhenEnabled,
    minSelections,
    maxSelections,
    rankingOptions,
    rankingConfig,
    rankSuffixPattern,
    rankVarNames,
    rankingLabel,
    cellSpssNumericCode,
    isOtherRankingCell,
    choiceLabel,
    choiceAllowTextInput,
    choiceBranchRule,
    choiceGroupId,
    textBold,
    backgroundColor,
    textColor,
    horizontalAlign,
    cellCode,
    isCustomCellCode,
    exportLabel,
    isCustomExportLabel,
    spssVarType,
    spssMeasure,
    answerQuoteText,
    answerQuoteEnabled: cellAnswerQuoteEnabled,
    answerQuoteName: cellAnswerQuoteName,
    formula,
    calcValidationEnabled,
    calcValidationOperator,
    calcValidationTarget,
    calcValidationToleranceRaw,
    calcValidationErrorMessage,
  } = form;
  // 순위 옵션(ranking_opt, Case 2)은 순위형 질문의 내장 테이블에서만 렌더러가 있다.
  // 테이블형 질문에서는 응답 select 가 나오지 않는 막다른 조합이 되므로 탭을 숨긴다.
  // 단, 이미 ranking_opt 인 셀(과거 데이터)은 편집/다른 타입 전환이 가능하도록 노출 유지.
  const parentQuestionType = questions.find((q) => q.id === currentQuestionId)?.type;
  const showRankingOptTab = parentQuestionType === 'ranking' || contentType === 'ranking_opt';
  // 셀 단위 응답 인용은 호스트 질문이 표(table)일 때만 노출한다.
  // 표-소스 선택형 질문(radio/checkbox + choice_opt)의 다른 셀들은 응답 페이지에서 inert 라
  // 값이 생기지 않는다 — 거기에 토글을 노출하면 켜도 아무 일이 없는 죽은 설정이 된다.
  const showCellAnswerQuote = parentQuestionType === 'table';
  const showContentMobileDisplay = MOBILE_DISPLAY_CELL_TYPES.has(contentType);
  const showInteractiveMobileLabel = MOBILE_LABEL_CELL_TYPES.has(contentType);
  const {
    setContentType,
    setImageUrl,
    setVideoUrl,
    setCheckboxOptions,
    setRadioOptions,
    setRadioGroupName,
    setSelectOptions,
    setAllowOtherOption,
    setCellOptionsColumns,
    setCellMobileOptionsColumns,
    setCellNumberFormat,
    setCellRequired,
    setCellRequiredMessage,
    setGatingCondition,
    setGatingRequiredWhenEnabled,
    setMinSelections,
    setMaxSelections,
    setRankingOptions,
    setRankingConfig,
    setRankSuffixPattern,
    setRankVarNames,
    setRankingLabel,
    setCellSpssNumericCode,
    setIsOtherRankingCell,
    setChoiceLabel,
    setChoiceAllowTextInput,
    setChoiceBranchRule,
    setChoiceGroupId,
    setTextBold,
    setBackgroundColor,
    setTextColor,
    setHorizontalAlign,
    setCellCode,
    setExportLabel,
    setSpssVarType,
    setSpssMeasure,
    setAnswerQuoteText,
    setAnswerQuoteEnabled: setCellAnswerQuoteEnabled,
    setAnswerQuoteName: setCellAnswerQuoteName,
    setFormula,
    setCalcValidationEnabled,
    setCalcValidationOperator,
    setCalcValidationTarget,
    setCalcValidationToleranceRaw,
    setCalcValidationErrorMessage,
  } = setters;

  // 선택형 셀 헤더(조건부 분기 옆)에 붙는 셀 단위 인용 컨트롤. 표 질문이 아니면 넘기지 않는다.
  const cellAnswerQuoteControl = showCellAnswerQuote
    ? {
        enabled: cellAnswerQuoteEnabled,
        onEnabledChange: setCellAnswerQuoteEnabled,
        name: cellAnswerQuoteName,
        onNameChange: setCellAnswerQuoteName,
      }
    : undefined;

  // choice_opt 탭용 로컬 그룹 편집 상태.
  // 부모에서 choiceGroupsProp 를 전달받으면 그 값으로, 아니면 스토어 질문의 choiceGroups 를 사용한다.
  // 모달이 열릴 때(isOpen + cell.id 변경) 재동기화하기 위해 useState 초기값은 lazy initializer 로 설정하지 않고
  // 렌더 중 조정 패턴으로 동기화한다. (isOpen 이 꺼지면 닫는 시점이므로 재설정이 무해하다.)
  const [editChoiceGroups, setEditChoiceGroups] = useState<ChoiceGroup[]>(
    () => choiceGroupsProp ?? [],
  );
  const choiceGroupsResetKey = isOpen ? (cell?.id ?? '') : null;
  const [prevChoiceGroupsResetKey, setPrevChoiceGroupsResetKey] = useState<string | null>(null);
  if (prevChoiceGroupsResetKey !== choiceGroupsResetKey) {
    setPrevChoiceGroupsResetKey(choiceGroupsResetKey);
    if (isOpen) {
      const storeQuestion = readBuilderState().currentSurvey.questions.find(
        (q) => q.id === currentQuestionId,
      );
      setEditChoiceGroups(choiceGroupsProp ?? storeQuestion?.choiceGroups ?? []);
    }
  }

  // 새 편집 세션(모달 오픈/cell.id 변경)마다 emptyDefault 자동 적용 가드를 리셋한다.
  useEffect(() => {
    emptyDefaultAutoAppliedRef.current = false;
    pendingOptionValueChangesRef.current = [];
  }, [isOpen, cell?.id]);

  // 게이팅 컨트롤러 픽커용 — 이 셀이 속한 행의 셀 목록.
  // 에디터의 권위 있는 최신 행(getLatestRows)을 우선한다 (store 는 구조 편집 중 stale).
  const gatingRowCells = useMemo(() => {
    const rows = getLatestRows?.() ?? ownQuestion.tableRowsData;
    return rows?.find((r) => r.cells.some((c) => c.id === cell.id))?.cells ?? [];
  }, [getLatestRows, ownQuestion.tableRowsData, cell.id]);

  // 현재 질문 tableRowsData 기반으로 그룹별 멤버 셀 수를 계산한다 (표시용).
  // 아직 저장되지 않은 이번 편집 셀은 카운트에 반영되지 않아도 무방하다.
  const groupMemberCounts = (() => {
    const storeQuestion = questions.find((q) => q.id === currentQuestionId);
    const allCells = [
      ...collectChoiceOptCells(storeQuestion?.tableRowsData),
      ...collectRankingOptCells(storeQuestion?.tableRowsData),
    ];
    const counts: Record<string, number> = {};
    for (const c of allCells) {
      if (c.choiceGroupId) {
        counts[c.choiceGroupId] = (counts[c.choiceGroupId] ?? 0) + 1;
      }
    }
    return counts;
  })();

  // 자동생성 셀코드/라벨 계산
  const autoCellCode = generateCellCode(questionCode, rowCode, columnCode);
  const autoExportLabel = generateExportLabel(
    questionCode,
    columnLabel || columnCode,
    rowLabel || rowCode,
  );

  const mountedRef = useRef(true);
  // StrictMode(dev)의 mount→cleanup→mount 시뮬레이션에서 cleanup 만 있으면 false 로
  // 굳는다 — effect 본문에서 true 를 재설정해야 실마운트 상태를 정확히 반영한다.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleSave = async () => {
    const validationError = validateCellEdit(form, { cell, currentQuestionId, questions });
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setIsSaving(true);
    // try/finally 는 React Compiler 가 낮추지 못해 모달 전체가 skip 됐다 — 러너에 가둔다(B-2a 선례).
    await runAsyncAction(
      () =>
        commitCellEdit({
          form,
          cell,
          questionCode,
          currentQuestionId,
          questions,
          editChoiceGroups,
          pendingValueChanges: pendingOptionValueChangesRef.current,
          latest: { rows: getLatestRows, columns: getLatestColumns, headerGrid: getLatestHeaderGrid },
          ensureSurvey,
          saveSurveyScoped,
          remapOptionValueInConditions,
          onSave,
          onChoiceGroupsChange,
        }),
      {
        onError: (error) => {
          console.error('셀 저장 실패:', error);
        },
        onSettled: () => {
          if (mountedRef.current) {
            setIsSaving(false);
            onClose();
          }
        },
      },
    );
  };

  const handleCancel = () => {
    // 원래 cell 값으로 폼 롤백 (hydrate 와 동일 소스 — 필드 누락 drift 없음).
    reset();
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        // X 버튼이나 ESC만 닫기 가능 (배경 클릭은 onInteractOutside에서 막음)
        if (!open && !isSaving) {
          handleCancel();
        }
      }}
    >
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
        onInteractOutside={(e) => {
          e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>셀 내용 편집</DialogTitle>
        </DialogHeader>

        <CellIdentityFields
          form={form}
          setters={setters}
          cell={cell}
          textContentRef={textContentRef}
          autoCellCode={autoCellCode}
          autoExportLabel={autoExportLabel}
          variableCatalog={variableCatalog}
        />

        <Tabs
          value={contentType}
          onValueChange={(value) => {
            const newType = value as ContentType;
            setContentType(newType);
            // 셀 타입 변경 시 SPSS 필드 자동 처리
            if (INTERACTIVE_CELL_TYPES.has(newType)) {
              // 입력 타입으로 변경 → 변수 타입/측정 수준 자동 설정 (기존값 없을 때만)
              if (!spssVarType) setSpssVarType(inferSpssVarType(newType));
              if (!spssMeasure) setSpssMeasure(inferSpssMeasure(newType));
            } else {
              // 비입력 타입 (ranking 포함) → 셀 단위 SPSS 필드는 사용하지 않음
              setSpssVarType(undefined);
              setSpssMeasure(undefined);
            }
            // ranking 첫 진입 시 디폴트 주입
            if (newType === 'ranking') {
              if (rankingOptions.length === 0) {
                setRankingOptions([
                  {
                    id: generateId(),
                    label: '옵션 1',
                    value: 'opt1',
                    spssNumericCode: getMaxSpssCode([]) + 1,
                  },
                  {
                    id: generateId(),
                    label: '옵션 2',
                    value: 'opt2',
                    spssNumericCode: getMaxSpssCode([]) + 2,
                  },
                ]);
              }
              if (!rankingConfig) {
                setRankingConfig({ positions: 3 });
              }
            }
            // 모든 타입: 코드가 없고 커스텀이 아니면 자동생성
            if (!cellCode && !isCustomCellCode && autoCellCode) {
              setCellCode(autoCellCode);
            }
            if (!exportLabel && !isCustomExportLabel && autoExportLabel) {
              setExportLabel(autoExportLabel);
            }
          }}
        >
          <TabsList
            className={`grid w-full ${showRankingOptTab ? 'grid-cols-11' : 'grid-cols-10'}`}
          >
            <TabsTrigger value="text" className="flex items-center gap-2">
              <Type className="h-4 w-4" />
              텍스트
            </TabsTrigger>
            <TabsTrigger value="image" className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              이미지
            </TabsTrigger>
            <TabsTrigger value="video" className="flex items-center gap-2">
              <Video className="h-4 w-4" />
              동영상
            </TabsTrigger>
            <TabsTrigger value="input" className="flex items-center gap-2">
              <PenLine className="h-4 w-4" />
              단답형
            </TabsTrigger>
            <TabsTrigger value="checkbox" className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4" />
              체크박스
            </TabsTrigger>
            <TabsTrigger value="radio" className="flex items-center gap-2">
              <Circle className="h-4 w-4" />
              라디오
            </TabsTrigger>
            <TabsTrigger value="select" className="flex items-center gap-2">
              <ChevronDown className="h-4 w-4" />
              선택
            </TabsTrigger>
            <TabsTrigger value="ranking" className="flex items-center gap-2">
              <ListOrdered className="h-4 w-4" />
              순위형
            </TabsTrigger>
            {showRankingOptTab && (
              <TabsTrigger value="ranking_opt" className="flex items-center gap-2">
                <Tag className="h-4 w-4" />
                순위 옵션
              </TabsTrigger>
            )}
            <TabsTrigger value="choice_opt" className="flex items-center gap-2">
              <Tag className="h-4 w-4" />
              보기 옵션
            </TabsTrigger>
            <TabsTrigger value="calc">계산</TabsTrigger>
          </TabsList>

          {/* 텍스트 탭 */}
          <TabsContent value="text" className="space-y-4">
            <div className="rounded-lg border bg-gray-50 p-4 text-center text-sm text-gray-600">
              <p>기본 텍스트 모드입니다.</p>
              <p className="mt-1">
                상단의 &quot;셀 텍스트 내용&quot;에 입력한 텍스트만 표시됩니다.
              </p>
            </div>
          </TabsContent>

          {/* 이미지 탭 */}
          <TabsContent value="image" className="space-y-4">
            <CellImageEditor imageUrl={imageUrl} onImageUrlChange={setImageUrl} />
          </TabsContent>

          {/* 동영상 탭 */}
          <TabsContent value="video" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="video-url">동영상 URL</Label>
              <Input
                id="video-url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
              />
              <p className="text-sm text-gray-500">
                YouTube, Vimeo URL 또는 직접 동영상 링크를 입력하세요
              </p>
            </div>
            {videoUrl && (
              <div className="space-y-2">
                <Label>미리보기</Label>
                <div className="rounded-md border bg-gray-50 p-3">
                  {videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be') ? (
                    <div className="aspect-video">
                      <iframe
                        src={getYouTubeEmbedUrl(videoUrl)}
                        className="h-full w-full rounded"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        title="동영상 미리보기"
                      />
                    </div>
                  ) : videoUrl.includes('vimeo.com') ? (
                    <div className="aspect-video">
                      <iframe
                        src={videoUrl.replace('vimeo.com/', 'player.vimeo.com/video/')}
                        className="h-full w-full rounded"
                        frameBorder="0"
                        allow="autoplay; fullscreen; picture-in-picture"
                        allowFullScreen
                        title="동영상 미리보기"
                      />
                    </div>
                  ) : videoUrl.match(/\.(mp4|webm|ogg)$/i) ? (
                    <video src={videoUrl} controls className="max-h-48 w-full rounded">
                      동영상을 지원하지 않는 브라우저입니다.
                    </video>
                  ) : (
                    <p className="text-sm text-yellow-600">
                      동영상 링크를 확인할 수 없습니다. YouTube, Vimeo 또는 직접 동영상 링크인지
                      확인해주세요.
                    </p>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* 단답형 입력 탭 */}
          <TabsContent value="input" className="space-y-4">
            <InputCellTab
              form={form}
              setters={setters}
              inputTemplateRef={inputTemplateRef}
              emptyDefaultAutoAppliedRef={emptyDefaultAutoAppliedRef}
              ownQuestion={ownQuestion}
              questions={questions}
              variableCatalog={variableCatalog}
              showCellAnswerQuote={showCellAnswerQuote}
              answerQuoteEnabled={answerQuoteEnabled}
            />
          </TabsContent>

          {/* 체크박스 탭 */}
          <TabsContent value="checkbox" className="space-y-4">
            <OptionsLayoutSelector
              value={cellOptionsColumns}
              onChange={setCellOptionsColumns}
              align={horizontalAlign}
              onAlignChange={setHorizontalAlign}
              mobileValue={cellMobileOptionsColumns}
              onMobileChange={(next) => setCellMobileOptionsColumns(next ?? undefined)}
            />
            <CellChoiceEditor
              cellType="checkbox"
              textContent={textContent}
              answerQuoteEnabled={answerQuoteEnabled}
              cellAnswerQuote={cellAnswerQuoteControl}
              currentQuestionId={currentQuestionId}
              questions={questions}
              checkboxOptions={checkboxOptions}
              onCheckboxOptionsChange={setCheckboxOptions}
              radioOptions={radioOptions}
              onRadioOptionsChange={setRadioOptions}
              radioGroupName={radioGroupName}
              onRadioGroupNameChange={setRadioGroupName}
              selectOptions={selectOptions}
              onSelectOptionsChange={setSelectOptions}
              minSelections={minSelections}
              onMinSelectionsChange={setMinSelections}
              maxSelections={maxSelections}
              onMaxSelectionsChange={setMaxSelections}
              onOptionValueChange={(change) => {
                pendingOptionValueChangesRef.current = [
                  ...pendingOptionValueChangesRef.current,
                  change,
                ];
              }}
            />
          </TabsContent>

          {/* 라디오 버튼 탭 */}
          <TabsContent value="radio" className="space-y-4">
            <OptionsLayoutSelector
              value={cellOptionsColumns}
              onChange={setCellOptionsColumns}
              align={horizontalAlign}
              onAlignChange={setHorizontalAlign}
              mobileValue={cellMobileOptionsColumns}
              onMobileChange={(next) => setCellMobileOptionsColumns(next ?? undefined)}
            />
            <CellChoiceEditor
              cellType="radio"
              textContent={textContent}
              answerQuoteEnabled={answerQuoteEnabled}
              cellAnswerQuote={cellAnswerQuoteControl}
              currentQuestionId={currentQuestionId}
              questions={questions}
              checkboxOptions={checkboxOptions}
              onCheckboxOptionsChange={setCheckboxOptions}
              radioOptions={radioOptions}
              onRadioOptionsChange={setRadioOptions}
              radioGroupName={radioGroupName}
              onRadioGroupNameChange={setRadioGroupName}
              selectOptions={selectOptions}
              onSelectOptionsChange={setSelectOptions}
              minSelections={minSelections}
              onMinSelectionsChange={setMinSelections}
              maxSelections={maxSelections}
              onMaxSelectionsChange={setMaxSelections}
              onOptionValueChange={(change) => {
                pendingOptionValueChangesRef.current = [
                  ...pendingOptionValueChangesRef.current,
                  change,
                ];
              }}
            />
          </TabsContent>

          {/* Select 탭 */}
          <TabsContent value="select" className="space-y-4">
            <CellChoiceEditor
              cellType="select"
              textContent={textContent}
              answerQuoteEnabled={answerQuoteEnabled}
              cellAnswerQuote={cellAnswerQuoteControl}
              currentQuestionId={currentQuestionId}
              questions={questions}
              checkboxOptions={checkboxOptions}
              onCheckboxOptionsChange={setCheckboxOptions}
              radioOptions={radioOptions}
              onRadioOptionsChange={setRadioOptions}
              radioGroupName={radioGroupName}
              onRadioGroupNameChange={setRadioGroupName}
              selectOptions={selectOptions}
              onSelectOptionsChange={setSelectOptions}
              minSelections={minSelections}
              onMinSelectionsChange={setMinSelections}
              maxSelections={maxSelections}
              onMaxSelectionsChange={setMaxSelections}
              onOptionValueChange={(change) => {
                pendingOptionValueChangesRef.current = [
                  ...pendingOptionValueChangesRef.current,
                  change,
                ];
              }}
            />
          </TabsContent>

          {/* 순위형(ranking) 탭 — Case 3 */}
          <TabsContent value="ranking" className="space-y-4">
            <OptionsLayoutSelector
              value={cellOptionsColumns}
              onChange={setCellOptionsColumns}
              align={horizontalAlign}
              onAlignChange={setHorizontalAlign}
              mobileValue={cellMobileOptionsColumns}
              onMobileChange={(next) => setCellMobileOptionsColumns(next ?? undefined)}
            />
            {showCellAnswerQuote && (
              <AnswerQuoteQuestionControl
                idPrefix="ranking-cell-answer-quote"
                enabled={cellAnswerQuoteEnabled}
                onEnabledChange={setCellAnswerQuoteEnabled}
                name={cellAnswerQuoteName}
                onNameChange={setCellAnswerQuoteName}
                scope="cell"
              />
            )}
            <RankingCellTab
              cellCode={cellCode}
              rankingOptions={rankingOptions}
              onRankingOptionsChange={setRankingOptions}
              rankingConfig={rankingConfig}
              onRankingConfigChange={setRankingConfig}
              allowOtherOption={allowOtherOption}
              onAllowOtherOptionChange={setAllowOtherOption}
              rankSuffixPattern={rankSuffixPattern}
              onRankSuffixPatternChange={setRankSuffixPattern}
              rankVarNames={rankVarNames}
              onRankVarNamesChange={setRankVarNames}
              answerQuoteEnabled={showCellAnswerQuote ? cellAnswerQuoteEnabled : answerQuoteEnabled}
              onOptionValueChange={(change) => {
                pendingOptionValueChangesRef.current = [
                  ...pendingOptionValueChangesRef.current,
                  change,
                ];
              }}
            />
          </TabsContent>

          {/* 순위 옵션 소스(ranking_opt) 탭 — Case 2 */}
          <TabsContent value="ranking_opt" className="space-y-4">
            <RankingOptCellTab
              rankingLabel={rankingLabel}
              onRankingLabelChange={setRankingLabel}
              spssNumericCode={cellSpssNumericCode}
              onSpssNumericCodeChange={setCellSpssNumericCode}
              isOtherRankingCell={isOtherRankingCell}
              onIsOtherRankingCellChange={setIsOtherRankingCell}
              choiceGroups={editChoiceGroups}
              groupMemberCounts={groupMemberCounts}
              choiceGroupId={choiceGroupId}
              onChoiceGroupIdChange={setChoiceGroupId}
              onChoiceGroupsChange={setEditChoiceGroups}
              answerQuoteEnabled={answerQuoteEnabled}
              answerQuoteText={answerQuoteText}
              onAnswerQuoteTextChange={setAnswerQuoteText}
            />
          </TabsContent>

          {/* 보기 옵션 소스(choice_opt) 탭 — Case A */}
          <TabsContent value="choice_opt" className="space-y-4">
            <ChoiceOptCellTab
              choiceLabel={choiceLabel}
              onChoiceLabelChange={setChoiceLabel}
              spssNumericCode={cellSpssNumericCode}
              onSpssNumericCodeChange={setCellSpssNumericCode}
              allowTextInput={choiceAllowTextInput}
              onAllowTextInputChange={setChoiceAllowTextInput}
              branchRule={choiceBranchRule}
              onBranchRuleChange={setChoiceBranchRule}
              allQuestions={questions}
              currentQuestionId={currentQuestionId}
              choiceGroups={editChoiceGroups}
              groupMemberCounts={groupMemberCounts}
              choiceGroupId={choiceGroupId}
              onChoiceGroupIdChange={setChoiceGroupId}
              onChoiceGroupsChange={setEditChoiceGroups}
              answerQuoteEnabled={answerQuoteEnabled}
              answerQuoteText={answerQuoteText}
              onAnswerQuoteTextChange={setAnswerQuoteText}
            />
          </TabsContent>

          {/* 계산 셀(calc) 탭 — 다른 셀·질문 응답을 수식으로 계산해 읽기 전용 표시 */}
          <TabsContent value="calc" className="space-y-4">
            <div className="text-sm text-gray-600">
              다른 셀·질문의 숫자 응답을 수식으로 계산해 읽기 전용으로 표시합니다.
            </div>
            <FormulaExprEditor
              value={formula}
              onChange={setFormula}
              ownQuestion={ownQuestion}
              allQuestions={questions}
            />
            <NumberFormatFields
              idPrefix="calc-nf"
              value={cellNumberFormat}
              onChange={setCellNumberFormat}
            />

            <div className="space-y-3 rounded border p-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={calcValidationEnabled}
                  onChange={(e) => setCalcValidationEnabled(e.target.checked)}
                />
                계산 결과 검증 — 계산 값이 기준을 만족하지 않으면 다음 진행을 차단
              </label>
              {calcValidationEnabled ? (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    <span>계산 결과가 기준값</span>
                    <select
                      value={calcValidationOperator}
                      onChange={(e) =>
                        setCalcValidationOperator(e.target.value as CalcCellValidation['operator'])
                      }
                      className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm"
                      aria-label="비교 방식"
                    >
                      <option value="eq">과 같아야 함</option>
                      <option value="ne">과 달라야 함</option>
                      <option value="gte">이상이어야 함</option>
                      <option value="lte">이하여야 함</option>
                      <option value="gt">초과여야 함</option>
                      <option value="lt">미만이어야 함</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-gray-600">기준값 수식</span>
                    <FormulaExprEditor
                      value={calcValidationTarget}
                      onChange={setCalcValidationTarget}
                      ownQuestion={ownQuestion}
                      allQuestions={questions}
                    />
                  </div>
                  {(calcValidationOperator === 'eq' || calcValidationOperator === 'ne') && (
                    <div className="flex items-center gap-2 text-sm">
                      <span>오차 허용 ±</span>
                      <Input
                        className="w-24"
                        value={calcValidationToleranceRaw}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v.includes('-')) return;
                          if (isPartialNumericInput(v)) setCalcValidationToleranceRaw(v);
                        }}
                        placeholder="0"
                      />
                    </div>
                  )}
                  <Input
                    value={calcValidationErrorMessage}
                    onChange={(e) => setCalcValidationErrorMessage(e.target.value)}
                    placeholder="위반 시 표시할 문구 (비우면 기본 문구, 기준값 미노출)"
                  />
                </>
              ) : null}
            </div>
          </TabsContent>
        </Tabs>

        {/* 셀 게이팅 활성 조건 — 인터랙티브 셀 전체(GATABLE_CELL_TYPES).
            prefill(defaultValueTemplate) input 셀만 서버 prefill 강제 복원과
            양립 불가라 설정 금지(섹션 숨김, 스펙 5절) */}
        {GATABLE_CELL_TYPES.has(contentType) &&
          !(contentType === 'input' && inputDefaultValueTemplate.trim().length > 0) && (
            <CellGatingEditor
              cellId={cell.id}
              rowCells={gatingRowCells}
              condition={gatingCondition}
              requiredWhenEnabled={gatingRequiredWhenEnabled}
              onConditionChange={(cond) => {
                // 게이팅 최초 활성화 시 기존 필수 체크를 "활성화되면 필수"로 수렴
                // (필수 체크박스가 숨겨지며 의도가 사라지지 않도록, 스펙 5절)
                if (cond && !gatingCondition && cellRequired) {
                  setGatingRequiredWhenEnabled(true);
                }
                setGatingCondition(cond);
              }}
              onRequiredWhenEnabledChange={setGatingRequiredWhenEnabled}
            />
          )}

        {/* 필수 응답 셀 — 인터랙티브 셀 공용 (input/radio/checkbox/select/ranking).
            게이팅이 켜진 셀은 "활성화되면 필수"로 수렴하므로 이 체크박스를 숨긴다 */}
        {REQUIRED_CELL_TYPES.has(contentType) &&
          !(GATABLE_CELL_TYPES.has(contentType) && gatingCondition) && (
            <div className="mt-6 border-t border-gray-200 pt-6">
              <div className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  id="cell-required"
                  checked={cellRequired}
                  onChange={(e) => setCellRequired(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="cell-required" className="shrink-0 cursor-pointer">
                  필수 응답 셀
                </label>
                {cellRequired ? (
                  <Input
                    id="cell-required-message"
                    value={cellRequiredMessage}
                    onChange={(e) => setCellRequiredMessage(e.target.value)}
                    placeholder={DEFAULT_REQUIRED_CELL_MESSAGE}
                    className="ml-2 h-8 flex-1 text-sm"
                  />
                ) : (
                  <span className="text-xs text-gray-400">
                    지정 셀이 응답되어야 다음으로 진행됩니다
                  </span>
                )}
              </div>
            </div>
          )}

        {/* 셀 병합 설정 */}
        <CellMergeFields form={form} setters={setters} />

        {/* 모바일 카드 표시 설정 */}
        <CellMobileFields
          form={form}
          setters={setters}
          columnLabel={columnLabel}
          showContentMobileDisplay={showContentMobileDisplay}
          showInteractiveMobileLabel={showInteractiveMobileLabel}
        />

        <div className="mt-6 border-t border-gray-200 pt-6">
          <h3 className="mb-4 text-sm font-semibold text-gray-900">셀 스타일</h3>
          <CellStyleFields
            key={cell.id}
            textBold={textBold}
            backgroundColor={backgroundColor}
            textColor={textColor}
            onTextBoldChange={setTextBold}
            onBackgroundColorChange={setBackgroundColor}
            onTextColorChange={setTextColor}
          />
        </div>

        {/* 셀 컨텐츠 정렬 설정 */}
        <CellAlignFields form={form} setters={setters} />

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <div className="flex items-center space-x-2">
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                <span>저장 중...</span>
              </div>
            ) : (
              '저장'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
