import { describe, expect, it } from 'vitest';

import { expandRepeatRows } from '@/lib/question/row-repeat';
import type { Question, RowRepeatConfig, SurveySubmission, TableRow } from '@/types/survey';

import { collectUsedRepeatCounts } from './row-repeat-usage';
import { generateSPSSColumns } from './spss-excel-export';

/**
 * 뒤쪽 미사용 벌 pruning — 구조에는 20벌이 박혀 있어도 아무도 채우지 않은 벌의 열은
 * 내지 않는다. 앞 열의 이름과 순서는 사용 벌 수와 무관하게 같아야 한다 (설계 결정 2).
 */

const config: RowRepeatConfig = { enabled: true, templateRowIds: ['tpl'], maxRepeats: 5 };

function repeatQuestion(): Question {
  const seed: TableRow[] = [
    { id: 'head', label: '머리', rowCode: 'H', cells: [{ id: 'h1', type: 'input', content: '' }] },
    { id: 'tpl', label: '성과', rowCode: 'P', cells: [{ id: 't1', type: 'input', content: '' }] },
  ] as TableRow[];
  let n = 0;
  return {
    id: 'q1',
    type: 'table',
    title: '성과 표',
    required: false,
    order: 0,
    questionCode: 'QA1',
    tableColumns: [{ id: 'c1', label: '내용', columnCode: 'c1' }],
    tableRowsData: expandRepeatRows(seed, config, () => `gen${++n}`),
    rowRepeatConfig: config,
  } as Question;
}

const question = repeatQuestion();

function cellIdOfBundle(index: number): string {
  return question.tableRowsData!.find((r) => r.repeatIndex === index)!.cells[0]!.id;
}

function submission(responses: Record<string, unknown>): SurveySubmission {
  return { id: 's', questionResponses: { q1: responses } } as unknown as SurveySubmission;
}

function varNames(used?: Map<string, number>): string[] {
  return generateSPSSColumns([question], used ? { usedRepeatCounts: used } : undefined).map(
    (c) => c.spssVarName,
  );
}

describe('collectUsedRepeatCounts', () => {
  it('아무도 채우지 않았으면 1벌', () => {
    expect(collectUsedRepeatCounts([question], []).get('q1')).toBe(1);
  });

  it('설문 전체에서 값이 들어 있는 최대 벌을 센다', () => {
    const subs = [
      submission({ [cellIdOfBundle(1)]: '가' }),
      submission({ [cellIdOfBundle(3)]: '다' }),
    ];
    expect(collectUsedRepeatCounts([question], subs).get('q1')).toBe(3);
  });

  it('빈 문자열은 쓰인 것으로 치지 않는다', () => {
    const subs = [submission({ [cellIdOfBundle(4)]: '   ' })];
    expect(collectUsedRepeatCounts([question], subs).get('q1')).toBe(1);
  });

  it('반복 블록이 없는 질문은 담지 않는다', () => {
    const plain = { id: 'q2', type: 'table', title: '', order: 0, required: false } as Question;
    expect(collectUsedRepeatCounts([plain], []).has('q2')).toBe(false);
  });
});

describe('generateSPSSColumns — 뒤쪽 미사용 벌 제외', () => {
  it('옵션이 없으면 구조에 있는 벌을 전부 낸다', () => {
    expect(varNames()).toEqual([
      'QA1_H_c1',
      'QA1_P_01_c1',
      'QA1_P_02_c1',
      'QA1_P_03_c1',
      'QA1_P_04_c1',
      'QA1_P_05_c1',
    ]);
  });

  it('3벌까지 쓰였으면 r04·r05 를 내지 않는다', () => {
    expect(varNames(new Map([['q1', 3]]))).toEqual([
      'QA1_H_c1',
      'QA1_P_01_c1',
      'QA1_P_02_c1',
      'QA1_P_03_c1',
    ]);
  });

  it('나중에 5벌이 쓰이면 뒤에 붙기만 하고 앞 열은 그대로다', () => {
    const three = varNames(new Map([['q1', 3]]));
    const five = varNames(new Map([['q1', 5]]));
    expect(five.slice(0, three.length)).toEqual(three);
    expect(five.slice(three.length)).toEqual(['QA1_P_04_c1', 'QA1_P_05_c1']);
  });

  it('아무도 채우지 않아도 1벌은 항상 낸다', () => {
    expect(varNames(new Map([['q1', 0]]))).toEqual(['QA1_H_c1', 'QA1_P_01_c1']);
  });

  it('비반복 행의 변수명은 pruning 과 무관하게 같다', () => {
    expect(varNames(new Map([['q1', 1]]))[0]).toBe(varNames()[0]);
  });
});
