import { describe, expect, it } from 'vitest';

import type { SumConstraint, TableCell } from '@/types/survey';

import {
  type NumericIssue,
  STRUCTURAL_CELL_HIDERS,
  VALUE_DERIVED_CELL_HIDERS,
  collectNumericIssues,
} from './numeric-validation';
import {
  HELPER,
  MECHANISMS,
  type Scenario,
  TARGET,
  type ValidatorCase,
  q0,
  select,
} from '../../../../tests/helpers/hidden-cell-scenarios';

/**
 * 숨기는 장치 × 차단 검증 표 — 화면에 없는 칸은 어떤 차단 검증도 일으키지 않는다.
 *
 * 2026-11-04~06 사이 같은 실수가 세 번 났다: 행 차례로 열기 · 열 차례로 열기 · 처음엔 접어 두기의 칸을 필수에서만
 * 빼서, 보이지 않는 칸이 칸 수 제약·계산 칸 비교로 「다음」을 막았다. 이 표는 장치와 검증을 둘 다 타입으로 묶는다 —
 * - 장치: `STRUCTURAL_CELL_HIDERS` · `VALUE_DERIVED_CELL_HIDERS` 의 키 전부에 시나리오가 있어야 컴파일된다.
 * - 검증: `NumericIssue['kind']` 전부에 칸 시나리오 또는 「표 칸 검증이 아닌 이유」가 있어야 컴파일된다.
 * 칸마다 대조군(같은 설정, 장치를 끈 상태)이 실제로 그 검증을 일으키는지도 본다 — 빈 단언으로 통과하지 않게.
 *
 * 장치 시나리오(`MECHANISMS`)는 `tests/helpers/hidden-cell-scenarios.ts` 에 있다 — 화면 쪽 대조(`hidden-cell-screen-parity.test.tsx`)와 함께 쓴다.
 */

// ── 검증 쪽 ────────────────────────────────────────────────────────────

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
