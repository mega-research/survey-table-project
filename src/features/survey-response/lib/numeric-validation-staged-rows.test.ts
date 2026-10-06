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
});
