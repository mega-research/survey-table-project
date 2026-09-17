import { describe, expect, it } from 'vitest';

import { collectNumericIssues } from '@/features/survey-response/lib/numeric-validation';
import type { Question } from '@/types/survey';

/** 숫자 모드 옵션 텍스트의 min 미달은 "다음" 시점에 차단한다 — 입력 셀과 같은 규칙. */
const question = {
  id: 'q1',
  type: 'radio',
  title: '금액',
  required: false,
  order: 0,
  options: [
    { id: 'o1', value: 'v1', label: '없음' },
    {
      id: 'o2',
      value: 'v2',
      label: '있음 (금액 기재)',
      allowTextInput: true,
      textInputType: 'number',
      textInputNumberFormat: { min: 10 },
    },
  ],
} as unknown as Question;

const baseCtx = { allResponses: {}, allQuestions: [question] };

describe('collectNumericIssues — 옵션 텍스트 숫자 모드', () => {
  it('선택된 옵션의 텍스트가 min 미달이면 range 위반', () => {
    const issues = collectNumericIssues(question, 'v2', { ...baseCtx, optionTexts: { o2: '5' } });
    expect(issues.some((i) => i.kind === 'range')).toBe(true);
  });

  it('min 이상이면 위반 없음', () => {
    const issues = collectNumericIssues(question, 'v2', { ...baseCtx, optionTexts: { o2: '15' } });
    expect(issues.filter((i) => i.kind === 'range')).toEqual([]);
  });

  it('옵션이 선택되지 않았으면 잔존 텍스트가 있어도 검증하지 않는다', () => {
    const issues = collectNumericIssues(question, 'v1', { ...baseCtx, optionTexts: { o2: '5' } });
    expect(issues.filter((i) => i.kind === 'range')).toEqual([]);
  });
});

describe('collectNumericIssues — 보기 그룹 표의 상세기재 숫자 모드', () => {
  const groupedTable = {
    id: 'qt',
    type: 'table',
    title: '금액',
    required: false,
    order: 0,
    choiceGroups: [{ id: 'g1', groupKey: 'rad1', type: 'radio', label: '보유' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'none', content: '없음', type: 'choice_opt', choiceGroupId: 'g1' },
          {
            id: 'has',
            content: '있음 (금액 기재)',
            type: 'choice_opt',
            choiceGroupId: 'g1',
            allowTextInput: true,
            textInputType: 'number',
            textInputNumberFormat: { min: 10 },
          },
        ],
      },
    ],
  } as unknown as Question;
  const ctx = { allResponses: {}, allQuestions: [groupedTable] };

  it('선택된 보기의 텍스트가 min 미달이면 range 위반', () => {
    const issues = collectNumericIssues(
      groupedTable,
      { __choiceGroups: { rad1: 'has' } },
      { ...ctx, optionTexts: { has: '5' } },
    );
    expect(issues.some((i) => i.kind === 'range')).toBe(true);
  });

  it('고르지 않은 보기의 잔존 텍스트는 검증하지 않는다', () => {
    const issues = collectNumericIssues(
      groupedTable,
      { __choiceGroups: { rad1: 'none' } },
      { ...ctx, optionTexts: { has: '5' } },
    );
    expect(issues.filter((i) => i.kind === 'range')).toEqual([]);
  });
});
