import { describe, expect, it } from 'vitest';

import { collectUsedRepeatCounts } from '@/lib/analytics/row-repeat-usage';
import { collectUnusedColumnIds } from '@/lib/analytics/unused-column-usage';
import {
  deriveOpenRepeatCount,
  expandRepeatRows,
  startedRepeatBundles,
} from '@/lib/question/row-repeat';
import { type FormulaEvalCtx, withCalcValues } from '@/lib/survey/cell-formula';
import type { Question, RowRepeatConfig, TableRow } from '@/types/survey';

import { hasRespondentValue } from './table-cell-semantics';

/**
 * 「쓴 벌·쓴 열·행」은 응답 칸의 값으로만 센다 — 계산 칸 값은 저장 경계(`withCalcValues`)가 모든 계산 칸에 넣는다.
 * 빈 벌의 합계도 "0" 으로 저장돼, 계산 칸 값을 세던 시절에는 다시 들어오면 최대 벌까지 저절로 열리고(화면·차단 검증),
 * 내보내기의 안 쓴 벌·열·행이 빠지지 않았다(2026-11-06 발견). 그래서 여기서는 저장 경계 함수로 실제 저장 모양을 만든다.
 */

const config: RowRepeatConfig = { enabled: true, templateRowIds: ['tpl'], maxRepeats: 5 };

function repeatTable(): Question {
  let n = 0;
  const rows: TableRow[] = expandRepeatRows(
    [
      {
        id: 'fixed',
        label: '기준',
        cells: [{ id: 'base', content: '', type: 'input', inputType: 'number' }],
      },
      {
        id: 'tpl',
        label: '품목',
        cells: [
          { id: 'a', content: '', type: 'input', inputType: 'number' },
          { id: 'b', content: '', type: 'input', inputType: 'number' },
          // 벌마다 합계 — 빈 벌에도 "0" 이 저장된다
          {
            id: 'tot',
            content: '',
            type: 'calc',
            formula: {
              kind: 'agg',
              fn: 'sum',
              items: [
                { kind: 'cell', cellId: 'a' },
                { kind: 'cell', cellId: 'b' },
              ],
            },
          } as TableRow['cells'][number],
        ],
      },
    ],
    config,
    () => `g${++n}`,
  );
  return {
    id: 'q1',
    type: 'table',
    title: '표',
    required: false,
    order: 1,
    tableColumns: [
      { id: 'c1', label: 'a' },
      { id: 'c2', label: 'b' },
      { id: 'c3', label: '합계', exportOmitIfUnused: true },
    ],
    tableRowsData: rows,
    rowRepeatConfig: config,
  } as Question;
}

/** 1벌만 적은 응답이 저장 경계를 지난 모양 */
function storedAfterSave(q: Question): Record<string, unknown> {
  const answers = { q1: { base: '5', a: '3' } };
  const ctx: FormulaEvalCtx = { questions: [q], responses: answers, lookups: [], contactAttrs: {} };
  return (withCalcValues(answers, ctx) as Record<string, Record<string, unknown>>)['q1']!;
}

describe('hasRespondentValue', () => {
  it('응답 칸의 값만 센다 — 계산·글자 칸 값은 세지 않는다', () => {
    const values = { i: '1', c: '0', t: '설명', e: '  ' };
    expect(hasRespondentValue({ id: 'i', type: 'input', content: '' }, values)).toBe(true);
    expect(hasRespondentValue({ id: 'c', type: 'calc', content: '' }, values)).toBe(false);
    expect(hasRespondentValue({ id: 't', type: 'text', content: '' }, values)).toBe(false);
    expect(hasRespondentValue({ id: 'e', type: 'input', content: '' }, values)).toBe(false);
  });
});

describe('저장된 계산 칸 값은 벌을 열지 않는다', () => {
  it('저장 경계가 빈 벌의 계산 칸에도 값을 넣는다 — 이 테스트의 전제', () => {
    const q = repeatTable();
    const stored = storedAfterSave(q);
    const bundle2Total = q.tableRowsData!.find((r) => r.repeatIndex === 2)!.cells[2]!.id;
    expect(stored[bundle2Total]).toBe('0');
  });

  it('다시 들어와도 1벌만 열린다 — 응답 화면·차단 검증이 쓰는 판정', () => {
    const q = repeatTable();
    expect(deriveOpenRepeatCount(q.tableRowsData!, storedAfterSave(q), 1)).toBe(1);
  });

  it('적기 시작한 벌도 계산 칸 값으로는 생기지 않는다', () => {
    const q = repeatTable();
    expect([...startedRepeatBundles(q.tableRowsData!, storedAfterSave(q))]).toEqual([]);
  });
});

describe('내보내기의 안 쓴 벌·열 빼기는 계산 칸 값을 쓴 것으로 치지 않는다', () => {
  it('쓰인 벌은 1벌이다', () => {
    const q = repeatTable();
    expect(
      collectUsedRepeatCounts([q], [{ questionResponses: { q1: storedAfterSave(q) } }]).get('q1'),
    ).toBe(1);
  });

  it('계산 칸뿐인 「안 쓰면 뺀다」 열은 빠진다', () => {
    const q = repeatTable();
    const unused = collectUnusedColumnIds([q], [{ questionResponses: { q1: storedAfterSave(q) } }]);
    expect([...(unused.get('q1') ?? [])]).toEqual(['c3']);
  });
});
