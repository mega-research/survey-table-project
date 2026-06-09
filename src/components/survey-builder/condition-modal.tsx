'use client';

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
import {
  DynamicRowGroupConfig,
  Question,
  QuestionConditionGroup,
  TableColumn,
  TableRow,
} from '@/types/survey';

import { QuestionConditionEditor } from './question-condition-editor';

// kind별 제목/설명 라벨 텍스트 매핑 (열/행/그룹 동작 보존)
const KIND_LABELS = {
  column: { title: '열 조건부 표시 설정', description: '다른 질문의 응답에 따라 이 열의 표시 여부를 설정합니다.' },
  row: { title: '행 조건부 표시 설정', description: '다른 질문의 응답에 따라 이 행의 표시 여부를 설정합니다.' },
  group: { title: '그룹 조건부 표시 설정', description: '다른 질문의 응답에 따라 이 그룹의 표시 여부를 설정합니다.' },
} as const;

// 인덱스 폴백 라벨 접두어 (열 N / 행 N)
const KIND_FALLBACK_PREFIX = {
  column: '열',
  row: '행',
} as const;

type ColumnConditionModalProps = {
  kind: 'column';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingColumnIndex: number | null;
  columns: TableColumn[];
  currentQuestion: Question;
  onUpdateCondition: (columnIndex: number, condition: QuestionConditionGroup | undefined) => void;
};

type RowConditionModalProps = {
  kind: 'row';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingRowIndex: number | null;
  rows: TableRow[];
  currentQuestion: Question;
  onUpdateCondition: (rowIndex: number, condition: QuestionConditionGroup | undefined) => void;
};

type GroupConditionModalProps = {
  kind: 'group';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: DynamicRowGroupConfig | null;
  currentQuestion: Question;
  onUpdateCondition: (groupId: string, condition: QuestionConditionGroup | undefined) => void;
};

export type ConditionModalProps =
  | ColumnConditionModalProps
  | RowConditionModalProps
  | GroupConditionModalProps;

export function ConditionModal(props: ConditionModalProps) {
  const { kind, open, onOpenChange, currentQuestion } = props;
  const allQuestions = useSurveyBuilderStore(useShallow((s) => s.currentSurvey.questions));

  const { title, description } = KIND_LABELS[kind];

  // 편집 대상 항목 + 라벨 + 초기 조건 + 업데이트 핸들러를 kind별로 정규화한다.
  let label: string | null = null;
  let initialCondition: QuestionConditionGroup | undefined;
  let hasTarget = false;
  let handleUpdate: ((conditionGroup: QuestionConditionGroup | undefined) => void) | null = null;

  if (props.kind === 'group') {
    const { group } = props;
    if (group) {
      hasTarget = true;
      label = group.label || group.groupId;
      initialCondition = group.displayCondition;
      handleUpdate = (conditionGroup) => {
        props.onUpdateCondition(group.groupId, conditionGroup);
      };
    }
  } else if (props.kind === 'column') {
    const { editingColumnIndex, columns } = props;
    const target = editingColumnIndex !== null ? columns[editingColumnIndex] : undefined;
    if (editingColumnIndex !== null && target) {
      hasTarget = true;
      label = target.label || `${KIND_FALLBACK_PREFIX.column} ${editingColumnIndex + 1}`;
      initialCondition = target.displayCondition;
      handleUpdate = (conditionGroup) => {
        props.onUpdateCondition(editingColumnIndex, conditionGroup);
      };
    }
  } else {
    const { editingRowIndex, rows } = props;
    const target = editingRowIndex !== null ? rows[editingRowIndex] : undefined;
    if (editingRowIndex !== null && target) {
      hasTarget = true;
      label = target.label || `${KIND_FALLBACK_PREFIX.row} ${editingRowIndex + 1}`;
      initialCondition = target.displayCondition;
      handleUpdate = (conditionGroup) => {
        props.onUpdateCondition(editingRowIndex, conditionGroup);
      };
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {title}
            {hasTarget && label !== null && (
              <span className="ml-2 text-sm font-normal text-gray-500">- {label}</span>
            )}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {hasTarget && handleUpdate && (
          <QuestionConditionEditor
            question={currentQuestion}
            {...(initialCondition !== undefined ? { initialCondition } : {})}
            onUpdate={handleUpdate}
            allQuestions={allQuestions}
            allowAllQuestions
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
