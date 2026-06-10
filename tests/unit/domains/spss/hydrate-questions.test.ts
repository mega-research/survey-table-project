import { describe, expect, it } from 'vitest';

import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';
import type { Question } from '@/types/survey';

describe('hydrateQuestionsForSpss', () => {
  it('테이블 질문의 cellCode를 복원한다', () => {
    const question = {
      id: 'q1',
      type: 'table',
      title: '표',
      required: false,
      order: 1,
      questionCode: 'T1',
      tableColumns: [{ id: 'c1', label: '열1', columnCode: 'c1' }],
      tableRowsData: [
        { id: 'r1', label: '행1', rowCode: 'r1', cells: [{ id: 'cell1', content: '', type: 'input' }] },
      ],
    } as unknown as Question;

    const [hydrated] = hydrateQuestionsForSpss([question]);
    const cell = hydrated!.tableRowsData?.[0]?.cells[0];
    expect(cell?.cellCode).toBeTruthy();
  });

  it('radio 질문의 optionCode를 복원한다', () => {
    const question = {
      id: 'q2',
      type: 'radio',
      title: '질문',
      required: false,
      order: 1,
      questionCode: 'Q1',
      options: [{ id: 'o1', label: '보기1', value: 'o1' }],
    } as unknown as Question;

    const [hydrated] = hydrateQuestionsForSpss([question]);
    expect(hydrated!.options?.[0]?.optionCode).toBeTruthy();
  });

  it('원본 배열을 변형하지 않는다', () => {
    const question = {
      id: 'q3', type: 'text', title: 't', required: false, order: 1, questionCode: 'Q3',
    } as unknown as Question;
    const input = [question];
    const out = hydrateQuestionsForSpss(input);
    expect(out).not.toBe(input);
  });
});
