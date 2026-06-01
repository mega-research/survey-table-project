import { describe, expect, it } from 'vitest';

import type { SurveyResponse } from '@/db/schema';
import { analyzeQuestion } from '@/lib/analytics/analyzer';
import type { Question } from '@/types/survey';
// dispatcher: branch-logic.ts 에서 callers 가 쓰는 공개 함수
import { getBranchRuleForResponse } from '@/utils/branch-logic';
import { transformSingleChoice } from '@/lib/spss/data-transformer';
import { generateMrsets } from '@/lib/spss/spss-syntax-generator';

function choiceTableQ(): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: 'Q',
    required: false,
    order: 0,
    tableColumns: [{ id: 'c1', label: '선택' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          {
            id: 'cellA',
            type: 'choice_opt',
            content: '',
            choiceLabel: 'A',
            branchRule: { id: 'b1', value: 'cellA', action: 'end' },
          },
        ],
      },
    ],
  } as Question;
}

describe('choice table-source 분기', () => {
  it('선택된 choice_opt 셀의 branchRule 을 평가한다', () => {
    const q = choiceTableQ();
    const rule = getBranchRuleForResponse(q, 'cellA'); // 응답값 = 선택된 셀 id
    expect(rule?.action).toBe('end');
  });
});

// 테이블 소스 checkbox: 응답값은 일반 checkbox 와 동일한 cell.id 문자열 배열.
// 집계는 resolveChoiceOptions(question) 로 옵션을 풀어 cell.id 별 분포를 만든다.
function choiceTableCheckboxQ(): Question {
  return {
    id: 'q1',
    type: 'checkbox',
    title: 'Q',
    required: false,
    order: 0,
    tableColumns: [{ id: 'c1', label: '선택' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'cellA', type: 'choice_opt', content: '', choiceLabel: 'A' },
        ],
      },
      {
        id: 'r2',
        label: '',
        cells: [
          { id: 'cellB', type: 'choice_opt', content: '', choiceLabel: 'B' },
        ],
      },
    ],
  } as Question;
}

// analyzeQuestion 은 SurveyResponse[] 를 받아 r.questionResponses[question.id] 를 읽는다.
// 테스트에 필요한 필드만 채우고 나머지는 캐스팅으로 생략한다.
function responseFixture(id: string, value: string[]): SurveyResponse {
  return {
    id,
    questionResponses: { q1: value },
    completedAt: new Date(),
  } as unknown as SurveyResponse;
}

describe('choice table-source checkbox 집계', () => {
  it('cell.id 별 분포를 정확히 카운트한다', () => {
    const q = choiceTableCheckboxQ();
    const responses: SurveyResponse[] = [
      responseFixture('resp1', ['cellA', 'cellB']), // 응답자 1
      responseFixture('resp2', ['cellA']), // 응답자 2
    ];

    const result = analyzeQuestion(q, responses);
    expect(result.type).toBe('multiple');
    if (result.type !== 'multiple') throw new Error('checkbox 는 multiple 분석이어야 한다');

    const a = result.distribution.find((d) => d.value === 'cellA');
    const b = result.distribution.find((d) => d.value === 'cellB');

    expect(a?.count).toBe(2);
    expect(b?.count).toBe(1);
  });
});

describe('choice table-source SPSS 단일/복수 변수 계약', () => {
  function radioTableQ(): Question {
    return {
      id: 'q1',
      type: 'radio',
      title: 'Q',
      required: false,
      order: 0,
      questionCode: 'Q2',
      options: [],
      tableColumns: [{ id: 'c1', label: '선택' }],
      tableRowsData: [
        { id: 'r1', label: '', cells: [{ id: 'cellA', type: 'choice_opt', content: '', choiceLabel: 'A' }] },
        { id: 'r2', label: '', cells: [{ id: 'cellB', type: 'choice_opt', content: '', choiceLabel: 'B' }] },
        { id: 'r3', label: '', cells: [{ id: 'cellC', type: 'choice_opt', content: '', choiceLabel: 'C' }] },
      ],
    } as Question;
  }

  it('라디오는 단일 변수 Q2 에 선택한 보기 코드 하나, 미선택은 null', () => {
    const q = radioTableQ();
    // 선택값 = cell.id. 기본 코드 = 수집 순서 1-based.
    expect(transformSingleChoice(q, 'cellA')).toBe(1);
    expect(transformSingleChoice(q, 'cellC')).toBe(3);
    expect(transformSingleChoice(q, null)).toBeNull();
  });

  it('라디오는 MCGROUP(복수응답 세트)에 등록되지 않는다', () => {
    expect(generateMrsets([radioTableQ()])).toBe('');
  });
});
