import { describe, expect, it } from 'vitest';

import { collectNumericIssues } from '@/lib/survey/numeric-validation';
import type { Question } from '@/types/survey';

/**
 * 보기-소스 표 안의 단답형 셀에 대한 차단형 검증.
 *
 * 값이 __optTexts__ 사이드카(셀 id 키)에 있어 표 문항 경로(cellValues)를 타지 않는다.
 * 행 표시조건으로 숨은 행의 셀은 보지 않는다 — 화면에 없는 칸이 "다음"을 막으면
 * 응답자가 따를 수 있는 길이 없다.
 */
const ETC_CELL = 'r1c3';
const DETAIL = 'detail';

function question(opts: { required?: boolean; numeric?: boolean; gated?: boolean } = {}): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: 'AQ1',
    required: true,
    order: 1,
    questionCode: 'AQ1',
    choiceGroups: [{ id: 'gNow', groupKey: 'rad2', type: 'radio', label: '현재' }],
    tableColumns: [
      { id: 'c1', label: '내용' },
      { id: 'c3', label: '현재' },
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'r1c1', type: 'text', content: '① 기타' },
          { id: ETC_CELL, type: 'choice_opt', content: '', choiceGroupId: 'gNow' },
        ],
      },
      {
        id: 'r2',
        label: '',
        ...(opts.gated
          ? {
              displayCondition: {
                logicType: 'AND' as const,
                conditions: [
                  {
                    id: 'c1',
                    name: '조건 1',
                    enabled: true,
                    logicType: 'AND' as const,
                    conditionType: 'value-match' as const,
                    requiredValues: [ETC_CELL],
                    sourceQuestionId: 'q1',
                  },
                ],
              },
            }
          : {}),
        cells: [
          {
            id: DETAIL,
            type: 'input',
            content: '',
            colspan: 2,
            inputType: opts.numeric ? 'number' : 'text',
            ...(opts.numeric ? { numberFormat: { min: 10 } } : {}),
            ...(opts.required ? { required: true } : {}),
          },
        ],
      },
    ],
  } as unknown as Question;
}

function issues(q: Question, response: unknown, optionTexts: Record<string, string>) {
  return collectNumericIssues(q, response, {
    allResponses: { q1: response },
    allQuestions: [q],
    optionTexts,
  });
}

describe('보기-소스 표 단답형 셀 검증', () => {
  it('필수 셀이 비면 차단한다', () => {
    const found = issues(question({ required: true }), { rad2: ETC_CELL }, {});
    expect(found.some((i) => i.kind === 'required-detail')).toBe(true);
  });

  it('필수 셀에 값이 있으면 통과한다', () => {
    const found = issues(question({ required: true }), { rad2: ETC_CELL }, { [DETAIL]: '창업 준비' });
    expect(found).toHaveLength(0);
  });

  it('필수가 아니면 비어도 통과한다', () => {
    expect(issues(question(), { rad2: ETC_CELL }, {})).toHaveLength(0);
  });

  it('행이 조건으로 숨겨졌으면 필수여도 막지 않는다', () => {
    const found = issues(question({ required: true, gated: true }), { rad2: 'other' }, {});
    expect(found).toHaveLength(0);
  });

  it('숫자 셀의 최소값 미달은 차단한다', () => {
    const found = issues(question({ numeric: true }), { rad2: ETC_CELL }, { [DETAIL]: '3' });
    expect(found.some((i) => i.kind === 'range')).toBe(true);
  });
});
