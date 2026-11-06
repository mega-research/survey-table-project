import { describe, expect, it } from 'vitest';

import { expandRepeatRows } from '@/lib/question/row-repeat';
import type {
  Question,
  QuestionConditionGroup,
  SumConstraint,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';

import {
  type NumericIssue,
  STRUCTURAL_CELL_HIDERS,
  type StructuralCellHider,
  VALUE_DERIVED_CELL_HIDERS,
  type ValueDerivedCellHiderKey,
  collectNumericIssues,
} from './numeric-validation';

/**
 * 숨기는 장치 × 차단 검증 표 — 화면에 없는 칸은 어떤 차단 검증도 일으키지 않는다.
 *
 * 2026-11-04~06 사이 같은 실수가 세 번 났다: 행 차례로 열기 · 열 차례로 열기 · 처음엔 접어 두기의 칸을 필수에서만
 * 빼서, 보이지 않는 칸이 칸 수 제약·계산 칸 비교로 「다음」을 막았다. 이 표는 장치와 검증을 둘 다 타입으로 묶는다 —
 * - 장치: `STRUCTURAL_CELL_HIDERS` · `VALUE_DERIVED_CELL_HIDERS` 의 키 전부에 시나리오가 있어야 컴파일된다.
 * - 검증: `NumericIssue['kind']` 전부에 칸 시나리오 또는 「표 칸 검증이 아닌 이유」가 있어야 컴파일된다.
 * 칸마다 대조군(같은 설정, 장치를 끈 상태)이 실제로 그 검증을 일으키는지도 본다 — 빈 단언으로 통과하지 않게.
 */

const whenQ0Is1: QuestionConditionGroup = {
  logicType: 'AND',
  conditions: [
    { id: 'q0-is-1', conditionType: 'value-match', sourceQuestionId: 'q0', requiredValues: ['1'] },
  ],
} as QuestionConditionGroup;
const q0 = {
  id: 'q0',
  type: 'radio',
  title: '조건 문항',
  required: false,
  order: 0,
  options: [{ id: 'o1', label: '예', value: '1' }],
} as Question;

const TARGET = 'T';
const HELPER = 'H';

// ── 검증 쪽 ────────────────────────────────────────────────────────────

interface ValidatorCase {
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

const plainHelper: TableCell = { id: HELPER, type: 'input', content: '' };
const select = (id: string, distinctGroup?: string): TableCell => ({
  id,
  type: 'select',
  content: '',
  ...(distinctGroup ? { distinctGroup } : {}),
  selectOptions: [
    { id: `${id}-a`, label: '가', value: 'a' },
    { id: `${id}-b`, label: '나', value: 'b' },
  ],
});

const VALIDATORS: Record<
  NumericIssue['kind'],
  readonly ValidatorCase[] | { notTableCell: string }
> = {
  'required-cells': [
    {
      name: '필수 칸이 비었다',
      target: { id: TARGET, type: 'input', content: '', required: true },
    },
  ],
  range: [
    {
      name: '숫자 하한 미달',
      target: {
        id: TARGET,
        type: 'input',
        content: '',
        inputType: 'number',
        numberFormat: { min: 10 },
      },
      targetValue: '5',
    },
  ],
  format: [
    {
      name: '이메일 형식 위반',
      target: { id: TARGET, type: 'input', content: '', inputType: 'email' },
      targetValue: 'abc',
    },
  ],
  'text-quality': [
    {
      name: '최소 글자 수 미달',
      target: { id: TARGET, type: 'input', content: '', textValidation: { minLength: 5 } },
      targetValue: 'ab',
    },
  ],
  sum: [
    {
      name: '합계 제약 미달',
      target: { id: TARGET, type: 'input', content: '', inputType: 'number' },
      targetValue: '1',
      sumConstraints: [
        { id: 'sum', cellIds: [TARGET], operator: 'gte', target: 100 } as SumConstraint,
      ],
    },
    {
      name: '입력 칸 수 제약 미달',
      target: { id: TARGET, type: 'input', content: '' },
      sumConstraints: [
        {
          id: 'count',
          aggregate: 'count',
          cellIds: [TARGET],
          operator: 'gte',
          target: 1,
        } as SumConstraint,
      ],
    },
  ],
  distinct: [
    {
      name: '중복 불가 묶음에서 같은 보기',
      target: select(TARGET, 'd'),
      targetValue: 'a',
      helper: select(HELPER, 'd'),
      helperValue: 'a',
    },
  ],
  formula: [
    {
      name: '입력값이 수식과 다르다',
      target: {
        id: TARGET,
        type: 'input',
        content: '',
        inputType: 'number',
        formula: { kind: 'literal', value: 7 },
      } as TableCell,
      targetValue: '3',
    },
    {
      name: '계산 칸이 기준을 못 넘는다',
      target: {
        id: TARGET,
        type: 'calc',
        content: '',
        formula: { kind: 'literal', value: 0 },
        calcValidation: { operator: 'gte', target: { kind: 'cell', cellId: HELPER } },
      } as TableCell,
      helper: { id: HELPER, type: 'input', content: '', inputType: 'number' },
      helperValue: '5',
    },
  ],
  'required-detail': {
    notTableCell: '보기 문항의 상세 기재 — 표 칸의 상세 기재 누락은 required-cells 로 낸다',
  },
  'selection-max': { notTableCell: '일반 체크박스 문항의 최대 선택 개수 — 표 칸 검증이 아니다' },
};

// ── 장치 쪽 ────────────────────────────────────────────────────────────

interface Scenario {
  question: Question;
  values: Record<string, unknown>;
  allResponses: Record<string, unknown>;
}

interface Mechanism {
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

const MECHANISMS: Record<StructuralCellHider | ValueDerivedCellHiderKey, Mechanism> = {
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

function issuesOf(s: Scenario): NumericIssue[] {
  return collectNumericIssues(s.question, s.values, {
    allResponses: { ...s.allResponses, q1: s.values },
    allQuestions: [q0, s.question],
  });
}

const cases = Object.entries(VALIDATORS).flatMap(([kind, entry]) =>
  Array.isArray(entry) ? entry.map((c) => ({ kind: kind as NumericIssue['kind'], c })) : [],
);

describe('장치 목록이 등록부와 같다', () => {
  it('표의 장치는 등록부의 장치 전부다', () => {
    expect(Object.keys(MECHANISMS).sort()).toEqual(
      [...STRUCTURAL_CELL_HIDERS, ...Object.keys(VALUE_DERIVED_CELL_HIDERS)].sort(),
    );
  });
});

describe.each(Object.entries(MECHANISMS))('%s 로 숨은 칸', (_name, mechanism) => {
  const applicable = cases.filter(
    ({ c }) => mechanism.residualSurvives || c.targetValue === undefined,
  );

  it.each(applicable.map(({ kind, c }) => [c.name, kind, c] as const))(
    '%s — 보이면 %s 이 나고, 숨으면 나지 않는다',
    (_label, kind, c) => {
      const visible = issuesOf(mechanism.build(c, false));
      expect(
        visible.some((i) => i.kind === kind && (i.cellIds ?? []).includes(TARGET)),
        `대조군(장치 꺼짐)이 ${kind} 를 내지 않는다 — 시나리오가 검증을 일으키지 못한다: ${JSON.stringify(visible)}`,
      ).toBe(true);

      const hidden = issuesOf(mechanism.build(c, true));
      expect(hidden.filter((i) => i.kind === kind)).toEqual([]);
    },
  );
});
