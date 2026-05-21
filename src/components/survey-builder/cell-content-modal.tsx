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

import {
  createQuestion as createQuestionAction,
  updateQuestion as updateQuestionAction,
} from '@/actions/question-actions';
import { Button } from '@/components/ui/button';
import { useEnsureSurveyInDb } from '@/hooks/use-ensure-survey-in-db';
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
import { isValidUUID } from '@/lib/utils';
import {
  INTERACTIVE_CELL_TYPES,
  generateCellCode,
  generateExportLabel,
  inferSpssMeasure,
  inferSpssVarType,
} from '@/utils/table-cell-code-generator';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { generateId } from '@/lib/utils';
import { getMaxSpssCode } from '@/utils/option-code-generator';
import { hasExistingOtherRankingCell } from '@/utils/ranking-source';
import {
  CheckboxOption,
  QuestionOption,
  RadioOption,
  RankingConfig,
  TableCell,
} from '@/types/survey';
import { useShallow } from 'zustand/react/shallow';

import { CellChoiceEditor } from './cell-choice-editor';
import { CellImageEditor } from './cell-image-editor';
import { CellContentLayout } from './cells/cell-content-layout';
import { OptionsLayoutSelector } from './options-layout-selector';
import { RankingCellTab } from './ranking-cell-tab';
import { RankingOptCellTab } from './ranking-opt-cell-tab';
import { VariableButton } from './variable-button';

// textPosition 컨트롤을 표시할 셀 타입 — 텍스트 라벨과 입력/옵션 영역이 분리된 셀들만
const TEXT_POSITION_CELL_TYPES = new Set(['input', 'checkbox', 'radio', 'select', 'ranking']);

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
  currentQuestionId?: string;
  questionCode?: string;
  questionTitle?: string;
  rowCode?: string;
  rowLabel?: string;
  columnCode?: string;
  columnLabel?: string;
}

export function CellContentModal({
  isOpen,
  onClose,
  cell,
  onSave,
  currentQuestionId = '',
  questionCode,
  questionTitle,
  rowCode,
  rowLabel,
  columnCode,
  columnLabel,
}: CellContentModalProps) {
  const questions = useSurveyBuilderStore(useShallow((s) => s.currentSurvey.questions));
  const variableCatalog = useSurveyBuilderStore((s) => s.variableCatalog);
  const ensureSurvey = useEnsureSurveyInDb();
  const [isSaving, setIsSaving] = useState(false);
  const inputTemplateRef = useRef<HTMLInputElement>(null);
  const textContentRef = useRef<HTMLTextAreaElement>(null);
  // ranking(Case 3) 은 8번째 탭, ranking_opt(Case 2 옵션 소스) 는 9번째 탭으로 편집.
  type ContentType =
    | 'text'
    | 'image'
    | 'video'
    | 'checkbox'
    | 'radio'
    | 'select'
    | 'input'
    | 'ranking'
    | 'ranking_opt';
  const narrowCellType = (t: TableCell['type'] | undefined): ContentType =>
    !t ? 'text' : t;
  const [contentType, setContentType] = useState<ContentType>(narrowCellType(cell.type));
  const [textContent, setTextContent] = useState(cell.content || '');
  const [imageUrl, setImageUrl] = useState(cell.imageUrl || '');
  const [videoUrl, setVideoUrl] = useState(cell.videoUrl || '');

  const [checkboxOptions, setCheckboxOptions] = useState<CheckboxOption[]>(
    cell.checkboxOptions || [],
  );
  const [radioOptions, setRadioOptions] = useState<RadioOption[]>(cell.radioOptions || []);
  const [radioGroupName, setRadioGroupName] = useState(cell.radioGroupName || '');
  const [selectOptions, setSelectOptions] = useState<QuestionOption[]>(cell.selectOptions || []);
  const [allowOtherOption, setAllowOtherOption] = useState(cell.allowOtherOption || false);
  const [cellOptionsColumns, setCellOptionsColumns] = useState<number | undefined>(
    cell.optionsColumns,
  );
  const [inputPlaceholder, setInputPlaceholder] = useState(cell.placeholder || '');
  const [inputMaxLength, setInputMaxLength] = useState<number | ''>(cell.inputMaxLength || '');
  const [inputDefaultValueTemplate, setInputDefaultValueTemplate] = useState(
    cell.defaultValueTemplate ?? '',
  );
  const [minSelections, setMinSelections] = useState<number | undefined>(cell.minSelections);
  const [maxSelections, setMaxSelections] = useState<number | undefined>(cell.maxSelections);

  // 순위형 셀(Case 3) 전용 state
  const [rankingOptions, setRankingOptions] = useState<QuestionOption[]>(cell.rankingOptions || []);
  const [rankingConfig, setRankingConfig] = useState<RankingConfig | undefined>(cell.rankingConfig);
  const [rankSuffixPattern, setRankSuffixPattern] = useState<string>(cell.rankSuffixPattern || '');
  const [rankVarNames, setRankVarNames] = useState<string[]>(cell.rankVarNames || []);

  // 순위형 옵션 소스 셀(Case 2, ranking_opt) 전용 state
  const [rankingLabel, setRankingLabel] = useState<string>(cell.rankingLabel || '');
  const [cellSpssNumericCode, setCellSpssNumericCode] = useState<number | ''>(
    cell.spssNumericCode ?? '',
  );
  const [isOtherRankingCell, setIsOtherRankingCell] = useState<boolean>(
    cell.isOtherRankingCell === true,
  );

  // 정렬 관련 state
  const [horizontalAlign, setHorizontalAlign] = useState<'left' | 'center' | 'right'>(
    cell.horizontalAlign || 'left',
  );
  const [verticalAlign, setVerticalAlign] = useState<'top' | 'middle' | 'bottom'>(
    cell.verticalAlign || 'top',
  );

  const [textPosition, setTextPosition] = useState<NonNullable<TableCell['textPosition']>>(
    cell.textPosition || 'top',
  );

  // 셀 병합 관련 state
  const [isMergeEnabled, setIsMergeEnabled] = useState(
    (cell.rowspan && cell.rowspan > 1) || (cell.colspan && cell.colspan > 1) || false,
  );
  const [rowspan, setRowspan] = useState<number | ''>(cell.rowspan || 1);
  const [colspan, setColspan] = useState<number | ''>(cell.colspan || 1);

  // 셀 코드 및 엑셀 라벨
  const [cellCode, setCellCode] = useState(cell.cellCode || '');
  const [isCustomCellCode, setIsCustomCellCode] = useState(cell.isCustomCellCode ?? !!cell.cellCode);
  const [exportLabel, setExportLabel] = useState(cell.exportLabel || '');
  const [isCustomExportLabel, setIsCustomExportLabel] = useState(cell.isCustomExportLabel ?? !!cell.exportLabel);

  // SPSS 변수 타입 / 측정 수준 (셀 단위)
  const [spssVarType, setSpssVarType] = useState<TableCell['spssVarType']>(cell.spssVarType);
  const [spssMeasure, setSpssMeasure] = useState<TableCell['spssMeasure']>(cell.spssMeasure);

  // 자동생성 셀코드/라벨 계산
  const autoCellCode = generateCellCode(questionCode, rowCode, columnCode);
  const autoExportLabel = generateExportLabel(questionTitle, columnLabel, rowLabel);

  // 셀이 변경될 때 상태 동기화 (모달이 열릴 때마다 최신 셀 데이터 반영)
  useEffect(() => {
    if (isOpen && cell) {
      setContentType(narrowCellType(cell.type));
      setTextContent(cell.content || '');
      setImageUrl(cell.imageUrl || '');
      setVideoUrl(cell.videoUrl || '');
      setCheckboxOptions(cell.checkboxOptions || []);
      setRadioOptions(cell.radioOptions || []);
      setRadioGroupName(cell.radioGroupName || '');
      setSelectOptions(cell.selectOptions || []);
      setAllowOtherOption(cell.allowOtherOption || false);
      setCellOptionsColumns(cell.optionsColumns);
      setInputPlaceholder(cell.placeholder || '');
      setInputMaxLength(cell.inputMaxLength || '');
      setInputDefaultValueTemplate(cell.defaultValueTemplate ?? '');
      setMinSelections(cell.minSelections);
      setMaxSelections(cell.maxSelections);
      setRankingOptions(cell.rankingOptions || []);
      setRankingConfig(cell.rankingConfig);
      setRankSuffixPattern(cell.rankSuffixPattern || '');
      setRankVarNames(cell.rankVarNames || []);
      setRankingLabel(cell.rankingLabel || '');
      setCellSpssNumericCode(cell.spssNumericCode ?? '');
      setIsOtherRankingCell(cell.isOtherRankingCell === true);
      setIsMergeEnabled(
        (cell.rowspan && cell.rowspan > 1) || (cell.colspan && cell.colspan > 1) || false,
      );
      setRowspan(cell.rowspan || 1);
      setColspan(cell.colspan || 1);
      setHorizontalAlign(cell.horizontalAlign || 'left');
      setVerticalAlign(cell.verticalAlign || 'top');
      setTextPosition(cell.textPosition || 'top');
      setCellCode(cell.cellCode || '');
      setIsCustomCellCode(cell.isCustomCellCode ?? !!cell.cellCode);
      setExportLabel(cell.exportLabel || '');
      setIsCustomExportLabel(cell.isCustomExportLabel ?? !!cell.exportLabel);
      setSpssVarType(cell.spssVarType);
      setSpssMeasure(cell.spssMeasure);
    }
  }, [isOpen, cell]);

  // YouTube URL을 임베드 URL로 변환
  const getYouTubeEmbedUrl = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) {
      return `https://www.youtube.com/embed/${match[2]}`;
    }
    return url;
  };

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const handleSave = async () => {
    // 빌더 validator: ranking 셀은 옵션이 최소 1개 이상이어야 함.
    if (contentType === 'ranking' && rankingOptions.length === 0) {
      alert('순위형 셀은 최소 1개 이상의 옵션이 필요합니다.');
      return;
    }
    // ranking_opt 셀은 content/rankingLabel/imageUrl/videoUrl 중 하나 이상 필요.
    // 단, "기타로 사용" 셀은 드롭다운 라벨이 자동 폴백(기타 (직접 입력))되므로 빈 상태도 허용.
    if (contentType === 'ranking_opt' && !isOtherRankingCell) {
      const hasContent = !!(
        textContent.trim()
        || rankingLabel.trim()
        || imageUrl.trim()
        || videoUrl.trim()
      );
      if (!hasContent) {
        alert('순위 옵션 소스 셀은 텍스트/라벨/이미지/비디오 중 하나 이상을 설정해야 합니다.');
        return;
      }
    }
    if (contentType === 'ranking_opt' && isOtherRankingCell) {
      // 같은 질문 내 기타 ranking_opt 셀이 이미 존재하면 차단 (자기 자신은 제외).
      const hostQuestion = questions.find((q) => q.id === currentQuestionId);
      if (hasExistingOtherRankingCell(hostQuestion?.tableRowsData, cell.id)) {
        alert(
          '이 질문에는 이미 "기타"로 지정된 순위 옵션 셀이 있습니다. 질문당 최대 1개만 지정할 수 있습니다.',
        );
        return;
      }
    }

    setIsSaving(true);
    try {
      const updatedCell: TableCell = {
        ...cell,
        type: contentType,
        // 모든 타입에서 텍스트 내용 저장 (라디오/체크박스/셀렉트에서도 설명 텍스트 표시 가능)
        content: textContent || '',
        imageUrl: contentType === 'image' ? imageUrl : undefined,
        videoUrl: contentType === 'video' ? videoUrl : undefined,
        checkboxOptions: contentType === 'checkbox' ? checkboxOptions : undefined,
        radioOptions: contentType === 'radio' ? radioOptions : undefined,
        radioGroupName: contentType === 'radio' ? radioGroupName : undefined,
        selectOptions: contentType === 'select' ? selectOptions : undefined,
        allowOtherOption: ['checkbox', 'radio', 'select', 'ranking'].includes(contentType)
          ? allowOtherOption
          : undefined,
        optionsColumns: ['checkbox', 'radio', 'ranking'].includes(contentType)
          ? cellOptionsColumns
          : undefined,
        placeholder: contentType === 'input' ? inputPlaceholder : undefined,
        inputMaxLength:
          contentType === 'input' && typeof inputMaxLength === 'number'
            ? inputMaxLength
            : undefined,
        defaultValueTemplate:
          contentType === 'input' && inputDefaultValueTemplate.trim().length > 0
            ? inputDefaultValueTemplate.trim()
            : undefined,
        // 체크박스 선택 개수 제한 (체크박스 타입 전용)
        minSelections: contentType === 'checkbox' ? minSelections : undefined,
        maxSelections: contentType === 'checkbox' ? maxSelections : undefined,
        // 순위형 셀 (Case 3)
        rankingOptions: contentType === 'ranking' ? rankingOptions : undefined,
        rankingConfig: contentType === 'ranking' ? rankingConfig : undefined,
        rankSuffixPattern:
          contentType === 'ranking' && rankSuffixPattern.trim().length > 0
            ? rankSuffixPattern.trim()
            : undefined,
        // rankVarNames: positions 초과분은 잘라내고, 모두 빈 문자열이면 배열 자체 제거.
        rankVarNames: (() => {
          if (contentType !== 'ranking') return undefined;
          const positions = Math.max(1, rankingConfig?.positions ?? 3);
          const trimmed = rankVarNames.slice(0, positions).map((n) => n.trim());
          return trimmed.some((n) => n.length > 0) ? trimmed : undefined;
        })(),
        // 순위형 옵션 소스 셀 (Case 2)
        rankingLabel:
          contentType === 'ranking_opt' && rankingLabel.trim().length > 0
            ? rankingLabel.trim()
            : undefined,
        // ranking_opt 전용 spssNumericCode (Case 2 SPSS 재-export 안정성)
        // isOther 모드면 numeric 변수가 system-missing 이라 spssNumericCode 는 의미 없음 → 강제 undefined.
        spssNumericCode:
          contentType === 'ranking_opt'
            && !isOtherRankingCell
            && typeof cellSpssNumericCode === 'number'
            ? cellSpssNumericCode
            : undefined,
        // ranking_opt 셀을 질문-레벨 "기타" 엔트리로 사용할지 (타입 전환 시 undefined 로 클리어).
        isOtherRankingCell:
          contentType === 'ranking_opt' && isOtherRankingCell ? true : undefined,
        // 셀 병합 속성 추가
        rowspan: isMergeEnabled && typeof rowspan === 'number' && rowspan > 1 ? rowspan : undefined,
        colspan: isMergeEnabled && typeof colspan === 'number' && colspan > 1 ? colspan : undefined,
        // 정렬 속성 추가
        horizontalAlign: horizontalAlign !== 'left' ? horizontalAlign : undefined,
        verticalAlign: verticalAlign !== 'top' ? verticalAlign : undefined,
        // 셀 텍스트 위치 — 적용 대상 타입이 아니거나 기본값('top') 이면 undefined 로 저장 (불필요한 데이터 회피)
        textPosition:
          TEXT_POSITION_CELL_TYPES.has(contentType) && textPosition !== 'top'
            ? textPosition
            : undefined,
        // 셀 코드 및 엑셀 라벨 추가
        cellCode: cellCode || undefined,
        isCustomCellCode: isCustomCellCode === false ? false : isCustomCellCode || undefined,
        exportLabel: exportLabel || undefined,
        isCustomExportLabel: isCustomExportLabel === false ? false : isCustomExportLabel || undefined,
        // SPSS 변수 타입 / 측정 수준 (입력 셀만)
        spssVarType: INTERACTIVE_CELL_TYPES.has(contentType) ? spssVarType : undefined,
        spssMeasure: INTERACTIVE_CELL_TYPES.has(contentType) ? spssMeasure : undefined,
      };

      // 로컬 스토어 업데이트 (셀 저장)
      onSave(updatedCell);

      // 서버에 질문 저장/업데이트
      if (currentQuestionId && useSurveyBuilderStore.getState().currentSurvey.id) {
        const question = questions.find((q) => q.id === currentQuestionId);
        if (question && question.tableRowsData) {
          // tableRowsData에서 해당 셀을 찾아 업데이트
          const updatedRowsData = question.tableRowsData.map((row) => ({
            ...row,
            cells: row.cells.map((c) => (c.id === cell.id ? updatedCell : c)),
          }));

          try {
            await ensureSurvey();

            if (isValidUUID(currentQuestionId)) {
              // 이미 DB에 저장된 질문: 업데이트
              await updateQuestionAction(currentQuestionId, {
                tableRowsData: updatedRowsData,
              });
            } else {
              // 임시 질문: 생성하고 반환된 UUID로 로컬 스토어의 질문 ID 업데이트
              const createdQuestion = await createQuestionAction({
                surveyId: useSurveyBuilderStore.getState().currentSurvey.id,
                groupId: question.groupId,
                type: question.type,
                title: question.title || '',
                description: question.description,
                required: question.required ?? false,
                order: question.order ?? 0,
                options: question.options,
                selectLevels: question.selectLevels,
                tableTitle: question.tableTitle,
                tableColumns: question.tableColumns,
                tableRowsData: updatedRowsData,
                imageUrl: question.imageUrl,
                videoUrl: question.videoUrl,
                allowOtherOption: question.allowOtherOption,
                optionsColumns: question.optionsColumns,
                noticeContent: question.noticeContent,
                requiresAcknowledgment: question.requiresAcknowledgment,
                tableValidationRules: question.tableValidationRules,
                displayCondition: question.displayCondition,
              });

              // 반환된 UUID로 로컬 스토어의 질문 ID 업데이트 + Case 2 참조 동기화
              if (createdQuestion?.id) {
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
    // 원래 값으로 되돌리기
    setContentType(narrowCellType(cell.type));
    setTextContent(cell.content || '');
    setImageUrl(cell.imageUrl || '');
    setVideoUrl(cell.videoUrl || '');
    setCheckboxOptions(cell.checkboxOptions || []);
    setRadioOptions(cell.radioOptions || []);
    setRadioGroupName(cell.radioGroupName || '');
    setSelectOptions(cell.selectOptions || []);
    setAllowOtherOption(cell.allowOtherOption || false);
    setInputPlaceholder(cell.placeholder || '');
    setInputMaxLength(cell.inputMaxLength || '');
    setInputDefaultValueTemplate(cell.defaultValueTemplate ?? '');
    setMinSelections(cell.minSelections);
    setMaxSelections(cell.maxSelections);
    setRankingOptions(cell.rankingOptions || []);
    setRankingConfig(cell.rankingConfig);
    setRankingLabel(cell.rankingLabel || '');
    setCellSpssNumericCode(cell.spssNumericCode ?? '');
    setIsOtherRankingCell(cell.isOtherRankingCell === true);
    setIsMergeEnabled(
      (cell.rowspan && cell.rowspan > 1) || (cell.colspan && cell.colspan > 1) || false,
    );
    setRowspan(cell.rowspan || 1);
    setColspan(cell.colspan || 1);
    setHorizontalAlign(cell.horizontalAlign || 'left');
    setVerticalAlign(cell.verticalAlign || 'top');
    setTextPosition(cell.textPosition || 'top');
    setCellCode(cell.cellCode || '');
    setIsCustomCellCode(cell.isCustomCellCode ?? !!cell.cellCode);
    setExportLabel(cell.exportLabel || '');
    setIsCustomExportLabel(cell.isCustomExportLabel ?? !!cell.exportLabel);
    setSpssVarType(cell.spssVarType);
    setSpssMeasure(cell.spssMeasure);
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
                {!cellCode && (INTERACTIVE_CELL_TYPES.has(contentType) || contentType === 'ranking') && (
                  <p className="text-[10px] text-amber-500">셀코드가 비어있으면 내보내기에서 제외됩니다.</p>
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
                  <Label htmlFor="cell-spss-var-type" className="text-xs">변수 타입</Label>
                  <select
                    id="cell-spss-var-type"
                    value={spssVarType || ''}
                    onChange={(e) => setSpssVarType((e.target.value || undefined) as TableCell['spssVarType'])}
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  >
                    <option value="" disabled>선택</option>
                    <option value="Numeric">Numeric</option>
                    <option value="String">String</option>
                    <option value="Date">Date</option>
                    <option value="DateTime">DateTime</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cell-spss-measure" className="text-xs">측정 수준</Label>
                  <select
                    id="cell-spss-measure"
                    value={spssMeasure || ''}
                    onChange={(e) => setSpssMeasure((e.target.value || undefined) as TableCell['spssMeasure'])}
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  >
                    <option value="" disabled>선택</option>
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
          <TabsList className="grid w-full grid-cols-9">
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
            <TabsTrigger value="ranking_opt" className="flex items-center gap-2">
              <Tag className="h-4 w-4" />
              순위 옵션
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
            <CellImageEditor
              imageUrl={imageUrl}
              onImageUrlChange={setImageUrl}
            />
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
                응답값 prefill{' '}
                <span className="font-normal text-gray-500">(선택)</span>
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
            <OptionsLayoutSelector
              value={cellOptionsColumns}
              onChange={setCellOptionsColumns}
            />
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
            <OptionsLayoutSelector
              value={cellOptionsColumns}
              onChange={setCellOptionsColumns}
            />
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
            <OptionsLayoutSelector
              value={cellOptionsColumns}
              onChange={setCellOptionsColumns}
            />
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
            />
          </TabsContent>
        </Tabs>

        {/* 셀 병합 설정 */}
        <div className="mt-6 border-t border-gray-200 pt-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-900">📐 셀 병합</h3>
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
                    ⚠️ <strong>주의:</strong> 셀을 병합하면 오른쪽/아래에 있는 셀들이 자동으로
                    숨겨집니다. 병합된 영역만큼의 공간이 필요하므로 테이블 구조를 미리 확인하세요.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* 셀 컨텐츠 정렬 설정 */}
        <div className="mt-6 border-t border-gray-200 pt-6">
          <h3 className="mb-4 text-sm font-medium text-gray-900">📐 컨텐츠 정렬</h3>

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
