import { describe, expect, it } from 'vitest';

import type { Question, TableRow } from '@/types/survey';

import { generateSPSSColumns } from './spss-excel-export';
import { collectUnusedColumnIds, omittableColumnQuestionIds } from './unused-column-usage';

/**
 * 안 쓴 열 빼기 — 「기타 원료 1~3」처럼 넉넉히 만들어 둔 열 중 응답 전체에서 아무도 채우지 않은
 * 열은 내보내기에서 뺀다. 표시한 열만 대상이고, 판정은 설문 전체 기준이다.
 */
const input = (id: string) => ({ id, type: 'input' as const, content: '' });
const rows: TableRow[] = [
  { id: 'r1', label: '국내산', rowCode: 'r01', cells: [input('a1'), input('o1'), input('p1')] },
  { id: 'r2', label: '수입산', rowCode: 'r02', cells: [input('a2'), input('o2'), input('p2')] },
] as TableRow[];
const q = {
  id: 'q1',
  type: 'table',
  title: '원료',
  required: false,
  order: 0,
  questionCode: 'Q1',
  tableColumns: [
    { id: 'ca', label: '원유', columnCode: 'c01' },
    { id: 'co', label: '기타1', columnCode: 'c02', exportOmitIfUnused: true },
    { id: 'cp', label: '기타2', columnCode: 'c03', exportOmitIfUnused: true },
  ],
  tableRowsData: rows,
} as Question;
const plain = { ...q, id: 'q2', questionCode: 'Q2', tableColumns: q.tableColumns!.map(({ exportOmitIfUnused: _, ...c }) => c) } as Question;
const sub = (answers: Record<string, unknown>) => ({ questionResponses: { q1: answers } });

describe('collectUnusedColumnIds', () => {
  it('표시한 열만 본다 — 아무도 안 쓴 표시 열이 담긴다', () => {
    expect(collectUnusedColumnIds([q], [sub({ a1: '10' })]).get('q1')).toEqual(new Set(['co', 'cp']));
  });

  it('어느 행 · 어느 응답이든 한 칸이라도 값이 있으면 쓴 열이다', () => {
    const used = collectUnusedColumnIds([q], [sub({ a1: '1' }), sub({ o2: '연유' })]);
    expect(used.get('q1')).toEqual(new Set(['cp']));
  });

  it('빈 문자열 · 공백은 쓴 것으로 치지 않는다', () => {
    expect(collectUnusedColumnIds([q], [sub({ o1: '  ', p2: '' })]).get('q1')).toEqual(new Set(['co', 'cp']));
  });

  it('표시 열을 다 썼거나 표시한 열이 없는 문항은 담지 않는다', () => {
    expect(collectUnusedColumnIds([q], [sub({ o1: 'x', p1: '1' })]).has('q1')).toBe(false);
    expect(collectUnusedColumnIds([plain], []).has('q2')).toBe(false);
  });

  it('스캔 대상 문항은 표시 열이 있는 표뿐이다', () => {
    expect(omittableColumnQuestionIds([q, plain])).toEqual(['q1']);
  });
});

describe('generateSPSSColumns — unusedColumnIds', () => {
  const names = (unused?: Map<string, Set<string>>) =>
    generateSPSSColumns([q], unused ? { unusedColumnIds: unused } : undefined).map((c) => c.spssVarName);

  it('판정이 없으면 전 열을 낸다(발행 게이트는 최악의 집합을 본다)', () => {
    expect(names()).toEqual(['Q1_r01_c01', 'Q1_r01_c02', 'Q1_r01_c03', 'Q1_r02_c01', 'Q1_r02_c02', 'Q1_r02_c03']);
  });

  it('안 쓴 표시 열만 빠지고 남은 열의 이름은 그대로다', () => {
    expect(names(new Map([['q1', new Set(['co'])]]))).toEqual(['Q1_r01_c01', 'Q1_r01_c03', 'Q1_r02_c01', 'Q1_r02_c03']);
  });
});

/**
 * 안 쓴 행 빼기 (2026-11-06) — 열과 같은 판정을 행에도. 유가공업 문2 수입 원료 고정 줄 「기타1~10」처럼
 * 조건으로 나타나는 줄을 넉넉히 만들어 둔 경우. 행 반복 벌의 미사용 벌 빼기와는 별개다.
 */
describe('안 쓴 행 빼기 — TableRow.exportOmitIfUnused', () => {
  const rowQ = {
    ...plain,
    id: 'q3',
    questionCode: 'Q3',
    tableRowsData: [
      { id: 'r1', label: '원유', rowCode: 'r01', cells: [input('a1'), input('o1'), input('p1')] },
      { id: 'r2', label: '기타1', rowCode: 'r02', exportOmitIfUnused: true, cells: [input('a2'), input('o2'), input('p2')] },
      { id: 'r3', label: '기타2', rowCode: 'r03', exportOmitIfUnused: true, cells: [input('a3'), input('o3'), input('p3')] },
    ],
  } as Question;
  const sub3 = (answers: Record<string, unknown>) => ({ questionResponses: { q3: answers } });

  it('아무도 안 쓴 표시 행이 담기고, 한 칸이라도 쓴 행은 빠진다', () => {
    expect(collectUnusedColumnIds([rowQ], [sub3({ a1: '1' })]).get('q3')).toEqual(new Set(['r2', 'r3']));
    expect(collectUnusedColumnIds([rowQ], [sub3({ a1: '1' }), sub3({ p2: '5' })]).get('q3')).toEqual(new Set(['r3']));
  });

  it('스캔 대상에 표시 행이 있는 표도 들어간다', () => {
    expect(omittableColumnQuestionIds([rowQ, plain])).toEqual(['q3']);
  });

  it('안 쓴 행의 변수만 빠지고 남은 변수 이름은 그대로다', () => {
    const vars = generateSPSSColumns([rowQ], { unusedColumnIds: new Map([['q3', new Set(['r2'])]]) }).map((c) => c.spssVarName);
    expect(vars).toEqual(['Q3_r01_c01', 'Q3_r01_c02', 'Q3_r01_c03', 'Q3_r03_c01', 'Q3_r03_c02', 'Q3_r03_c03']);
  });
});
