/**
 * 숨기는 장치 시나리오 — `src/features/survey-response/lib` 의 차단 검증 표
 * (`hidden-cell-validation-matrix.test.ts`)와 화면 대조(`hidden-cell-screen-parity.test.tsx`)가 같은 표를 쓴다.
 *
 * 장치는 타입으로 묶여 있다 — `STRUCTURAL_CELL_HIDERS` · `VALUE_DERIVED_CELL_HIDERS` 의 키 전부에 시나리오가
 * 있어야 컴파일된다. 숨는 자리는 대상 행 `rt` 의 두 번째 열이고 그 칸의 id 는 `TARGET` 이다.
 */
import { expandRepeatRows } from '@/lib/question/row-repeat';
import type {
  Question,
  QuestionConditionGroup,
  SumConstraint,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';

import type {
  StructuralCellHider,
  ValueDerivedCellHiderKey,
} from '@/features/survey-response/lib/numeric-validation';

export const whenQ0Is1: QuestionConditionGroup = {
  logicType: 'AND',
  conditions: [
    { id: 'q0-is-1', conditionType: 'value-match', sourceQuestionId: 'q0', requiredValues: ['1'] },
  ],
} as QuestionConditionGroup;
export const q0 = {
  id: 'q0',
  type: 'radio',
  title: '조건 문항',
  required: false,
  order: 0,
  options: [{ id: 'o1', label: '예', value: '1' }],
} as Question;

export const TARGET = 'T';
export const HELPER = 'H';

export interface ValidatorCase {
  name: string;
  /** 숨는 자리(대상 행 rt 의 두 번째 열)에 놓을 칸 — id 는 TARGET */
  target: TableCell;
  /** 그 칸에 든 값. 있으면 「값이 남은 숨은 칸」이 필요한 검증이다 */
  targetValue?: string;
  /** 늘 보이는 첫 행 첫 열의 도우미 칸(기본: 값 '1' 이 든 글자 입력 — 표를 건드린 상태로 만든다) */
  helper?: TableCell;
  helperValue?: string;
  sumConstraints?: SumConstraint[];
}

export const plainHelper: TableCell = { id: HELPER, type: 'input', content: '' };
export const select = (id: string, distinctGroup?: string): TableCell => ({
  id,
  type: 'select',
  content: '',
  ...(distinctGroup ? { distinctGroup } : {}),
  selectOptions: [
    { id: `${id}-a`, label: '가', value: 'a' },
    { id: `${id}-b`, label: '나', value: 'b' },
  ],
});

export interface Scenario {
  question: Question;
  values: Record<string, unknown>;
  allResponses: Record<string, unknown>;
}

export interface Mechanism {
  /**
   * 숨은 칸에 값이 남을 수 있는가. 값으로 정해지는 장치(차례로 열기·접힌 첫 벌)는 값이 들면 그 칸이 열리므로
   * 「값이 남은 숨은 칸」이 생기지 않는다 — 그런 검증과의 조합은 해당 없음이다.
   */
  residualSurvives: boolean;
  build: (c: ValidatorCase, hidden: boolean) => Scenario;
}

function baseTable(c: ValidatorCase): {
  columns: TableColumn[];
  rows: TableRow[];
  values: Record<string, unknown>;
} {
  const helper = c.helper ?? plainHelper;
  const rows: TableRow[] = [
    { id: 'r0', label: '앞', cells: [helper, { id: 'r0c1', type: 'text', content: '설명' }] },
    {
      id: 'rs',
      label: '중간',
      cells: [
        { id: 'rs0', type: 'text', content: '' },
        { id: 'rs1', type: 'text', content: '' },
      ],
    },
    { id: 'rt', label: '대상', cells: [{ id: 'rt0', type: 'text', content: '대상' }, c.target] },
  ];
  const values: Record<string, unknown> = { [HELPER]: c.helperValue ?? '1' };
  if (c.targetValue !== undefined) values[TARGET] = c.targetValue;
  return {
    columns: [
      { id: 'c0', label: '항목' },
      { id: 'c1', label: '값' },
    ],
    rows,
    values,
  };
}

function question(c: ValidatorCase, parts: Partial<Question>): Question {
  return {
    id: 'q1',
    type: 'table',
    title: '표',
    required: false,
    order: 1,
    ...(c.sumConstraints ? { sumConstraints: c.sumConstraints } : {}),
    ...parts,
  } as Question;
}

function repeated(rows: TableRow[], config: NonNullable<Question['rowRepeatConfig']>): TableRow[] {
  let n = 0;
  return expandRepeatRows(rows, config, () => `gen${++n}`);
}

export const MECHANISMS: Record<StructuralCellHider | ValueDerivedCellHiderKey, Mechanism> = {
  'row-display-condition': {
    residualSurvives: true,
    build: (c, hidden) => {
      const { columns, rows, values } = baseTable(c);
      const withCondition = rows.map((r) =>
        r.id === 'rt' ? { ...r, displayCondition: whenQ0Is1 } : r,
      );
      return {
        question: question(c, { tableColumns: columns, tableRowsData: withCondition }),
        values,
        allResponses: hidden ? {} : { q0: '1' },
      };
    },
  },
  'column-display-condition': {
    residualSurvives: true,
    build: (c, hidden) => {
      const { columns, rows, values } = baseTable(c);
      const withCondition = columns.map((col) =>
        col.id === 'c1' ? { ...col, displayCondition: whenQ0Is1 } : col,
      );
      return {
        question: question(c, { tableColumns: withCondition, tableRowsData: rows }),
        values,
        allResponses: hidden ? {} : { q0: '1' },
      };
    },
  },
  'dynamic-row': {
    residualSurvives: true,
    build: (c, hidden) => {
      const { columns, rows, values } = baseTable(c);
      return {
        question: question(c, {
          tableColumns: columns,
          tableRowsData: rows.map((r) => (r.id === 'rt' ? { ...r, dynamicGroupId: 'g' } : r)),
          dynamicRowConfigs: [{ groupId: 'g', enabled: true }],
        }),
        values: hidden ? values : { ...values, __selectedRowIds: ['rt'] },
        allResponses: {},
      };
    },
  },
  'repeat-block-condition': {
    residualSurvives: true,
    build: (c, hidden) => {
      const { columns, rows, values } = baseTable(c);
      const config = {
        enabled: true,
        templateRowIds: ['rt'],
        maxRepeats: 2,
        displayCondition: whenQ0Is1,
      };
      return {
        question: question(c, {
          tableColumns: columns,
          tableRowsData: repeated(rows, config),
          rowRepeatConfig: config,
        }),
        values,
        allResponses: hidden ? {} : { q0: '1' },
      };
    },
  },
  'staged-rows': {
    residualSurvives: false,
    build: (c, hidden) => {
      const { columns, rows, values } = baseTable(c);
      return {
        question: question(c, {
          tableColumns: columns,
          tableRowsData: rows,
          stagedRowsConfig: {
            enabled: true,
            rowIds: ['rs', 'rt'],
            initialVisibleCount: hidden ? 1 : 2,
          },
        }),
        values,
        allResponses: {},
      };
    },
  },
  'staged-columns': {
    residualSurvives: false,
    build: (c, hidden) => {
      const { columns, rows, values } = baseTable(c);
      return {
        question: question(c, {
          tableColumns: hidden
            ? columns.map((col) => (col.id === 'c1' ? { ...col, revealStep: 2 } : col))
            : columns,
          tableRowsData: rows,
        }),
        values,
        allResponses: {},
      };
    },
  },
  'unopened-repeat-bundles': {
    residualSurvives: false,
    build: (c, hidden) => {
      const { columns, rows, values } = baseTable(c);
      const config = {
        enabled: true,
        templateRowIds: ['rt'],
        maxRepeats: 2,
        startCollapsed: hidden,
      };
      return {
        question: question(c, {
          tableColumns: columns,
          tableRowsData: repeated(rows, config),
          rowRepeatConfig: config,
        }),
        values,
        allResponses: {},
      };
    },
  },
};
