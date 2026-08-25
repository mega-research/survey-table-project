import { describe, it, expect } from 'vitest';
import type { Question, QuestionCondition, TableValidationRule } from '@/types/survey';
import {
  checkTableValidationRule,
  getBranchRuleForResponse,
  getTableValidationBranchRule,
  shouldDisplayQuestion,
  shouldDisplayRow,
} from '@/utils/branch-logic';

/**
 * characterization 테스트 — 테이블 셀 의미론(table-cell-semantics) 추출 전 현행 동작 고정.
 *
 * branch-logic.ts 안에 5벌 복제된 셀 값 해석·비교 switch(검증 메인/검증 추가조건/분기값 추출/
 * 표시조건 추가조건/checkTableCellCondition)의 관측 가능 동작을 공개 seam 을 통해 핀 고정한다.
 * 추출(2단계 커밋)은 이 스위트가 전부 green 인 상태를 유지해야 한다.
 *
 * isHidden describe 는 동작 변경 커밋(분기·검증 평가에서 isHidden 셀 제외) 이후의 동작을 단언한다.
 */

// ─── 픽스처 ──────────────────────────────────────────────────────────────────
// 3행 × [0]=text 라벨, [1]=radio, [2]=checkbox, [3]=select, [4]=input
// radio 옵션 value: yes/no, checkbox 옵션 value: A/B, select 옵션 value: S1/S2

interface CellOverride {
  rowId: string;
  cellIndex: number;
  patch: Record<string, unknown>;
}

function makeTableQuestion(overrides: CellOverride[] = []): Question {
  const rows = ['row-1', 'row-2', 'row-3'].map((rowId, idx) => {
    const n = idx + 1;
    return {
      id: rowId,
      label: `행${n}`,
      cells: [
        { id: `r${n}-label`, content: `행${n}`, type: 'text' as const },
        {
          id: `r${n}-radio`,
          content: '',
          type: 'radio' as const,
          radioOptions: [
            { id: `r${n}-radio-yes`, label: '예', value: 'yes' },
            { id: `r${n}-radio-no`, label: '아니오', value: 'no' },
          ],
        },
        {
          id: `r${n}-chk`,
          content: '',
          type: 'checkbox' as const,
          checkboxOptions: [
            { id: `r${n}-chk-a`, label: 'A', value: 'A' },
            { id: `r${n}-chk-b`, label: 'B', value: 'B' },
          ],
        },
        {
          id: `r${n}-sel`,
          content: '',
          type: 'select' as const,
          selectOptions: [
            { id: `r${n}-sel-1`, label: 'S1', value: 'S1' },
            { id: `r${n}-sel-2`, label: 'S2', value: 'S2' },
          ],
        },
        { id: `r${n}-input`, content: '', type: 'input' as const },
      ],
    };
  });

  for (const o of overrides) {
    const row = rows.find((r) => r.id === o.rowId);
    if (row) Object.assign(row.cells[o.cellIndex] as object, o.patch);
  }

  return {
    id: 'q-table',
    surveyId: 's1',
    type: 'table',
    title: '소스 표',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'col-label', label: '항목' },
      { id: 'col-radio', label: '라디오' },
      { id: 'col-chk', label: '체크' },
      { id: 'col-sel', label: '셀렉트' },
      { id: 'col-input', label: '입력' },
    ],
    tableRowsData: rows,
  } as unknown as Question;
}

function makeRule(partial: {
  type: TableValidationRule['type'];
  rowIds: string[];
  cellColumnIndex?: number;
  expectedValues?: string[];
  additionalConditions?: TableValidationRule['additionalConditions'];
  targetQuestionId?: string;
  targetQuestionMap?: Record<string, string>;
}): TableValidationRule {
  return {
    id: 'rule-1',
    type: partial.type,
    conditions: {
      checkType: 'radio',
      rowIds: partial.rowIds,
      ...(partial.cellColumnIndex !== undefined
        ? { cellColumnIndex: partial.cellColumnIndex }
        : {}),
      ...(partial.expectedValues ? { expectedValues: partial.expectedValues } : {}),
    },
    ...(partial.additionalConditions ? { additionalConditions: partial.additionalConditions } : {}),
    action: 'goto',
    targetQuestionId: partial.targetQuestionId ?? 'q-default',
    ...(partial.targetQuestionMap ? { targetQuestionMap: partial.targetQuestionMap } : {}),
  };
}

// ─── 1. checkTableValidationRule — 셀 타입별 값 해석 (사본 ①) ────────────────

describe('characterization: checkTableValidationRule 셀 값 해석', () => {
  const q = makeTableQuestion();

  it('radio: { optionId } 객체 저장값을 옵션 value 로 해석해 expectedValues 와 비교', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
    });
    expect(checkTableValidationRule(q, { 'r1-radio': { optionId: 'r1-radio-yes' } }, rule)).toBe(
      true,
    );
    expect(checkTableValidationRule(q, { 'r1-radio': { optionId: 'r1-radio-no' } }, rule)).toBe(
      false,
    );
  });

  it('radio: 평면 string(optionId) 저장값(legacy)도 동일하게 해석', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
    });
    expect(checkTableValidationRule(q, { 'r1-radio': 'r1-radio-yes' }, rule)).toBe(true);
  });

  it('radio: stale optionId(옵션 목록에 없음)는 불일치', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
    });
    expect(checkTableValidationRule(q, { 'r1-radio': { optionId: 'ghost' } }, rule)).toBe(false);
  });

  it('checkbox: optionId 배열 중 하나라도 expectedValues 의 value 로 해석되면 매칭', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 2,
      expectedValues: ['B'],
    });
    expect(
      checkTableValidationRule(
        q,
        { 'r1-chk': [{ optionId: 'r1-chk-a' }, { optionId: 'r1-chk-b' }] },
        rule,
      ),
    ).toBe(true);
    expect(checkTableValidationRule(q, { 'r1-chk': [{ optionId: 'r1-chk-a' }] }, rule)).toBe(false);
  });

  it('checkbox: 배열이 아닌 값은 매칭되지 않음', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 2,
      expectedValues: ['A'],
    });
    expect(checkTableValidationRule(q, { 'r1-chk': 'r1-chk-a' }, rule)).toBe(false);
  });

  it('select: optionId 를 value 로 해석해 비교', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 3,
      expectedValues: ['S2'],
    });
    expect(checkTableValidationRule(q, { 'r1-sel': { optionId: 'r1-sel-2' } }, rule)).toBe(true);
    expect(checkTableValidationRule(q, { 'r1-sel': { optionId: 'r1-sel-1' } }, rule)).toBe(false);
  });

  it('input: trim 후 expectedValues 와 직접 비교', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 4,
      expectedValues: ['42'],
    });
    expect(checkTableValidationRule(q, { 'r1-input': ' 42 ' }, rule)).toBe(true);
    expect(checkTableValidationRule(q, { 'r1-input': '43' }, rule)).toBe(false);
  });

  it('expectedValues 미지정 시 값 존재만으로 매칭(응답됨 격하)', () => {
    const rule = makeRule({ type: 'any-of', rowIds: ['row-1'], cellColumnIndex: 1 });
    expect(checkTableValidationRule(q, { 'r1-radio': { optionId: 'ghost' } }, rule)).toBe(true);
    expect(checkTableValidationRule(q, {}, rule)).toBe(false);
  });

  it('expectedValues 빈 배열은 미지정과 동일(응답됨 격하)', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: [],
    });
    expect(checkTableValidationRule(q, { 'r1-radio': { optionId: 'ghost' } }, rule)).toBe(true);
  });

  it('cellColumnIndex 미지정 시 행의 모든 셀을 검사', () => {
    const rule = makeRule({ type: 'any-of', rowIds: ['row-1'], expectedValues: ['S1'] });
    expect(checkTableValidationRule(q, { 'r1-sel': { optionId: 'r1-sel-1' } }, rule)).toBe(true);
  });

  it('비인터랙티브 폴백: 라벨 열(0) 지정 시 행의 첫 인터랙티브 셀(radio)로 대체', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 0,
      expectedValues: ['yes'],
    });
    expect(checkTableValidationRule(q, { 'r1-radio': { optionId: 'r1-radio-yes' } }, rule)).toBe(
      true,
    );
  });

  it('response 가 객체가 아니면 false', () => {
    const rule = makeRule({ type: 'any-of', rowIds: ['row-1'] });
    expect(checkTableValidationRule(q, 'not-an-object', rule)).toBe(false);
    expect(checkTableValidationRule(q, null, rule)).toBe(false);
  });
});

// ─── 2. checkTableValidationRule — 수량자 5종 ────────────────────────────────

describe('characterization: checkTableValidationRule 수량자', () => {
  const q = makeTableQuestion();

  it('any-of: 지정 행 중 하나라도 매칭이면 true', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1', 'row-2'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
    });
    expect(checkTableValidationRule(q, { 'r2-radio': { optionId: 'r2-radio-yes' } }, rule)).toBe(
      true,
    );
    expect(checkTableValidationRule(q, { 'r3-radio': { optionId: 'r3-radio-yes' } }, rule)).toBe(
      false,
    );
  });

  it('all-of / required-combination: 지정 행 전부 매칭이어야 true', () => {
    for (const type of ['all-of', 'required-combination'] as const) {
      const rule = makeRule({
        type,
        rowIds: ['row-1', 'row-2'],
        cellColumnIndex: 1,
        expectedValues: ['yes'],
      });
      expect(
        checkTableValidationRule(
          q,
          {
            'r1-radio': { optionId: 'r1-radio-yes' },
            'r2-radio': { optionId: 'r2-radio-yes' },
          },
          rule,
        ),
      ).toBe(true);
      expect(checkTableValidationRule(q, { 'r1-radio': { optionId: 'r1-radio-yes' } }, rule)).toBe(
        false,
      );
    }
  });

  it('none-of: 지정 행 모두 비매칭이면 true (빈 응답 포함)', () => {
    const rule = makeRule({
      type: 'none-of',
      rowIds: ['row-1', 'row-2'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
    });
    expect(checkTableValidationRule(q, {}, rule)).toBe(true);
    expect(checkTableValidationRule(q, { 'r1-radio': { optionId: 'r1-radio-no' } }, rule)).toBe(
      true,
    );
    expect(checkTableValidationRule(q, { 'r1-radio': { optionId: 'r1-radio-yes' } }, rule)).toBe(
      false,
    );
  });

  it('exclusive-check: 지정 행만 값이 존재해야 true (값 존재는 타입 불문)', () => {
    const rule = makeRule({ type: 'exclusive-check', rowIds: ['row-1'], cellColumnIndex: 1 });
    expect(checkTableValidationRule(q, { 'r1-radio': { optionId: 'r1-radio-yes' } }, rule)).toBe(
      true,
    );
    // 지정 외 행(row-2)에도 값 존재 → false
    expect(
      checkTableValidationRule(
        q,
        {
          'r1-radio': { optionId: 'r1-radio-yes' },
          'r2-radio': { optionId: 'r2-radio-no' },
        },
        rule,
      ),
    ).toBe(false);
    // 아무 값도 없음 → false (체크된 행이 있어야 함)
    expect(checkTableValidationRule(q, {}, rule)).toBe(false);
  });

  it('exclusive-check: 전수 스캔도 비인터랙티브 폴백 적용 (라벨 열 지정)', () => {
    const rule = makeRule({ type: 'exclusive-check', rowIds: ['row-1'], cellColumnIndex: 0 });
    expect(checkTableValidationRule(q, { 'r1-radio': { optionId: 'r1-radio-yes' } }, rule)).toBe(
      true,
    );
    expect(checkTableValidationRule(q, { 'r2-radio': { optionId: 'r2-radio-no' } }, rule)).toBe(
      false,
    );
  });

  it('exclusive-check: 값 존재 판정은 빈 문자열·빈 배열을 미응답으로 본다', () => {
    const rule = makeRule({ type: 'exclusive-check', rowIds: ['row-1'], cellColumnIndex: 4 });
    expect(
      checkTableValidationRule(q, { 'r1-input': 'x', 'r2-input': '   ' }, rule),
    ).toBe(true);
    expect(checkTableValidationRule(q, { 'r1-input': 'x', 'r2-chk': [] }, rule)).toBe(true);
  });
});

// ─── 3. checkTableValidationRule — 추가조건 (사본 ②) ─────────────────────────

describe('characterization: checkTableValidationRule 추가조건', () => {
  const q = makeTableQuestion();

  it('메인 매칭 행에서 추가조건(다른 열)도 만족해야 true', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1', 'row-2'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
      additionalConditions: { cellColumnIndex: 2, checkType: 'checkbox', expectedValues: ['A'] },
    });
    expect(
      checkTableValidationRule(
        q,
        {
          'r1-radio': { optionId: 'r1-radio-yes' },
          'r1-chk': [{ optionId: 'r1-chk-a' }],
        },
        rule,
      ),
    ).toBe(true);
    // 추가조건이 다른 행(row-2)에서만 만족 → 메인 통과 행(row-1)과 불일치 → false
    expect(
      checkTableValidationRule(
        q,
        {
          'r1-radio': { optionId: 'r1-radio-yes' },
          'r2-chk': [{ optionId: 'r2-chk-a' }],
        },
        rule,
      ),
    ).toBe(false);
  });

  it('additionalConditions.rowIds 지정 시 그 행으로 평가 범위 제한', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1', 'row-2'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
      additionalConditions: {
        cellColumnIndex: 2,
        checkType: 'checkbox',
        rowIds: ['row-2'],
        expectedValues: ['A'],
      },
    });
    // 메인은 row-1 통과, 추가조건은 row-2 로 제한 — row-2 의 checkbox 만 본다
    expect(
      checkTableValidationRule(
        q,
        {
          'r1-radio': { optionId: 'r1-radio-yes' },
          'r2-chk': [{ optionId: 'r2-chk-a' }],
        },
        rule,
      ),
    ).toBe(true);
    expect(
      checkTableValidationRule(
        q,
        {
          'r1-radio': { optionId: 'r1-radio-yes' },
          'r1-chk': [{ optionId: 'r1-chk-a' }],
        },
        rule,
      ),
    ).toBe(false);
  });

  it('none-of + 추가조건(rowIds 미지정): 메인 통과 행이 없어 항상 false — 현행 비대칭 핀', () => {
    // 표시조건 경로('none' checkType)와 달리 검증 룰 경로는 'none-of' 특수 처리가 없다.
    // rowsToCheckForAdditional = checkedRowsInTarget = [] → 즉시 false.
    const rule = makeRule({
      type: 'none-of',
      rowIds: ['row-1', 'row-2'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
      additionalConditions: { cellColumnIndex: 2, checkType: 'checkbox' },
    });
    expect(checkTableValidationRule(q, { 'r1-chk': [{ optionId: 'r1-chk-a' }] }, rule)).toBe(false);
  });

  it('none-of + 추가조건(rowIds 지정): 제한 행에서 추가조건 평가', () => {
    const rule = makeRule({
      type: 'none-of',
      rowIds: ['row-1', 'row-2'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
      additionalConditions: { cellColumnIndex: 2, checkType: 'checkbox', rowIds: ['row-1'] },
    });
    expect(checkTableValidationRule(q, { 'r1-chk': [{ optionId: 'r1-chk-a' }] }, rule)).toBe(true);
    expect(checkTableValidationRule(q, {}, rule)).toBe(false);
  });

  it('legacy: 추가조건 cellColumnIndex 누락 시 불충족(false) — fail-closed 유지', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      additionalConditions: {
        checkType: 'radio',
      } as unknown as TableValidationRule['additionalConditions'],
    });
    expect(checkTableValidationRule(q, { 'r1-radio': { optionId: 'r1-radio-yes' } }, rule)).toBe(
      false,
    );
  });
});

// ─── 4. getTableValidationBranchRule — 분기값 추출 (사본 ③) ──────────────────

describe('characterization: getTableValidationBranchRule 분기값 추출', () => {
  function makeQuestionWithRule(rule: TableValidationRule): Question {
    const q = makeTableQuestion();
    (q as unknown as { tableValidationRules: TableValidationRule[] }).tableValidationRules = [rule];
    return q;
  }

  it('규칙 불만족 시 null', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
    });
    expect(getTableValidationBranchRule(makeQuestionWithRule(rule), {})).toBeNull();
  });

  it('targetQuestionMap 없이 만족 시 기본 targetQuestionId 반환', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
      targetQuestionId: 'q-next',
    });
    const branch = getTableValidationBranchRule(makeQuestionWithRule(rule), {
      'r1-radio': { optionId: 'r1-radio-yes' },
    });
    expect(branch).toMatchObject({ action: 'goto', targetQuestionId: 'q-next' });
  });

  it('radio: 추가조건 열의 선택값으로 targetQuestionMap 분기', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 2,
      expectedValues: ['A'],
      additionalConditions: { cellColumnIndex: 1, checkType: 'radio' },
      targetQuestionId: 'q-default',
      targetQuestionMap: { yes: 'q-yes', no: 'q-no' },
    });
    const branch = getTableValidationBranchRule(makeQuestionWithRule(rule), {
      'r1-chk': [{ optionId: 'r1-chk-a' }],
      'r1-radio': { optionId: 'r1-radio-no' },
    });
    expect(branch?.targetQuestionId).toBe('q-no');
  });

  it('checkbox: 첫 번째 체크 옵션의 value 로 분기', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
      additionalConditions: { cellColumnIndex: 2, checkType: 'checkbox' },
      targetQuestionMap: { A: 'q-a', B: 'q-b' },
    });
    const branch = getTableValidationBranchRule(makeQuestionWithRule(rule), {
      'r1-radio': { optionId: 'r1-radio-yes' },
      'r1-chk': [{ optionId: 'r1-chk-b' }, { optionId: 'r1-chk-a' }],
    });
    expect(branch?.targetQuestionId).toBe('q-b');
  });

  it('checkbox: 첫 optionId 가 stale 이면 그 셀에서 값 추출 실패 — 기본 타겟 폴백 (미세 동작 핀)', () => {
    // 현행 ③은 checkedOptionIds[0] 만 본다. 첫 항목이 stale 이면 두 번째가 유효해도 추출 실패.
    // 추출(2단계)에서 "첫 해석 가능한 값" 으로 바뀌면 이 핀을 의도적으로 갱신해야 한다.
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
      additionalConditions: { cellColumnIndex: 2, checkType: 'checkbox' },
      targetQuestionId: 'q-default',
      targetQuestionMap: { A: 'q-a', B: 'q-b' },
    });
    const branch = getTableValidationBranchRule(makeQuestionWithRule(rule), {
      'r1-radio': { optionId: 'r1-radio-yes' },
      'r1-chk': [{ optionId: 'ghost' }, { optionId: 'r1-chk-a' }],
    });
    expect(branch?.targetQuestionId).toBe('q-default');
  });

  it('input: trim 한 값으로 targetQuestionMap 조회', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
      additionalConditions: { cellColumnIndex: 4, checkType: 'input' },
      targetQuestionMap: { '42': 'q-42' },
    });
    const branch = getTableValidationBranchRule(makeQuestionWithRule(rule), {
      'r1-radio': { optionId: 'r1-radio-yes' },
      'r1-input': ' 42 ',
    });
    expect(branch?.targetQuestionId).toBe('q-42');
  });

  it('맵에 없는 값이면 기본 targetQuestionId 유지', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
      additionalConditions: { cellColumnIndex: 4, checkType: 'input' },
      targetQuestionId: 'q-default',
      targetQuestionMap: { '42': 'q-42' },
    });
    const branch = getTableValidationBranchRule(makeQuestionWithRule(rule), {
      'r1-radio': { optionId: 'r1-radio-yes' },
      'r1-input': '99',
    });
    expect(branch?.targetQuestionId).toBe('q-default');
  });

  it('select: 추가조건 열의 선택값으로 targetQuestionMap 분기', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
      additionalConditions: { cellColumnIndex: 3, checkType: 'select' },
      targetQuestionMap: { S1: 'q-s1', S2: 'q-s2' },
    });
    const branch = getTableValidationBranchRule(makeQuestionWithRule(rule), {
      'r1-radio': { optionId: 'r1-radio-yes' },
      'r1-sel': { optionId: 'r1-sel-2' },
    });
    expect(branch?.targetQuestionId).toBe('q-s2');
  });

  it('회귀: 빈 value 옵션을 선택한 행은 건너뛰고 후속 행의 유효 매핑을 사용한다', () => {
    // 빌더의 매핑 추가 버튼이 { '': '' } 엔트리를 만들 수 있어 map 에 '' 키가 실재 가능.
    // find 가 ''를 히트로 소비한 뒤 falsy 가드가 폐기하면 후속 행의 유효 매핑이 무시된다.
    const qEmptyOpt = makeTableQuestion([
      {
        rowId: 'row-1',
        cellIndex: 1,
        patch: {
          radioOptions: [
            { id: 'r1-radio-empty', label: '없음', value: '' },
            { id: 'r1-radio-yes', label: '예', value: 'yes' },
          ],
        },
      },
    ]);
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1', 'row-2'],
      cellColumnIndex: 1,
      additionalConditions: {
        cellColumnIndex: 1,
        checkType: 'radio',
        rowIds: ['row-1', 'row-2'],
      },
      targetQuestionId: 'q-default',
      targetQuestionMap: { '': 'q-empty', yes: 'q-yes' },
    });
    (qEmptyOpt as unknown as { tableValidationRules: TableValidationRule[] }).tableValidationRules =
      [rule];
    const branch = getTableValidationBranchRule(qEmptyOpt, {
      'r1-radio': { optionId: 'r1-radio-empty' },
      'r2-radio': { optionId: 'r2-radio-yes' },
    });
    expect(branch?.targetQuestionId).toBe('q-yes');
  });

  it('legacy: 추가조건 cellColumnIndex 누락 시 분기값 추출을 생략하고 기본 타겟 유지', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
      additionalConditions: {
        checkType: 'radio',
        rowIds: ['row-1'],
      } as unknown as TableValidationRule['additionalConditions'],
      targetQuestionId: 'q-default',
      targetQuestionMap: { yes: 'q-yes' },
    });
    // 메인 조건은 추가조건 누락 가드(false)에 걸리므로, 추가조건 없는 쌍둥이 규칙으로 만족시킨다
    const ruleSatisfied = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
      targetQuestionId: 'q-plain',
    });
    const q2 = makeQuestionWithRule(rule);
    (q2 as unknown as { tableValidationRules: TableValidationRule[] }).tableValidationRules = [
      rule,
      ruleSatisfied,
    ];
    const branch = getTableValidationBranchRule(q2, {
      'r1-radio': { optionId: 'r1-radio-yes' },
    });
    // cellColumnIndex 누락 규칙은 추가조건 불충족으로 매칭 자체가 안 되고, 다음 규칙으로 넘어간다
    expect(branch?.targetQuestionId).toBe('q-plain');
  });
});

// ─── 5. 표시조건 경로 — checkTableCellCondition (사본 ⑤) + 추가조건 (사본 ④) ──

describe('characterization: 표시조건 table-cell-check', () => {
  function makeTarget(
    tableConditions: NonNullable<QuestionCondition['tableConditions']>,
    additionalConditions?: QuestionCondition['additionalConditions'],
  ): Question {
    const condition: QuestionCondition = {
      id: 'cond-1',
      sourceQuestionId: 'q-table',
      conditionType: 'table-cell-check',
      logicType: 'AND',
      tableConditions,
      ...(additionalConditions ? { additionalConditions } : {}),
    } as QuestionCondition;
    return {
      id: 'q-target',
      surveyId: 's1',
      type: 'text',
      title: '대상',
      required: false,
      order: 1,
      displayCondition: { conditions: [condition], logicType: 'AND' },
    } as unknown as Question;
  }

  function evalDisplay(
    responses: Record<string, unknown>,
    tableConditions: NonNullable<QuestionCondition['tableConditions']>,
    additionalConditions?: QuestionCondition['additionalConditions'],
  ): boolean {
    const source = makeTableQuestion();
    const target = makeTarget(tableConditions, additionalConditions);
    return shouldDisplayQuestion(target, { 'q-table': responses }, [source, target]);
  }

  it('radio + expectedValues: optionId 를 value 로 해석', () => {
    const tc = { rowIds: ['row-1'], cellColumnIndex: 1, checkType: 'any' as const, expectedValues: ['yes'] };
    expect(evalDisplay({ 'r1-radio': { optionId: 'r1-radio-yes' } }, tc)).toBe(true);
    expect(evalDisplay({ 'r1-radio': { optionId: 'r1-radio-no' } }, tc)).toBe(false);
    expect(evalDisplay({ 'r1-radio': { optionId: 'ghost' } }, tc)).toBe(false);
  });

  it('select + expectedValues', () => {
    const tc = { rowIds: ['row-1'], cellColumnIndex: 3, checkType: 'any' as const, expectedValues: ['S1'] };
    expect(evalDisplay({ 'r1-sel': { optionId: 'r1-sel-1' } }, tc)).toBe(true);
    expect(evalDisplay({ 'r1-sel': { optionId: 'r1-sel-2' } }, tc)).toBe(false);
  });

  it('input + expectedValues: trim 후 비교 (string 값)', () => {
    const tc = { rowIds: ['row-1'], cellColumnIndex: 4, checkType: 'any' as const, expectedValues: ['42'] };
    expect(evalDisplay({ 'r1-input': ' 42 ' }, tc)).toBe(true);
    expect(evalDisplay({ 'r1-input': '43' }, tc)).toBe(false);
  });

  it("checkType 'all': 지정 행 전부 매칭이어야 표시", () => {
    const tc = {
      rowIds: ['row-1', 'row-2'],
      cellColumnIndex: 1,
      checkType: 'all' as const,
      expectedValues: ['yes'],
    };
    expect(
      evalDisplay(
        { 'r1-radio': { optionId: 'r1-radio-yes' }, 'r2-radio': { optionId: 'r2-radio-yes' } },
        tc,
      ),
    ).toBe(true);
    expect(evalDisplay({ 'r1-radio': { optionId: 'r1-radio-yes' } }, tc)).toBe(false);
  });

  it('표시조건 경로에는 비인터랙티브 폴백이 없다 — 라벨 열 지정 시 매칭 불가 (현행 비대칭 핀)', () => {
    const tc = { rowIds: ['row-1'], cellColumnIndex: 0, checkType: 'any' as const, expectedValues: ['yes'] };
    expect(evalDisplay({ 'r1-radio': { optionId: 'r1-radio-yes' } }, tc)).toBe(false);
  });

  it('추가조건(사본 ④): 메인 통과 행과 같은 행에서 추가 열 매칭', () => {
    const tc = {
      rowIds: ['row-1', 'row-2'],
      cellColumnIndex: 1,
      checkType: 'any' as const,
      expectedValues: ['yes'],
    };
    const ac = { cellColumnIndex: 2, checkType: 'checkbox' as const, expectedValues: ['A'] };
    expect(
      evalDisplay(
        { 'r1-radio': { optionId: 'r1-radio-yes' }, 'r1-chk': [{ optionId: 'r1-chk-a' }] },
        tc,
        ac,
      ),
    ).toBe(true);
    expect(
      evalDisplay(
        { 'r1-radio': { optionId: 'r1-radio-yes' }, 'r2-chk': [{ optionId: 'r2-chk-a' }] },
        tc,
        ac,
      ),
    ).toBe(false);
  });

  it('radio: 평면 string(optionId) legacy 저장값도 표시조건 경로에서 해석', () => {
    const tc = {
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      checkType: 'any' as const,
      expectedValues: ['yes'],
    };
    expect(evalDisplay({ 'r1-radio': 'r1-radio-yes' }, tc)).toBe(true);
    expect(evalDisplay({ 'r1-radio': 'r1-radio-no' }, tc)).toBe(false);
  });

  it('checkbox 메인: optionId 배열을 value 로 해석해 비교', () => {
    const tc = {
      rowIds: ['row-1'],
      cellColumnIndex: 2,
      checkType: 'any' as const,
      expectedValues: ['B'],
    };
    expect(evalDisplay({ 'r1-chk': [{ optionId: 'r1-chk-b' }] }, tc)).toBe(true);
    expect(evalDisplay({ 'r1-chk': [{ optionId: 'r1-chk-a' }] }, tc)).toBe(false);
  });

  it('expectedValues 빈 배열은 미지정과 동일(응답됨 격하)', () => {
    const tc = {
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      checkType: 'any' as const,
      expectedValues: [],
    };
    expect(evalDisplay({ 'r1-radio': { optionId: 'ghost' } }, tc)).toBe(true);
  });

  it('추가조건 numericComparison: input 셀 값으로 숫자 비교 (사본 ④ 전용 경로)', () => {
    const tc = {
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      checkType: 'any' as const,
      expectedValues: ['yes'],
    };
    const ac = {
      cellColumnIndex: 4,
      checkType: 'input' as const,
      numericComparison: {
        operator: '>=' as const,
        comparand: { kind: 'literal' as const, value: 10 },
      },
    };
    expect(
      evalDisplay({ 'r1-radio': { optionId: 'r1-radio-yes' }, 'r1-input': '12' }, tc, ac),
    ).toBe(true);
    expect(
      evalDisplay({ 'r1-radio': { optionId: 'r1-radio-yes' }, 'r1-input': '5' }, tc, ac),
    ).toBe(false);
  });

  it('legacy: 추가조건 cellColumnIndex 누락 시 숨김(false) — fail-closed 유지', () => {
    const tc = {
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      checkType: 'any' as const,
      expectedValues: ['yes'],
    };
    const ac = { checkType: 'checkbox' } as unknown as QuestionCondition['additionalConditions'];
    expect(
      evalDisplay(
        { 'r1-radio': { optionId: 'r1-radio-yes' }, 'r1-chk': [{ optionId: 'r1-chk-a' }] },
        tc,
        ac,
      ),
    ).toBe(false);
  });
});

// ─── 6. isHidden 셀 — 평가에서 제외 (렌더·행 완료 판정과 정합) ────────────────

describe('isHidden 셀 — 분기·검증 평가에서 제외', () => {
  const qHidden = makeTableQuestion([
    { rowId: 'row-1', cellIndex: 1, patch: { isHidden: true } },
  ]);

  it('검증 룰: hidden radio 셀의 잔존 응답값은 매칭에 사용되지 않는다', () => {
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
    });
    expect(
      checkTableValidationRule(qHidden, { 'r1-radio': { optionId: 'r1-radio-yes' } }, rule),
    ).toBe(false);
  });

  it('표시조건: hidden 셀 잔존 값은 매칭에 사용되지 않는다', () => {
    const condition: QuestionCondition = {
      id: 'cond-1',
      sourceQuestionId: 'q-table',
      conditionType: 'table-cell-check',
      logicType: 'AND',
      tableConditions: {
        rowIds: ['row-1'],
        cellColumnIndex: 1,
        checkType: 'any',
        expectedValues: ['yes'],
      },
    } as QuestionCondition;
    const target = {
      id: 'q-target',
      surveyId: 's1',
      type: 'text',
      title: '대상',
      required: false,
      order: 1,
      displayCondition: { conditions: [condition], logicType: 'AND' },
    } as unknown as Question;
    expect(
      shouldDisplayQuestion(
        target,
        { 'q-table': { 'r1-radio': { optionId: 'r1-radio-yes' } } },
        [qHidden, target],
      ),
    ).toBe(false);
  });

  it('비인터랙티브 폴백: hidden 첫 인터랙티브 셀은 건너뛰고 다음 인터랙티브 셀로 대체', () => {
    // 라벨 열(0) 지정 → 폴백이 radio(1, hidden)를 건너뛰고 checkbox(2)를 선택해야 한다
    const rule = makeRule({
      type: 'any-of',
      rowIds: ['row-1'],
      cellColumnIndex: 0,
      expectedValues: ['A'],
    });
    expect(
      checkTableValidationRule(
        qHidden,
        {
          'r1-radio': { optionId: 'r1-radio-yes' },
          'r1-chk': [{ optionId: 'r1-chk-a' }],
        },
        rule,
      ),
    ).toBe(true);
  });

  it('exclusive-check: 지정 외 행의 hidden 셀 잔존 값은 독점성을 깨지 않는다', () => {
    const qHiddenRow2 = makeTableQuestion([
      { rowId: 'row-2', cellIndex: 1, patch: { isHidden: true } },
    ]);
    const rule = makeRule({ type: 'exclusive-check', rowIds: ['row-1'], cellColumnIndex: 1 });
    expect(
      checkTableValidationRule(
        qHiddenRow2,
        {
          'r1-radio': { optionId: 'r1-radio-yes' },
          'r2-radio': { optionId: 'r2-radio-no' },
        },
        rule,
      ),
    ).toBe(true);
  });

  it('cellColumnIndex 미지정(모든 셀 스캔)에서도 hidden 셀은 제외된다', () => {
    const rule = makeRule({ type: 'any-of', rowIds: ['row-1'], expectedValues: ['yes'] });
    expect(
      checkTableValidationRule(qHidden, { 'r1-radio': { optionId: 'r1-radio-yes' } }, rule),
    ).toBe(false);
  });

  // 아래 3건은 제외 정책이 결과를 "만족" 방향으로 뒤집는 위험 방향 — 게이트 회귀 시 즉시 적발용
  it("none-of: hidden 잔존값 제외로 '아무도 매칭 안 됨'이 새로 만족된다", () => {
    const rule = makeRule({
      type: 'none-of',
      rowIds: ['row-1'],
      cellColumnIndex: 1,
      expectedValues: ['yes'],
    });
    expect(
      checkTableValidationRule(qHidden, { 'r1-radio': { optionId: 'r1-radio-yes' } }, rule),
    ).toBe(true);
  });

  it("표시조건 checkType 'none': hidden 잔존값 제외로 질문이 새로 표시된다", () => {
    const condition: QuestionCondition = {
      id: 'cond-1',
      sourceQuestionId: 'q-table',
      conditionType: 'table-cell-check',
      logicType: 'AND',
      tableConditions: {
        rowIds: ['row-1'],
        cellColumnIndex: 1,
        checkType: 'none',
        expectedValues: ['yes'],
      },
    } as QuestionCondition;
    const target = {
      id: 'q-target',
      surveyId: 's1',
      type: 'text',
      title: '대상',
      required: false,
      order: 1,
      displayCondition: { conditions: [condition], logicType: 'AND' },
    } as unknown as Question;
    expect(
      shouldDisplayQuestion(
        target,
        { 'q-table': { 'r1-radio': { optionId: 'r1-radio-yes' } } },
        [qHidden, target],
      ),
    ).toBe(true);
  });

  it('exclusive-check: 지정 행의 응답 셀이 hidden 이면 체크된 행이 없어 false', () => {
    const rule = makeRule({ type: 'exclusive-check', rowIds: ['row-1'], cellColumnIndex: 1 });
    expect(
      checkTableValidationRule(qHidden, { 'r1-radio': { optionId: 'r1-radio-yes' } }, rule),
    ).toBe(false);
  });
});

// ─── 6b. isHidden 셀 — 셀 옵션 branchRule 경로 (getBranchRuleForTable) ────────

describe('isHidden 셀 — 셀 옵션 branchRule 분기에서도 제외', () => {
  it('hidden radio 셀 옵션의 branchRule 은 분기를 결정하지 않는다', () => {
    const q = makeTableQuestion([
      {
        rowId: 'row-1',
        cellIndex: 1,
        patch: {
          isHidden: true,
          radioOptions: [
            {
              id: 'r1-radio-yes',
              label: '예',
              value: 'yes',
              branchRule: { id: 'br-1', value: 'yes', action: 'goto', targetQuestionId: 'q-9' },
            },
            { id: 'r1-radio-no', label: '아니오', value: 'no' },
          ],
        },
      },
    ]);
    expect(getBranchRuleForResponse(q, { 'r1-radio': 'r1-radio-yes' })).toBeNull();
  });
});

// ─── 7. AND/OR/NOT 조합 (shouldDisplayRow 로 대표 핀) ─────────────────────────

describe('characterization: 조건 그룹 AND/OR/NOT 조합', () => {
  function makeRadioSource(): Question {
    return {
      id: 'q-radio',
      surveyId: 's1',
      type: 'radio',
      title: '라디오 질문',
      required: false,
      order: 0,
      options: ['a', 'b', 'c'],
    } as unknown as Question;
  }

  function makeRow(logicType: 'AND' | 'OR' | 'NOT', requiredA: string, requiredB: string) {
    return {
      id: 'row-x',
      label: '행',
      cells: [],
      displayCondition: {
        logicType,
        conditions: [
          {
            id: 'c1',
            sourceQuestionId: 'q-radio',
            conditionType: 'value-match',
            logicType: 'AND',
            requiredValues: [requiredA],
          },
          {
            id: 'c2',
            sourceQuestionId: 'q-radio',
            conditionType: 'value-match',
            logicType: 'AND',
            requiredValues: [requiredB],
          },
        ],
      },
    };
  }

  const allQuestions = [makeRadioSource()];

  it('AND: 모든 조건 만족 시에만 표시', () => {
    const row = makeRow('AND', 'a', 'b');
    expect(shouldDisplayRow(row as never, { 'q-radio': 'a' }, allQuestions)).toBe(false);
  });

  it('OR: 하나만 만족해도 표시', () => {
    const row = makeRow('OR', 'a', 'b');
    expect(shouldDisplayRow(row as never, { 'q-radio': 'a' }, allQuestions)).toBe(true);
  });

  it('NOT: 어떤 조건도 만족하지 않아야 표시', () => {
    const row = makeRow('NOT', 'a', 'b');
    expect(shouldDisplayRow(row as never, { 'q-radio': 'c' }, allQuestions)).toBe(true);
    expect(shouldDisplayRow(row as never, { 'q-radio': 'a' }, allQuestions)).toBe(false);
  });

  it('enabled === false 조건은 평가에서 제외', () => {
    const row = makeRow('AND', 'a', 'b');
    (row.displayCondition.conditions[1] as { enabled?: boolean }).enabled = false;
    expect(shouldDisplayRow(row as never, { 'q-radio': 'a' }, allQuestions)).toBe(true);
  });
});
