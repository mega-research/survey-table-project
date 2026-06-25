'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { Question, QuestionConditionGroup } from '@/types/survey';

import {
  QuestionConditionEditor,
  QuestionConditionEditorRef,
} from '../question-condition-editor';

import { BulkDynamicGroupSection } from './bulk-dynamic-group-section';
import { BulkForm } from './bulk-form';
import { BulkPreview } from './bulk-preview';
import type {
  BulkColumnDef,
  BulkGeneratorModalColumnProps,
  BulkGeneratorModalProps,
  BulkGeneratorModalRowProps,
  BulkRowDef,
} from './types';
import { MODE_CONFIG } from './types';
import { buildDefs } from './utils';

// ── 조건부 표시 섹션 (QuestionConditionEditor 래퍼) ──

function BulkConditionSection({
  allQuestions,
  currentQuestionId,
  conditionEditorRef,
  onConditionChange,
}: {
  allQuestions: Question[];
  currentQuestionId: string;
  conditionEditorRef: React.RefObject<QuestionConditionEditorRef | null>;
  onConditionChange: (condition: QuestionConditionGroup | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const dummyQuestion = useMemo<Question>(
    () => ({
      id: currentQuestionId,
      type: 'table',
      title: '',
      order: 0,
      required: false,
    }),
    [currentQuestionId],
  );

  const filteredQuestions = useMemo(
    () => allQuestions.filter((q) => q.id !== currentQuestionId),
    [allQuestions, currentQuestionId],
  );

  if (filteredQuestions.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900"
      >
        <Eye className="h-3.5 w-3.5 text-blue-500" />
        조건부 표시 (선택사항)
        {expanded ? (
          <ChevronUp className="ml-auto h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="ml-auto h-3.5 w-3.5" />
        )}
      </button>
      {expanded && (
        <div className="rounded-md border border-blue-100 bg-blue-50/30 p-3">
          <QuestionConditionEditor
            ref={conditionEditorRef}
            question={dummyQuestion}
            allQuestions={allQuestions}
            allowAllQuestions
            onUpdate={onConditionChange}
          />
        </div>
      )}
    </div>
  );
}

// ── 메인 모달 ──

export function BulkGeneratorModal(props: BulkGeneratorModalProps) {
  const { open, onOpenChange, currentQuestionId, existingCodes, mode } = props;
  const config = MODE_CONFIG[mode];
  const allQuestions = useSurveyBuilderStore(useShallow((s) => s.currentSurvey.questions));

  // ── 공통 상태 ──
  const [baseLabel, setBaseLabel] = useState('');
  const [baseCode, setBaseCode] = useState('');
  const [startNumber, setStartNumber] = useState(1);
  const [count, setCount] = useState<number>(config.defaultCount);
  const [condition, setCondition] = useState<QuestionConditionGroup | undefined>(undefined);
  const conditionEditorRef = useRef<QuestionConditionEditorRef | null>(null);

  // ── 모드별 상태 ──
  const [dynamicGroupId, setDynamicGroupId] = useState<string | undefined>(undefined);

  // ── 모달 열릴 때 초기화 ──
  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setBaseLabel('');
        setBaseCode('');
        setStartNumber(1);
        setCount(config.defaultCount);
        setCondition(undefined);
        setDynamicGroupId(undefined);
      });
    }
  }, [open, config.defaultCount]);

  // ── 미리보기 ──
  const previewItems = useMemo(
    () => buildDefs(baseLabel, baseCode, startNumber, count, condition),
    [baseLabel, baseCode, startNumber, count, condition],
  );

  // ── 유효성 검사 ──
  const isValid = baseLabel.trim().length > 0 && baseCode.trim().length > 0 && count > 0;

  // ── 생성 핸들러 ──
  const handleGenerate = useCallback(() => {
    if (!isValid) return;

    const finalCondition = conditionEditorRef.current?.getCurrentConditionGroup() ?? condition;
    const items = buildDefs(baseLabel, baseCode, startNumber, count, finalCondition);

    if (mode === 'row') {
      const rows: BulkRowDef[] = items.map((item) => ({
        label: item.label,
        rowCode: item.code,
        ...(item.displayCondition !== undefined ? { displayCondition: item.displayCondition } : {}),
        ...(dynamicGroupId !== undefined ? { dynamicGroupId } : {}),
      }));
      (props as BulkGeneratorModalRowProps).onGenerate(rows);
    } else {
      const cols: BulkColumnDef[] = items.map((item) => ({
        label: item.label,
        columnCode: item.code,
        ...(item.displayCondition !== undefined ? { displayCondition: item.displayCondition } : {}),
        cellType: 'text' as const,
      }));
      (props as BulkGeneratorModalColumnProps).onGenerate(cols);
    }

    onOpenChange(false);
  }, [isValid, baseLabel, baseCode, startNumber, count, condition, mode, dynamicGroupId, props, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <BulkForm
            baseLabel={baseLabel}
            baseCode={baseCode}
            startNumber={startNumber}
            count={count}
            config={config}
            onBaseLabelChange={setBaseLabel}
            onBaseCodeChange={setBaseCode}
            onStartNumberChange={setStartNumber}
            onCountChange={setCount}
          />

          {mode === 'row' && (
            <BulkDynamicGroupSection
              dynamicRowGroups={(props as BulkGeneratorModalRowProps).dynamicRowGroups}
              selectedGroupId={dynamicGroupId}
              onSelect={setDynamicGroupId}
            />
          )}

          <BulkConditionSection
            allQuestions={allQuestions}
            currentQuestionId={currentQuestionId}
            conditionEditorRef={conditionEditorRef}
            onConditionChange={setCondition}
          />

          <BulkPreview items={previewItems} existingCodes={existingCodes} />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleGenerate} disabled={!isValid}>
            {count || 0}개 {config.entityLabel} 생성
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
