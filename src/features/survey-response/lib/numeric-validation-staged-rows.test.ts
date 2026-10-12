import { describe, expect, it } from 'vitest';

import { collectNumericIssues } from '@/features/survey-response/lib/numeric-validation';
import type { Question, StagedRowsConfig, TableCell, TableRow } from '@/types/survey';

/**
 * 행 차례로 열기 — 필수는 「처음 보이는 행」과 「값이 있는 마지막 행」까지만 본다.
 * 그 뒤의 행은 열려 있어도 없는 행이다. 행 반복의 「1벌만 본다」와 다르다 — 여기서는
 * 뒤쪽 행도 앞쪽과 같은 무게의 답이라, 적기 시작한 행은 평범한 행으로 검사한다.
 * 판정은 값만 본다(세션에서 `+` 로 연 수는 검증이 알 수 없다).
 */

const config: StagedRowsConfig = {
  enabled: true,
  rowIds: ['s1', 's2', 's3', 's4'],
  initialVisibleCount: 2,
};

function requiredInput(id: string): TableCell {
  return { id, type: 'input', content: '', required: true };
}

/** 국가(select) + 비중(국가를 고르면 열리고 그때 필수) 한 쌍 */
function countryRow(id: string, countryRequired: boolean): TableRow {
  const country: TableCell = {
    id: `${id}-country`,
    type: 'select',
    content: '',
    required: countryRequired,
    selectOptions: [
      { id: 'o1', label: '미국', value: 'us' },
      { id: 'o2', label: '일본', value: 'jp' },
    ],
  };
  const share: TableCell = {
    id: `${id}-share`,
    type: 'input',
    content: '',
    inputType: 'number',
    requiredWhenEnabled: true,
    enabledWhen: { kind: 'option', values: ['us', 'jp'], controllerCellId: country.id },
  };
  return { id, label: id, cells: [country, share] };
}

function tableQuestion(rows: TableRow[]): Question {
  return {
    id: 'q1',
    type: 'table',
    title: '표',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'c1', label: '국가' },
      { id: 'c2', label: '비중' },
    ],
    tableRowsData: rows,
    stagedRowsConfig: config,
  } as Question;
}

function requiredCellIds(question: Question, response: Record<string, unknown>): string[] {
  return collectNumericIssues(question, response, undefined)
    .filter((issue) => issue.kind === 'required-cells')
    .flatMap((issue) => issue.cellIds ?? [])
    .sort();
}

describe('행 차례로 열기 — 필수 판정 범위', () => {
  const plain = tableQuestion([
    { id: 's1', label: '1', cells: [requiredInput('a1')] },
    { id: 's2', label: '2', cells: [requiredInput('a2')] },
    { id: 's3', label: '3', cells: [requiredInput('a3')] },
    { id: 's4', label: '4', cells: [requiredInput('a4')] },
  ]);

  it('처음 보이는 행만 채우면 통과한다 — 뒤 행의 필수 칸은 비어 있어도 된다', () => {
    expect(requiredCellIds(plain, { a1: '가', a2: '나' })).toEqual([]);
  });

  it('처음 보이는 행의 필수 칸이 비면 막는다', () => {
    expect(requiredCellIds(plain, { a1: '가' })).toEqual(['a2']);
  });

  it('값이 있는 마지막 행까지는 평범한 행이다 — 사이의 빈 필수 칸이 막는다', () => {
    expect(requiredCellIds(plain, { a1: '가', a2: '나', a4: '라' })).toEqual(['a3']);
  });

  const gated = tableQuestion([
    countryRow('s1', true),
    countryRow('s2', false),
    countryRow('s3', false),
    countryRow('s4', false),
  ]);

  it('뒤 행에서 국가만 고르고 비중을 비우면 그 칸이 막는다', () => {
    const response = { 's1-country': 'us', 's1-share': '60', 's4-country': 'jp' };
    expect(requiredCellIds(gated, response)).toEqual(['s4-share']);
  });

  it('뒤 행을 비워 두면 통과한다', () => {
    expect(requiredCellIds(gated, { 's1-country': 'us', 's1-share': '100' })).toEqual([]);
  });

  it('저장된 계산 칸 값이 닫힌 행을 필수로 만들지 않는다 — 저장 전후 판정이 같다', () => {
    // 저장 경계는 계산 칸 값을 응답에 주입한다(빈 행도 '0'). 그 값 때문에 재진입 때 닫힌 행이
    // 열린 것으로 판정되면, 처음 보이는 행만 채운 응답이 「다음」에서 막힌다.
    const withCalc = tableQuestion(
      ['s1', 's2', 's3', 's4'].map((id) => ({
        id,
        label: id,
        cells: [requiredInput(`${id}-in`), { id: `${id}-calc`, type: 'calc', content: '' } as TableCell],
      })),
    );
    const beforeSave = { 's1-in': '1', 's2-in': '2' };
    const afterSave = {
      ...beforeSave,
      's1-calc': '1',
      's2-calc': '2',
      's3-calc': '0',
      's4-calc': '0',
    };
    expect(requiredCellIds(withCalc, beforeSave)).toEqual([]);
    expect(requiredCellIds(withCalc, afterSave)).toEqual([]);
  });

  it('구조가 깨진 설정은 필수 범위를 줄이지 않는다 — 전부 보이는 표와 같이 검사한다', () => {
    // 묶음 행 하나가 표에서 사라진 설정. 응답 화면은 이런 설정을 동작시키지 않고 전부 보이므로
    // 검증도 뒤 행을 빼 주지 않는다(보이는데 필수가 안 걸리는 칸을 만들지 않는다).
    const broken = {
      ...plain,
      stagedRowsConfig: { ...config, rowIds: ['s1', 's2', 'gone', 's4'] },
    } as Question;
    expect(requiredCellIds(broken, { a1: '가', a2: '나' })).toEqual(['a3', 'a4']);
  });
});
