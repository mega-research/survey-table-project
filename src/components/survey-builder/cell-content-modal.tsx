'use client';

import { useEffect, useRef, useState } from 'react';

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
  Image,
  ListOrdered,
  PenLine,
  Tag,
  Type,
  Video,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { toast } from 'sonner';

import { client } from '@/shared/lib/rpc';
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
import { useEnsureSurveyInDb } from '@/hooks/use-ensure-survey-in-db';
import { generateId } from '@/lib/utils';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { useSurveyUIStore } from '@/stores/ui-store';
import { ChoiceGroup, TableCell, TableRow } from '@/types/survey';
import { collectChoiceOptCells } from '@/utils/choice-source';
import { isPartialNumericInput } from '@/utils/numeric-input';
import { getMaxSpssCode } from '@/utils/option-code-generator';
import { collectRankingOptCells, hasExistingOtherRankingCell } from '@/utils/ranking-source';
import {
  type ContentType,
  GROUPABLE_CELL_TYPES,
  MOBILE_LABEL_CELL_TYPES,
  MOBILE_DISPLAY_CELL_TYPES,
  TEXT_POSITION_CELL_TYPES,
  buildUpdatedCell,
} from '@/utils/serialize-cell';
import {
  INTERACTIVE_CELL_TYPES,
  generateCellCode,
  generateExportLabel,
  inferSpssMeasure,
  inferSpssVarType,
} from '@/utils/table-cell-code-generator';

import { useCellForm } from './hooks/use-cell-form';
import { CellChoiceEditor } from './cell-choice-editor';
import { CellImageEditor } from './cell-image-editor';
import { CellContentLayout } from './cells/cell-content-layout';
import { ChoiceOptCellTab } from './choice-opt-cell-tab';
import { OptionsLayoutSelector } from './options-layout-selector';
import { RankingCellTab } from './ranking-cell-tab';
import { RankingOptCellTab } from './ranking-opt-cell-tab';
import { getYouTubeEmbedUrl } from './table-cell-renderers';
import { VariableButton } from './variable-button';

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

interface CellContentModalProps {
  isOpen: boolean;
  onClose: () => void;
  cell: TableCell;
  onSave: (cell: TableCell) => void;
  currentQuestionId?: string | undefined;
  questionCode?: string | undefined;
  questionTitle?: string | undefined;
  rowCode?: string | undefined;
  rowLabel?: string | undefined;
  columnCode?: string | undefined;
  columnLabel?: string | undefined;
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
}

export function CellContentModal({
  isOpen,
  onClose,
  cell,
  onSave,
  currentQuestionId = '',
  questionCode,
  rowCode,
  rowLabel,
  columnCode,
  columnLabel,
  choiceGroups: choiceGroupsProp,
  onChoiceGroupsChange,
  getLatestRows,
}: CellContentModalProps) {
  const questions = useSurveyBuilderStore(useShallow((s) => s.currentSurvey.questions));
  const variableCatalog = useSurveyUIStore((s) => s.variableCatalog);
  const ensureSurvey = useEnsureSurveyInDb();
  const [isSaving, setIsSaving] = useState(false);
  const inputTemplateRef = useRef<HTMLInputElement>(null);
  const textContentRef = useRef<HTMLTextAreaElement>(null);
  // 숫자 모드 진입 시 emptyDefault 기본 ON 을 "이 편집 세션에서 한 번만" 적용하기 위한 가드.
  // 사용자가 초기값 옵션을 끈 뒤 숫자 모드를 다시 토글해도 강제로 켜지지 않도록 한다.
  // (모달 오픈/cell.id 변경 시 리셋)
  const emptyDefaultAutoAppliedRef = useRef(false);

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
    inputPlaceholder,
    inputMaxLength,
    inputDefaultValueTemplate,
    inputType,
    emptyDefaultEnabled,
    emptyDefaultRaw,
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
    horizontalAlign,
    mobileDisplay,
    verticalAlign,
    textPosition,
    isMergeEnabled,
    rowspan,
    colspan,
    cellCode,
    isCustomCellCode,
    exportLabel,
    isCustomExportLabel,
    spssVarType,
    spssMeasure,
  } = form;
  // 순위 옵션(ranking_opt, Case 2)은 순위형 질문의 내장 테이블에서만 렌더러가 있다.
  // 테이블형 질문에서는 응답 select 가 나오지 않는 막다른 조합이 되므로 탭을 숨긴다.
  // 단, 이미 ranking_opt 인 셀(과거 데이터)은 편집/다른 타입 전환이 가능하도록 노출 유지.
  const parentQuestionType = questions.find((q) => q.id === currentQuestionId)?.type;
  const showRankingOptTab = parentQuestionType === 'ranking' || contentType === 'ranking_opt';
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
    setInputPlaceholder,
    setInputMaxLength,
    setInputDefaultValueTemplate,
    setInputType,
    setEmptyDefaultEnabled,
    setEmptyDefaultRaw,
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
    setHorizontalAlign,
    setMobileDisplay,
    setVerticalAlign,
    setTextPosition,
    setIsMergeEnabled,
    setRowspan,
    setColspan,
    setCellCode,
    setIsCustomCellCode,
    setExportLabel,
    setIsCustomExportLabel,
    setSpssVarType,
    setSpssMeasure,
  } = setters;

  // choice_opt 탭용 로컬 그룹 편집 상태.
  // 부모에서 choiceGroupsProp 를 전달받으면 그 값으로, 아니면 스토어 질문의 choiceGroups 를 사용한다.
  // 모달이 열릴 때(isOpen + cell.id 변경) 재동기화하기 위해 useState 초기값은 lazy initializer 로 설정하지 않고
  // useEffect 로 동기화한다. (isOpen 이 꺼지면 닫는 시점이므로 재설정이 무해하다.)
  const [editChoiceGroups, setEditChoiceGroups] = useState<ChoiceGroup[]>(
    () => choiceGroupsProp ?? [],
  );
  useEffect(() => {
    if (isOpen) {
      const storeQuestion = useSurveyBuilderStore
        .getState()
        .currentSurvey.questions.find((q) => q.id === currentQuestionId);
      setEditChoiceGroups(choiceGroupsProp ?? storeQuestion?.choiceGroups ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, cell?.id]);

  // 새 편집 세션(모달 오픈/cell.id 변경)마다 emptyDefault 자동 적용 가드를 리셋한다.
  useEffect(() => {
    emptyDefaultAutoAppliedRef.current = false;
  }, [isOpen, cell?.id]);

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
  useEffect(() => {
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
        toast.error('순위 옵션 소스 셀은 텍스트/라벨/이미지/비디오 중 하나 이상을 설정해야 합니다.');
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
    try {
      // 폼 상태를 저장될 TableCell 로 직렬화 (조건부 spread 로 optional 필드 처리).
      const updatedCell: TableCell = buildUpdatedCell(form, cell);

      // 로컬 스토어 업데이트 (셀 저장) — onChoiceGroupsChange 보다 먼저 수행해야
      // dynamic-table-editor 의 currentRowsRef 가 이미 새 셀을 포함한 상태에서 prune 이 동작한다.
      onSave(updatedCell);

      // choice_opt 또는 ranking_opt 탭에서 그룹 변경이 있었으면 정리 후 부모에게 통보.
      // prune 은 updatedCell(이 셀 반영 후)의 rowsData 기준으로 계산해야 하므로
      // onSave(셀 반영) 다음에 호출한다.
      // 실질적인 prune(빈 그룹 제거)은 dynamic-table-editor 의 onChoiceGroupsChange 핸들러에서 수행한다.
      if (GROUPABLE_CELL_TYPES.has(contentType)) {
        onChoiceGroupsChange?.(editChoiceGroups);
      }

      // 서버에 질문 저장/업데이트
      if (currentQuestionId && useSurveyBuilderStore.getState().currentSurvey.id) {
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
            if (pruned.length === 0 && (question.choiceGroups ?? []).length === 0) return undefined;
            return pruned;
          })();

          // 신규 판정은 dirty 추적(questionChanges.added) 기준 — 로컬 id도 randomUUID라
          // UUID 형식 검사로는 미영속 질문을 구분할 수 없다(0행 update로 저장 실패하던 버그).
          const isNewQuestion = !!useSurveyBuilderStore.getState().questionChanges.added[currentQuestionId];

          try {
            await ensureSurvey();

            if (!isNewQuestion) {
              // 이미 DB에 저장된 질문: 업데이트
              await client.surveyBuilder.questions.update({
                questionId: currentQuestionId,
                surveyId: useSurveyBuilderStore.getState().currentSurvey.id,
                data: {
                  tableRowsData: updatedRowsData,
                  ...(prunedChoiceGroups !== undefined ? { choiceGroups: prunedChoiceGroups } : {}),
                },
              });
              // store 도 동일 데이터로 동기화. 표시 조건/장기 계산식 picker 가
              // store 를 직접 구독하므로 누락 시 셀 라벨 변경이 stale 로 표시됨.
              useSurveyBuilderStore.setState((state) => ({
                currentSurvey: {
                  ...state.currentSurvey,
                  questions: state.currentSurvey.questions.map((q) =>
                    q.id === currentQuestionId
                      ? {
                          ...q,
                          tableRowsData: updatedRowsData,
                          ...(prunedChoiceGroups !== undefined ? { choiceGroups: prunedChoiceGroups } : {}),
                        }
                      : q,
                  ),
                },
              }));
            } else {
              // 미영속 질문: id를 그대로 전달해 서버에서 동일 id로 생성
              const createdQuestion = await client.surveyBuilder.questions.create({
                id: currentQuestionId,
                surveyId: useSurveyBuilderStore.getState().currentSurvey.id,
                ...(question.groupId !== undefined ? { groupId: question.groupId } : {}),
                type: question.type,
                title: question.title || '',
                ...(question.description !== undefined ? { description: question.description } : {}),
                required: question.required ?? false,
                order: question.order ?? 0,
                ...(question.options !== undefined ? { options: question.options } : {}),
                ...(question.selectLevels !== undefined ? { selectLevels: question.selectLevels } : {}),
                ...(question.tableTitle !== undefined ? { tableTitle: question.tableTitle } : {}),
                ...(question.tableColumns !== undefined ? { tableColumns: question.tableColumns } : {}),
                tableRowsData: updatedRowsData,
                ...(question.allowOtherOption !== undefined ? { allowOtherOption: question.allowOtherOption } : {}),
                ...(question.optionsColumns !== undefined ? { optionsColumns: question.optionsColumns } : {}),
                ...(question.noticeContent !== undefined ? { noticeContent: question.noticeContent } : {}),
                ...(question.requiresAcknowledgment !== undefined ? { requiresAcknowledgment: question.requiresAcknowledgment } : {}),
                ...(question.tableValidationRules !== undefined ? { tableValidationRules: question.tableValidationRules } : {}),
                ...(question.displayCondition !== undefined ? { displayCondition: question.displayCondition } : {}),
                ...(prunedChoiceGroups !== undefined ? { choiceGroups: prunedChoiceGroups } : {}),
              });

              if (createdQuestion?.id) {
                // DB에 생성 완료 → added에서 제거 (다음 모달 저장 시 UPDATE 경로 사용)
                const { [currentQuestionId]: _, ...remainingAdded } =
                  useSurveyBuilderStore.getState().questionChanges.added;
                useSurveyBuilderStore.setState((state) => ({
                  questionChanges: { ...state.questionChanges, added: remainingAdded },
                }));
              }
              // id를 넘겼으므로 반환 id가 다를 경우에만 스토어 id 갱신
              if (createdQuestion?.id && createdQuestion.id !== currentQuestionId) {
                const newId = createdQuestion.id;
                useSurveyBuilderStore.setState((state) => ({
                  currentSurvey: {
                    ...state.currentSurvey,
                    questions: state.currentSurvey.questions.map((q) =>
                      q.id === currentQuestionId ? { ...q, id: newId } : q,
                    ),
                  },
                }));
              }
            }
          } catch (error) {
            console.error('질문 저장/업데이트 실패:', error);
          }
        }
      }
    } catch (error) {
      console.error('셀 저장 실패:', error);
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
        onClose();
      }
    }
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
          <TabsList className={`grid w-full ${showRankingOptTab ? 'grid-cols-10' : 'grid-cols-9'}`}>
            <TabsTrigger value="text" className="flex items-center gap-2">
              <Type className="h-4 w-4" />
              텍스트
            </TabsTrigger>
            <TabsTrigger value="image" className="flex items-center gap-2">
              <Image className="h-4 w-4" />
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
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <div className="flex items-start gap-2">
                <PenLine className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
                <div>
                  <p className="text-sm font-medium text-blue-900">단답형 입력 필드</p>
                  <p className="mt-1 text-xs text-blue-700">
                    사용자가 짧은 텍스트를 입력할 수 있는 필드입니다. 이름, 이메일, 전화번호 등
                    간단한 정보 수집에 적합합니다.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-col gap-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="input-type-number"
                    checked={inputType === 'number'}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setInputType(checked ? 'number' : 'text');
                      if (checked && !emptyDefaultAutoAppliedRef.current) {
                        // 숫자 모드를 이 세션에서 처음 켤 때만 emptyDefault 기본 ON (기본값 0).
                        // 이후 사용자가 초기값 옵션을 끈 뒤 다시 토글해도 강제로 켜지지 않는다.
                        emptyDefaultAutoAppliedRef.current = true;
                        setEmptyDefaultEnabled(true);
                      }
                    }}
                    className="mt-0.5 h-4 w-4"
                  />
                  <label htmlFor="input-type-number" className="flex-1 cursor-pointer text-sm">
                    <span className="font-medium">숫자만 입력</span>
                    <p className="mt-0.5 text-xs text-gray-500">
                      체크 시 응답자는 숫자만 입력할 수 있고, 분기 조건에서 비교 연산자 (=, ≠, ≥, ≤,
                      &gt;, &lt;) 를 사용할 수 있습니다.
                    </p>
                  </label>
                </div>

                {inputType === 'number' && (
                  <div className="ml-7 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      id="empty-default-enabled"
                      checked={emptyDefaultEnabled}
                      onChange={(e) => setEmptyDefaultEnabled(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <label htmlFor="empty-default-enabled" className="cursor-pointer">
                      응답자 입력란 초기값
                    </label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={emptyDefaultRaw}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (isPartialNumericInput(v)) setEmptyDefaultRaw(v);
                      }}
                      disabled={!emptyDefaultEnabled}
                      className="h-8 w-24"
                      aria-label="초기값"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="input-placeholder" className="text-sm font-medium">
                안내 문구 (Placeholder)
              </Label>
              <Input
                id="input-placeholder"
                value={inputPlaceholder}
                onChange={(e) => setInputPlaceholder(e.target.value)}
                placeholder="예: 이름을 입력하세요"
                className="w-full"
              />
              <p className="text-xs text-gray-500">입력 필드에 표시될 안내 문구를 입력하세요</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="input-default-value-template" className="text-sm font-medium">
                응답값 prefill <span className="font-normal text-gray-500">(선택)</span>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="input-default-value-template"
                  ref={inputTemplateRef}
                  value={inputDefaultValueTemplate}
                  onChange={(e) => setInputDefaultValueTemplate(e.target.value)}
                  placeholder="예: {{전시회명}}"
                  className="flex-1"
                />
                {variableCatalog.length > 0 && (
                  <VariableButton
                    catalog={variableCatalog}
                    inputRef={inputTemplateRef}
                    onChange={(v) => setInputDefaultValueTemplate(v)}
                  />
                )}
              </div>
              <p className="text-xs text-gray-500">
                변수 토큰 사용 시 응답자에게 readonly로 표시됩니다
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="input-max-length" className="text-sm font-medium">
                최대 글자 수 <span className="font-normal text-gray-500">(선택사항)</span>
              </Label>
              <Input
                id="input-max-length"
                type="number"
                min={1}
                max={500}
                value={inputMaxLength}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '') {
                    setInputMaxLength('');
                  } else {
                    const num = parseInt(value);
                    if (!isNaN(num) && num >= 1 && num <= 500) {
                      setInputMaxLength(num);
                    }
                  }
                }}
                placeholder="제한 없음"
                className="w-full"
              />
              <p className="text-xs text-gray-500">
                {inputMaxLength === '' || inputMaxLength === 0
                  ? '글자 수 제한이 없습니다'
                  : `최대 ${inputMaxLength}자까지 입력 가능`}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">미리보기</Label>
              <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4">
                <CellContentLayout content={textContent} position={textPosition}>
                  <div className="space-y-2">
                    <Input
                      placeholder={inputPlaceholder || '답변을 입력하세요...'}
                      maxLength={typeof inputMaxLength === 'number' ? inputMaxLength : undefined}
                      disabled
                      className="bg-white"
                    />
                    {typeof inputMaxLength === 'number' && inputMaxLength > 0 && (
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>0 / {inputMaxLength}자</span>
                      </div>
                    )}
                  </div>
                </CellContentLayout>
              </div>
            </div>
          </TabsContent>

          {/* 체크박스 탭 */}
          <TabsContent value="checkbox" className="space-y-4">
            <OptionsLayoutSelector value={cellOptionsColumns} onChange={setCellOptionsColumns} />
            <CellChoiceEditor
              cellType="checkbox"
              textContent={textContent}
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
            />
          </TabsContent>

          {/* 라디오 버튼 탭 */}
          <TabsContent value="radio" className="space-y-4">
            <OptionsLayoutSelector value={cellOptionsColumns} onChange={setCellOptionsColumns} />
            <CellChoiceEditor
              cellType="radio"
              textContent={textContent}
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
            />
          </TabsContent>

          {/* Select 탭 */}
          <TabsContent value="select" className="space-y-4">
            <CellChoiceEditor
              cellType="select"
              textContent={textContent}
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
            />
          </TabsContent>

          {/* 순위형(ranking) 탭 — Case 3 */}
          <TabsContent value="ranking" className="space-y-4">
            <OptionsLayoutSelector value={cellOptionsColumns} onChange={setCellOptionsColumns} />
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
            />
          </TabsContent>
        </Tabs>

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
            <h3 className="mb-2 text-sm font-medium text-gray-900">모바일 카드 표시</h3>
            <p className="mb-3 text-xs text-gray-500">
              {showInteractiveMobileLabel
                ? '좁은 화면(모바일) 카드에서 이 셀의 엑셀라벨을 보여줄지 선택합니다. 입력 컨트롤은 항상 표시됩니다.'
                : '좁은 화면(모바일) 카드에서 이 셀을 어떻게 보여줄지 선택합니다. 의미는 지정하지 않으며 저작자가 결정합니다.'}
            </p>
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
                    <Button
                      type="button"
                      variant={mobileDisplay === 'header' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setMobileDisplay('header')}
                      className="flex-1"
                    >
                      헤더
                    </Button>
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
          </div>
        )}

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
                  }`}
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
