'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CheckSquare,
  ChevronDown,
  Circle,
  Image as ImageIcon,
  ListOrdered,
  PenLine,
  Tag,
  Type,
  Video,
  X,
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
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { CompleteQuestionWrite } from '@/db/schema/question-persisted-fields';
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
  GROUPABLE_CELL_TYPES,
  INPUT_TEXT_ALIGN_CELL_TYPES,
  MOBILE_DISPLAY_CELL_TYPES,
  MOBILE_LABEL_CELL_TYPES,
  REQUIRED_CELL_TYPES,
  TEXT_POSITION_CELL_TYPES,
  buildUpdatedCell,
} from '@/features/survey-builder/table-editor/cell-editor/utils/serialize-cell';
import type { CellFormState } from '@/features/survey-builder/table-editor/cell-editor/utils/serialize-cell';
import { CellStyleFields } from '@/features/survey-builder/table-editor/cell-style-fields';
import { VariableButton } from '@/features/survey-builder/variable-button';
import { runAsyncAction } from '@/utils/run-async-action';
import { GATABLE_CELL_TYPES } from '@/lib/survey/cell-gating';
import { generateId } from '@/lib/utils';
import { client } from '@/shared/lib/rpc';
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
import {
  persistConditionRemaps,
  settleCreatedQuestion,
} from '@/features/survey-builder/lib/persist-question';
import { getMaxSpssCode } from '@/utils/option-code-generator';
import { collectRankingOptCells, hasExistingOtherRankingCell } from '@/utils/ranking-source';
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
import { InputCellTab } from './input-cell-tab';
import { RankingCellTab } from './ranking-cell-tab';
import { RankingOptCellTab } from './ranking-opt-cell-tab';

const TEXT_POSITION_OPTIONS: Array<{
  value: NonNullable<TableCell['textPosition']>;
  icon: typeof ArrowUp;
  label: string;
}> = [
  { value: 'top', icon: ArrowUp, label: '위' },
  { value: 'bottom', icon: ArrowDown, label: '아래' },
  { value: 'left', icon: ArrowLeft, label: '왼쪽' },
  { value: 'right', icon: ArrowRight, label: '오른쪽' },
];

// 입력값 가로 정렬 — 'inherit' 은 미지정으로, 셀 정렬(horizontalAlign)을 따른다
const INPUT_TEXT_ALIGN_OPTIONS: Array<{
  value: CellFormState['inputTextAlign'];
  icon: typeof AlignLeft | null;
  label: string;
}> = [
  { value: 'inherit', icon: null, label: '셀 정렬 따름' },
  { value: 'left', icon: AlignLeft, label: '왼쪽' },
  { value: 'center', icon: AlignCenter, label: '가운데' },
  { value: 'right', icon: AlignRight, label: '오른쪽' },
];

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
const writeBuilderState = useSurveyBuilderStore.setState;

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
    mobileDisplay,
    mobileLabel,
    verticalAlign,
    textPosition,
    inputTextAlign,
    isMergeEnabled,
    rowspan,
    colspan,
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
    setTextContent,
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
    setMobileDisplay,
    setMobileLabel,
    setVerticalAlign,
    setTextPosition,
    setInputTextAlign,
    setIsMergeEnabled,
    setRowspan,
    setColspan,
    setCellCode,
    setIsCustomCellCode,
    setExportLabel,
    setIsCustomExportLabel,
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
    // 빌더 validator: ranking 셀은 옵션이 최소 1개 이상이어야 함.
    if (contentType === 'ranking' && rankingOptions.length === 0) {
      toast.error('순위형 셀은 최소 1개 이상의 옵션이 필요합니다.');
      return;
    }
    // ranking_opt 셀은 content/rankingLabel/imageUrl/videoUrl 중 하나 이상 필요.
    // 단, "기타로 사용" 셀은 드롭다운 라벨이 자동 폴백(기타 (직접 입력))되므로 빈 상태도 허용.
    if (contentType === 'ranking_opt' && !isOtherRankingCell) {
      const hasContent = !!(
        textContent.trim() ||
        rankingLabel.trim() ||
        imageUrl.trim() ||
        videoUrl.trim()
      );
      if (!hasContent) {
        toast.error(
          '순위 옵션 소스 셀은 텍스트/라벨/이미지/비디오 중 하나 이상을 설정해야 합니다.',
        );
        return;
      }
    }
    if (contentType === 'ranking_opt' && isOtherRankingCell) {
      // 같은 질문 내 기타 ranking_opt 셀이 이미 존재하면 차단 (자기 자신은 제외).
      const hostQuestion = questions.find((q) => q.id === currentQuestionId);
      if (hasExistingOtherRankingCell(hostQuestion?.tableRowsData, cell.id)) {
        toast.error(
          '이 질문에는 이미 "기타"로 지정된 순위 옵션 셀이 있습니다. 질문당 최대 1개만 지정할 수 있습니다.',
        );
        return;
      }
    }

    setIsSaving(true);
    // try/finally 는 React Compiler 가 낮추지 못해 모달 전체가 skip 됐다 — 러너에 가둔다(B-2a 선례).
    await runAsyncAction(
      async () => {
        // 폼 상태를 저장될 TableCell 로 직렬화 (조건부 spread 로 optional 필드 처리).
        const updatedCell: TableCell = buildUpdatedCell(form, cell);

        // 로컬 스토어 업데이트 (셀 저장) — onChoiceGroupsChange 보다 먼저 수행해야
        // dynamic-table-editor 의 currentRowsRef 가 이미 새 셀을 포함한 상태에서 prune 이 동작한다.
        // 옵션 optionCode 편집으로 누적된 value 변경 쌍도 같은 커밋에 실어 게이팅을 리매핑한다.
        onSave(
          updatedCell,
          pendingOptionValueChangesRef.current.length > 0
            ? pendingOptionValueChangesRef.current
            : undefined,
        );

        // choice_opt 또는 ranking_opt 탭에서 그룹 변경이 있었으면 정리 후 부모에게 통보.
        // prune 은 updatedCell(이 셀 반영 후)의 rowsData 기준으로 계산해야 하므로
        // onSave(셀 반영) 다음에 호출한다.
        // 실질적인 prune(빈 그룹 제거)은 dynamic-table-editor 의 onChoiceGroupsChange 핸들러에서 수행한다.
        if (GROUPABLE_CELL_TYPES.has(contentType)) {
          onChoiceGroupsChange?.(editChoiceGroups);
        }

        // 서버에 질문 저장/업데이트
        if (currentQuestionId && readBuilderState().currentSurvey.id) {
          const question = questions.find((q) => q.id === currentQuestionId);
          // 저장/prune 베이스는 에디터의 권위 있는 최신 행을 우선 사용한다.
          // store.tableRowsData 는 구조 편집이 formData 에만 반영되어 stale 할 수 있어
          // 그걸로 prune 하면 그룹 멤버를 놓쳐 그룹이 풀린다(getLatestRows 폴백은 store).
          const baseRows = getLatestRows?.() ?? question?.tableRowsData;
          if (question && baseRows) {
            // 최신 행에서 해당 셀을 업데이트(onSave 로 이미 반영됐어도 id 기준 재적용은 idempotent)
            const updatedRowsData = baseRows.map((row) => ({
              ...row,
              cells: row.cells.map((c) => (c.id === cell.id ? updatedCell : c)),
            }));

            // choice_opt 저장 시 choiceGroups 도 함께 저장한다.
            // prune 은 updatedRowsData 기준으로 계산해 빈 그룹이 DB 에 남지 않도록 한다.
            // 마지막 멤버 해제로 전부 비면 빈 배열을 명시 저장해야 phantom 그룹이 남지 않는다.
            const prunedChoiceGroups = (() => {
              if (!GROUPABLE_CELL_TYPES.has(contentType)) return undefined;
              const memberIds = new Set(
                [
                  ...collectChoiceOptCells(updatedRowsData),
                  ...collectRankingOptCells(updatedRowsData),
                ]
                  .map((c) => c.choiceGroupId)
                  .filter((id): id is string => !!id),
              );
              const pruned = editChoiceGroups.filter((g) => memberIds.has(g.id));
              // 원래도 그룹이 없던 질문이면 빈 배열을 굳이 쓰지 않는다 (NULL 유지)
              if (pruned.length === 0 && (question.choiceGroups ?? []).length === 0)
                return undefined;
              return pruned;
            })();

            // 신규 판정은 dirty 추적(questionChanges.added) 기준 — 로컬 id도 randomUUID라
            // UUID 형식 검사로는 미영속 질문을 구분할 수 없다(0행 update로 저장 실패하던 버그).
            const isNewQuestion = !!readBuilderState().questionChanges.added[currentQuestionId];

            // React Compiler 는 try 문 안의 조건·옵셔널 체이닝을 낮추지 못한다 — 본문을 러너에 가둔다.
            const persistQuestion = async () => {
              await ensureSurvey();

              // 리매핑 스코프 수집 — 스코프 저장(saveSurveyScoped)의 입력.
              // create 분기에서 id 가 스왑되면 이후 리매핑은 새 id 기준이어야 한다.
              const remapScopes: Array<{ questionIds: string[]; groupIds: string[] }> = [];
              let effectiveQuestionId = currentQuestionId;

              // 행은 편집 세션의 열 구조 변경을 업고 간다 — 에디터 최신 columns/headerGrid 를
              // 항상 짝으로 커밋해야 스토어/DB 가 혼합 상태(columns N + 셀 N+1)가 되지 않는다.
              // getLatestColumns 미배선(구 호출부)이면 키 부재 = 미변경 규약 그대로 둔다.
              const latestColumns = getLatestColumns?.();
              const structurePatch = {
                ...(latestColumns !== undefined ? { tableColumns: latestColumns } : {}),
                // headerGrid 는 "키 부재 = 미변경, 해제는 명시적 null" 규약 — 배선된 경우에만 싣는다.
                ...(getLatestHeaderGrid ? { tableHeaderGrid: getLatestHeaderGrid() ?? null } : {}),
              };

              if (!isNewQuestion) {
                // 이미 DB에 저장된 질문: 업데이트
                await client.surveyBuilder.questions.update({
                  questionId: currentQuestionId,
                  surveyId: readBuilderState().currentSurvey.id,
                  data: {
                    tableRowsData: updatedRowsData,
                    ...structurePatch,
                    ...(prunedChoiceGroups !== undefined
                      ? { choiceGroups: prunedChoiceGroups }
                      : {}),
                  },
                });
                // store 도 동일 데이터로 동기화. 표시 조건/장기 계산식 picker 가
                // store 를 직접 구독하므로 누락 시 셀 라벨 변경이 stale 로 표시됨.
                writeBuilderState((state) => ({
                  currentSurvey: {
                    ...state.currentSurvey,
                    questions: state.currentSurvey.questions.map((q) =>
                      q.id === currentQuestionId
                        ? {
                            ...q,
                            tableRowsData: updatedRowsData,
                            ...structurePatch,
                            ...(prunedChoiceGroups !== undefined
                              ? { choiceGroups: prunedChoiceGroups }
                              : {}),
                          }
                        : q,
                    ),
                  },
                }));
              } else {
                // 미영속 질문: id를 그대로 전달해 서버에서 동일 id로 생성.
                // 가드: PERSISTED_QUESTION_FIELDS 를 모두 싣도록 satisfies 로 강제한다
                // (question-edit-modal 의 CREATE 경로와 같은 계약). 셀 모달은 질문 폼을
                // 소유하지 않으므로 구조 3종(열/헤더그리드/행)과 그룹만 에디터 최신값을 쓰고,
                // 나머지 질문 필드는 스토어 질문 값을 그대로 실어 create-drop 을 막는다.
                const createPayload = {
                  id: currentQuestionId,
                  surveyId: readBuilderState().currentSurvey.id,
                  groupId: question.groupId,
                  type: question.type,
                  title: question.title || '',
                  description: question.description,
                  required: question.required ?? false,
                  requiredMessage: question.requiredMessage ?? null,
                  order: question.order ?? 0,
                  options: question.options,
                  selectLevels: question.selectLevels,
                  tableTitle: question.tableTitle,
                  tableColumns: latestColumns ?? question.tableColumns,
                  tableRowsData: updatedRowsData,
                  // 에디터가 배선돼 있으면 최신 그리드가 권위 — 해제는 null 로 명시한다.
                  // 미배선(구 호출부)일 때만 스토어 값으로 폴백한다.
                  tableHeaderGrid: getLatestHeaderGrid
                    ? (getLatestHeaderGrid() ?? null)
                    : (question.tableHeaderGrid ?? null),
                  allowOtherOption: question.allowOtherOption,
                  optionsColumns: question.optionsColumns,
                  optionsAlign: question.optionsAlign,
                  mobileOptionsColumns: question.mobileOptionsColumns,
                  minSelections: question.minSelections,
                  maxSelections: question.maxSelections,
                  noticeContent: question.noticeContent,
                  requiresAcknowledgment: question.requiresAcknowledgment,
                  placeholder: question.placeholder,
                  defaultValueTemplate: question.defaultValueTemplate,
                  inputType: question.inputType,
                  emptyDefault: question.emptyDefault,
                  numberFormat: question.numberFormat,
                  piiEncrypted: question.piiEncrypted,
                  tableValidationRules: question.tableValidationRules,
                  sumConstraints: question.sumConstraints,
                  dynamicRowConfigs: question.dynamicRowConfigs,
                  hideColumnLabels: question.hideColumnLabels,
                  mobileOriginalTable: question.mobileOriginalTable,
                  mobileTableDisplayMode: question.mobileTableDisplayMode,
                  mobileDrilldownOmitLeadingColumns: question.mobileDrilldownOmitLeadingColumns,
                  mobileDrilldownRepeatHeaderStartRow: question.mobileDrilldownRepeatHeaderStartRow,
                  mobileDrilldownRepeatHeaderEndRow: question.mobileDrilldownRepeatHeaderEndRow,
                  hideTitle: question.hideTitle,
                  pageBreakBefore: question.pageBreakBefore,
                  rankingConfig: question.rankingConfig,
                  // prune 결과가 없으면(그룹 대상 셀이 아니거나 원래 그룹이 없던 질문)
                  // 스토어 값을 그대로 유지한다 — 무관한 셀 저장이 그룹을 지우면 안 된다.
                  choiceGroups: prunedChoiceGroups ?? question.choiceGroups,
                  displayCondition: question.displayCondition,
                  questionCode: question.questionCode,
                  isCustomSpssVarName: question.isCustomSpssVarName,
                  exportLabel: question.exportLabel,
                  spssVarType: question.spssVarType,
                  spssMeasure: question.spssMeasure,
                  exportCellOrder: question.exportCellOrder,
                  answerQuoteEnabled: question.answerQuoteEnabled,
                  answerQuoteName: question.answerQuoteName,
                  answerQuoteText: question.answerQuoteText,
                } satisfies CompleteQuestionWrite;
                const createdQuestion = await client.surveyBuilder.questions.create(createPayload);

                if (createdQuestion?.id) {
                  // UPDATE 분기와 동일하게 store 도 방금 커밋한 구조로 동기화한다 —
                  // 빠뜨리면 질문 모달 취소 후 재진입 시 DB(신 구조)와 store(구 구조)가
                  // 갈라져 stale 구조가 표시되고 이후 질문 저장이 DB 변경을 되덮는다.
                  writeBuilderState((state) => ({
                    currentSurvey: {
                      ...state.currentSurvey,
                      questions: state.currentSurvey.questions.map((q) =>
                        q.id === currentQuestionId
                          ? {
                              ...q,
                              tableRowsData: updatedRowsData,
                              ...structurePatch,
                              ...(prunedChoiceGroups !== undefined
                                ? { choiceGroups: prunedChoiceGroups }
                                : {}),
                            }
                          : q,
                      ),
                    },
                  }));
                }
                const settled = settleCreatedQuestion(currentQuestionId, createdQuestion?.id);
                if (settled.newQuestionId) effectiveQuestionId = settled.newQuestionId;
                if (settled.remapScope) remapScopes.push(settled.remapScope);
              }

              // 새 옵션 value 가 DB 에 커밋된 직후 — 이 표 질문을 sourceQuestionId 로 참조하는
              // 다른 질문/그룹/행/열의 표시조건(table-cell-check expectedValues 는 셀 옵션 value
              // 공간)을 같은 지점에서 리매핑하고 영속시킨다. 질문 편집 모달의 저장까지 미루면
              // "셀 저장 후 질문 모달 취소" 경로에서 DB 에 신 value + 구 조건이 영구 잔류한다
              // (질문 모달의 취소 롤백은 tableRowsData 를 되돌리지 않는다).
              // 같은 표의 게이팅(enabledWhen)은 onSave→updateCell 이 이미 같은 커밋에 실었다.
              // 조건 참조는 위에서 이미 새 id 로 스왑됐을 수 있으므로 effectiveQuestionId 기준.
              if (pendingOptionValueChangesRef.current.length > 0) {
                // 같은 표의 다른 셀이 같은 옵션 value(자동 발번 option-N)를 쓰는 것이 일상이므로,
                // 이 셀의 행·열 좌표와 cellId 로 스코프를 좁혀 그 셀을 실제로 참조하는 조건만
                // 리매핑한다 (무관 셀을 겨냥한 조건의 expectedValues 오염 방지).
                const cellRow = updatedRowsData.find((row) =>
                  row.cells.some((c) => c.id === cell.id),
                );
                const cellScope = cellRow
                  ? {
                      rowId: cellRow.id,
                      columnIndex: cellRow.cells.findIndex((c) => c.id === cell.id),
                      cellId: cell.id,
                    }
                  : undefined;
                for (const change of pendingOptionValueChangesRef.current) {
                  remapScopes.push(
                    remapOptionValueInConditions(
                      effectiveQuestionId,
                      change.oldValue,
                      change.newValue,
                      cellScope,
                    ),
                  );
                }
                pendingOptionValueChangesRef.current = [];
              }

              // 리매핑이 실제 변경을 만들었으면 그 범위만 영속 — 빌더에 대기 중인 무관한
              // pending(질문 추가/삭제, 그룹 삭제 등)은 건드리지 않는다. 질문은 스코프 저장,
              // 그룹 조건은 그룹 전용 RPC 로 개별 영속한다 (전역 메타데이터 저장에 실으면
              // 미저장 제목 변경·그룹 삭제까지 동반 커밋된다).
              await persistConditionRemaps(remapScopes, saveSurveyScoped);
            };
            try {
              await persistQuestion();
            } catch (error) {
              console.error('질문 저장/업데이트 실패:', error);
            }
          }
        }
      },
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

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="common-text-content">셀 텍스트 내용</Label>
            <div className="flex items-start gap-2">
              <Textarea
                id="common-text-content"
                ref={textContentRef}
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="셀에 표시할 텍스트를 입력하세요 (모든 타입에서 표시됨)"
                rows={3}
                className="flex-1 resize-none"
              />
              {variableCatalog.length > 0 && (
                <VariableButton
                  catalog={variableCatalog}
                  inputRef={textContentRef}
                  onChange={(v) => setTextContent(v)}
                />
              )}
            </div>
            {textContent && (
              <div className="rounded bg-gray-50 p-2 text-xs text-gray-500">
                미리보기: {textContent}
              </div>
            )}

            {TEXT_POSITION_CELL_TYPES.has(contentType) && (
              <div className="space-y-2 pt-1">
                <Label className="text-sm font-medium">텍스트 위치</Label>
                <div className="flex gap-2">
                  {TEXT_POSITION_OPTIONS.map(({ value, icon: Icon, label }) => (
                    <Button
                      key={value}
                      type="button"
                      variant={textPosition === value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setTextPosition(value)}
                      className="flex-1"
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      {label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  왼쪽/오른쪽 선택 시 텍스트와 입력 영역이 한 줄에 배치되고 세로 가운데 정렬됩니다.
                </p>
              </div>
            )}

            {INPUT_TEXT_ALIGN_CELL_TYPES.has(contentType) && (
              <div className="space-y-2 pt-1">
                <Label className="text-sm font-medium">입력값 정렬</Label>
                <div className="flex gap-2">
                  {INPUT_TEXT_ALIGN_OPTIONS.map(({ value, icon: Icon, label }) => (
                    <Button
                      key={value}
                      type="button"
                      variant={inputTextAlign === value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setInputTextAlign(value)}
                      className="flex-1"
                    >
                      {Icon && <Icon className="mr-2 h-4 w-4" />}
                      {label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  값이 칸 안에서 채워지는 방향입니다. 오른쪽을 고르면 숫자가 오른쪽 끝에 붙어
                  자릿수를 비교하기 좋습니다.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cell-code">셀 코드</Label>
                <div className="flex items-center gap-1">
                  <Input
                    id="cell-code"
                    value={cellCode}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCellCode(val);
                      // 사용자가 자동생성값과 다르게 수정하면 커스텀으로 표시
                      setIsCustomCellCode(val !== '' && val !== autoCellCode);
                    }}
                    placeholder={autoCellCode || '예: Q4-1_r1_c1'}
                    className="h-9"
                  />
                  {isCustomCellCode && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setCellCode(autoCellCode || '');
                        setIsCustomCellCode(false);
                      }}
                      title="자동값으로 초기화"
                      className="h-9 w-9 shrink-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                {autoCellCode && isCustomCellCode && (
                  <p className="text-[10px] text-gray-400">자동: {autoCellCode}</p>
                )}
                {!cellCode &&
                  (INTERACTIVE_CELL_TYPES.has(contentType) || contentType === 'ranking') && (
                    <p className="text-[10px] text-amber-500">
                      셀코드가 비어있으면 내보내기에서 제외됩니다.
                    </p>
                  )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="export-label">엑셀 라벨</Label>
                <div className="flex items-center gap-1">
                  <Input
                    id="export-label"
                    value={exportLabel}
                    onChange={(e) => {
                      const val = e.target.value;
                      setExportLabel(val);
                      setIsCustomExportLabel(val !== '' && val !== autoExportLabel);
                    }}
                    placeholder={autoExportLabel || '예: 가구TV보유_TV종류_UHD'}
                    className="h-9"
                  />
                  {isCustomExportLabel && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setExportLabel(autoExportLabel || '');
                        setIsCustomExportLabel(false);
                      }}
                      title="자동값으로 초기화"
                      className="h-9 w-9 shrink-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                {autoExportLabel && isCustomExportLabel && (
                  <p className="text-[10px] text-gray-400">자동: {autoExportLabel}</p>
                )}
              </div>
            </div>

            {/* SPSS 변수 타입 / 측정 수준 (입력 셀만 표시) */}
            {INTERACTIVE_CELL_TYPES.has(contentType) && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="cell-spss-var-type" className="text-xs">
                    변수 타입
                  </Label>
                  <select
                    id="cell-spss-var-type"
                    value={spssVarType || ''}
                    onChange={(e) =>
                      setSpssVarType((e.target.value || undefined) as TableCell['spssVarType'])
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  >
                    <option value="" disabled>
                      선택
                    </option>
                    <option value="Numeric">Numeric</option>
                    <option value="String">String</option>
                    <option value="Date">Date</option>
                    <option value="DateTime">DateTime</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cell-spss-measure" className="text-xs">
                    측정 수준
                  </Label>
                  <select
                    id="cell-spss-measure"
                    value={spssMeasure || ''}
                    onChange={(e) =>
                      setSpssMeasure((e.target.value || undefined) as TableCell['spssMeasure'])
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  >
                    <option value="" disabled>
                      선택
                    </option>
                    <option value="Nominal">Nominal (명목)</option>
                    <option value="Ordinal">Ordinal (순서)</option>
                    <option value="Continuous">Continuous (척도)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

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
        <div className="mt-6 border-t border-gray-200 pt-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-900">셀 병합</h3>
            <div className="flex items-center gap-2">
              <Label htmlFor="merge-toggle" className="cursor-pointer text-sm text-gray-600">
                {isMergeEnabled ? '활성화됨' : '비활성화됨'}
              </Label>
              <Switch
                id="merge-toggle"
                checked={isMergeEnabled}
                onCheckedChange={(checked) => {
                  setIsMergeEnabled(checked);
                  if (!checked) {
                    setRowspan(1);
                    setColspan(1);
                  } else {
                    // 토글 켤 때 빈 값이면 1로 설정
                    if (rowspan === '') setRowspan(1);
                    if (colspan === '') setColspan(1);
                  }
                }}
              />
            </div>
          </div>

          {isMergeEnabled && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rowspan">행 병합 (세로로 아래)</Label>
                  <Input
                    id="rowspan"
                    type="number"
                    min={1}
                    value={rowspan}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '') {
                        setRowspan('');
                      } else {
                        const num = parseInt(value);
                        if (!isNaN(num) && num >= 1) {
                          setRowspan(num);
                        }
                      }
                    }}
                    onBlur={() => {
                      if (rowspan === '') {
                        setRowspan(1);
                      }
                    }}
                    className="w-full"
                    placeholder="1"
                  />
                  <p className="text-xs text-gray-500">
                    현재: {rowspan === '' || rowspan === 1 ? '병합 안 함' : `${rowspan}칸 병합`}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="colspan">열 병합 (가로로 우측)</Label>
                  <Input
                    id="colspan"
                    type="number"
                    min={1}
                    value={colspan}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '') {
                        setColspan('');
                      } else {
                        const num = parseInt(value);
                        if (!isNaN(num) && num >= 1) {
                          setColspan(num);
                        }
                      }
                    }}
                    onBlur={() => {
                      if (colspan === '') {
                        setColspan(1);
                      }
                    }}
                    className="w-full"
                    placeholder="1"
                  />
                  <p className="text-xs text-gray-500">
                    현재: {colspan === '' || colspan === 1 ? '병합 안 함' : `${colspan}칸 병합`}
                  </p>
                </div>
              </div>

              {((typeof rowspan === 'number' && rowspan > 1) ||
                (typeof colspan === 'number' && colspan > 1)) && (
                <div className="mt-3 rounded-lg bg-yellow-50 p-3">
                  <p className="text-xs text-yellow-800">
                    <strong>주의:</strong> 셀을 병합하면 오른쪽/아래에 있는 셀들이 자동으로
                    숨겨집니다. 병합된 영역만큼의 공간이 필요하므로 테이블 구조를 미리 확인하세요.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* 모바일 카드 표시 설정 */}
        {(showContentMobileDisplay || showInteractiveMobileLabel) && (
          <div className="mt-6 border-t border-gray-200 pt-6">
            <h3 className="mb-3 text-sm font-medium text-gray-900">모바일 카드 표시</h3>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mobileDisplay === 'hidden' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMobileDisplay('hidden')}
                className="flex-1"
              >
                숨기기
              </Button>
              {showContentMobileDisplay ? (
                <>
                  {contentType === 'text' && (
                    <>
                      <Button
                        type="button"
                        variant={mobileDisplay === 'header' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setMobileDisplay('header')}
                        className="flex-1"
                      >
                        헤더
                      </Button>
                      {/* 카드 범례: 이 표의 모든 응답 카드 상단에 한 행으로 표시 (스케일 앵커 라벨용) */}
                      <Button
                        type="button"
                        variant={mobileDisplay === 'legend' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setMobileDisplay('legend')}
                        className="flex-1"
                      >
                        카드 범례
                      </Button>
                    </>
                  )}
                  <Button
                    type="button"
                    variant={mobileDisplay === 'inline' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMobileDisplay('inline')}
                    className="flex-1"
                  >
                    바로표시
                  </Button>
                  <Button
                    type="button"
                    variant={mobileDisplay === 'collapsed' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMobileDisplay('collapsed')}
                    className="flex-1"
                  >
                    자세히
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant={mobileDisplay !== 'hidden' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMobileDisplay('inline')}
                  className="flex-1"
                >
                  표시
                </Button>
              )}
            </div>

            {/* 셀 라벨 — 모바일 카드/드릴다운에서 입력칸 위에 붙는 제목 */}
            {showInteractiveMobileLabel && mobileDisplay !== 'hidden' && (
              <div className="mt-4 space-y-2">
                <Label htmlFor="mobile-label">셀 라벨</Label>
                <Input
                  id="mobile-label"
                  value={mobileLabel}
                  onChange={(e) => setMobileLabel(e.target.value)}
                  placeholder={exportLabel || columnLabel || '열 제목'}
                  className="w-full"
                />
                <p className="text-xs text-gray-500">
                  모바일 카드에서 입력칸 위에 표시되는 제목입니다. 비워두면 엑셀 라벨, 그것도 없으면
                  열 제목이 사용됩니다.
                </p>
              </div>
            )}
          </div>
        )}

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
        <div className="mt-6 border-t border-gray-200 pt-6">
          <h3 className="mb-4 text-sm font-medium text-gray-900">컨텐츠 정렬</h3>

          <div className="space-y-4">
            {/* 가로 정렬 */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">가로 정렬</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={horizontalAlign === 'left' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setHorizontalAlign('left')}
                  className="flex-1"
                >
                  <AlignLeft className="mr-2 h-4 w-4" />
                  왼쪽
                </Button>
                <Button
                  type="button"
                  variant={horizontalAlign === 'center' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setHorizontalAlign('center')}
                  className="flex-1"
                >
                  <AlignCenter className="mr-2 h-4 w-4" />
                  가운데
                </Button>
                <Button
                  type="button"
                  variant={horizontalAlign === 'right' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setHorizontalAlign('right')}
                  className="flex-1"
                >
                  <AlignRight className="mr-2 h-4 w-4" />
                  오른쪽
                </Button>
              </div>
            </div>

            {/* 세로 정렬 */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">세로 정렬</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={verticalAlign === 'top' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setVerticalAlign('top')}
                  className="flex-1"
                >
                  <AlignVerticalJustifyStart className="mr-2 h-4 w-4" />
                  위쪽
                </Button>
                <Button
                  type="button"
                  variant={verticalAlign === 'middle' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setVerticalAlign('middle')}
                  className="flex-1"
                >
                  <AlignVerticalJustifyCenter className="mr-2 h-4 w-4" />
                  가운데
                </Button>
                <Button
                  type="button"
                  variant={verticalAlign === 'bottom' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setVerticalAlign('bottom')}
                  className="flex-1"
                >
                  <AlignVerticalJustifyEnd className="mr-2 h-4 w-4" />
                  아래쪽
                </Button>
              </div>
            </div>

            {/* 미리보기 */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">정렬 미리보기</Label>
              <div className="rounded-lg border bg-gray-50 p-4">
                <div
                  className={`flex h-32 w-full rounded border-2 border-dashed border-gray-300 ${
                    horizontalAlign === 'left'
                      ? 'justify-start'
                      : horizontalAlign === 'center'
                        ? 'justify-center'
                        : 'justify-end'
                  } ${
                    verticalAlign === 'top'
                      ? 'items-start'
                      : verticalAlign === 'middle'
                        ? 'items-center'
                        : 'items-end'
                  }${textBold ? 'font-bold' : ''}`}
                  style={{
                    ...(backgroundColor ? { backgroundColor } : {}),
                    ...(textColor ? { color: textColor } : {}),
                  }}
                >
                  <div className="rounded bg-blue-500 px-4 py-2 text-sm text-white">컨텐츠</div>
                </div>
              </div>
            </div>
          </div>
        </div>

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
