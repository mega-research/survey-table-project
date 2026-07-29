import { describe, expect, it } from 'vitest';

import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import type { QuestionVariant } from '@/lib/question';
import type { Question } from '@/types/survey';

function makeTableQ(exportCellOrder?: 'row-first' | 'column-first'): Question {
  return {
    id: 'qt',
    type: 'table',
    title: 'Q3. 장르별 리텐션',
    order: 1,
    required: false,
    questionCode: 'Q3',
    exportCellOrder,
    tableColumns: [
      { id: 'c1', label: '방치형', columnCode: 'idle' },
      { id: 'c2', label: '액션', columnCode: 'action' },
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: 'D+1',
        rowCode: 'd1',
        cells: [
          { id: 'x11', type: 'input', content: '', cellCode: 'Q3_idle_d1' },
          { id: 'x12', type: 'input', content: '', cellCode: 'Q3_action_d1' },
        ],
      },
      {
        id: 'r2',
        label: 'D+7',
        rowCode: 'd7',
        cells: [
          { id: 'x21', type: 'input', content: '', cellCode: 'Q3_idle_d7' },
          { id: 'x22', type: 'input', content: '', cellCode: 'Q3_action_d7' },
        ],
      },
    ],
  } as unknown as Question;
}

function varNames(q: Question): string[] {
  return generateSPSSColumns([q] as unknown as QuestionVariant[]).map((c) => c.spssVarName);
}

describe('테이블 문항 내보내기 셀 순서', () => {
  it('기본(미설정)은 행 우선 — 행 고정 후 열 순회', () => {
    expect(varNames(makeTableQ())).toEqual([
      'Q3_idle_d1',
      'Q3_action_d1',
      'Q3_idle_d7',
      'Q3_action_d7',
    ]);
  });

  it('row-first 명시도 행 우선과 동일', () => {
    expect(varNames(makeTableQ('row-first'))).toEqual([
      'Q3_idle_d1',
      'Q3_action_d1',
      'Q3_idle_d7',
      'Q3_action_d7',
    ]);
  });

  it('column-first는 열 고정 후 행 순회', () => {
    expect(varNames(makeTableQ('column-first'))).toEqual([
      'Q3_idle_d1',
      'Q3_idle_d7',
      'Q3_action_d1',
      'Q3_action_d7',
    ]);
  });
});
