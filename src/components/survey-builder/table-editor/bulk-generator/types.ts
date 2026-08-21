import type {
  DynamicRowGroupConfig,
  QuestionConditionGroup,
  TableCell,
} from '@/types/survey';

// ── 출력 타입 ──

export interface BulkRowDef {
  label: string;
  rowCode: string;
  displayCondition?: QuestionConditionGroup;
  dynamicGroupId?: string;
}

export interface BulkColumnDef {
  label: string;
  columnCode: string;
  width?: number;
  displayCondition?: QuestionConditionGroup;
  cellType?: TableCell['type'];
  cellTemplate?: Partial<TableCell>;
}

// ── 내부 공통 타입 ──

export interface BulkItemDef {
  label: string;
  code: string;
  displayCondition?: QuestionConditionGroup;
}

// ── Props (discriminated union) ──

interface BulkGeneratorModalBaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentQuestionId: string;
  existingCodes: string[];
}

export interface BulkGeneratorModalRowProps extends BulkGeneratorModalBaseProps {
  mode: 'row';
  dynamicRowGroups: DynamicRowGroupConfig[];
  onGenerate: (rows: BulkRowDef[]) => void;
}

export interface BulkGeneratorModalColumnProps extends BulkGeneratorModalBaseProps {
  mode: 'column';
  onGenerate: (columns: BulkColumnDef[]) => void;
}

export type BulkGeneratorModalProps =
  | BulkGeneratorModalRowProps
  | BulkGeneratorModalColumnProps;

// ── 모드별 설정 ──

export const MODE_CONFIG = {
  row: {
    title: '행 일괄 생성',
    description:
      '기본 라벨과 아이디를 입력하면 번호가 자동으로 붙어 여러 행이 한번에 생성됩니다.',
    entityLabel: '행',
    defaultCount: 10,
    labelPlaceholder: '예: 제재목',
    codePlaceholder: '예: 1u',
    codeFieldLabel: '기본 아이디 (코드)',
  },
  column: {
    title: '열 일괄 생성',
    description:
      '기본 라벨과 코드를 입력하면 번호가 자동으로 붙어 여러 열이 한번에 생성됩니다.',
    entityLabel: '열',
    defaultCount: 5,
    labelPlaceholder: '예: 지역',
    codePlaceholder: '예: a',
    codeFieldLabel: '기본 코드',
  },
} as const;
