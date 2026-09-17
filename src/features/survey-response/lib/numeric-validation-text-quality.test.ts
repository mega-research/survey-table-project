import { describe, expect, it } from 'vitest';

import type { Question, TableCell } from '@/types/survey';

import { collectNumericIssues } from './numeric-validation';

function q(type: 'text' | 'textarea', overrides: Partial<Question> = {}): Question {
  return { id: 'q1', type, title: '의견', required: false, order: 0, ...overrides } as Question;
}

describe('collectNumericIssues — 응답 품질 검사', () => {
  it('최소 글자 수 미달이면 text-quality 이슈가 난다 — 단답형·장문형 모두', () => {
    for (const type of ['text', 'textarea'] as const) {
      const issues = collectNumericIssues(q(type, { textValidation: { minLength: 10 } }), '짧다');
      expect(issues).toHaveLength(1);
      expect(issues[0]?.kind).toBe('text-quality');
      expect(issues[0]?.message).toBe('10자 이상 입력해 주세요. (현재 2자, 공백 제외)');
    }
  });

  it('의미 없는 입력 거부가 켜지면 ㅋㅋㅋ·숫자만인 값을 막고 내용이 있으면 통과한다', () => {
    const question = q('textarea', { textValidation: { rejectMeaningless: true } });
    expect(collectNumericIssues(question, 'ㅋㅋㅋ')[0]?.kind).toBe('text-quality');
    expect(collectNumericIssues(question, '123124')[0]?.kind).toBe('text-quality');
    expect(collectNumericIssues(question, '특별한 의견 없음')).toEqual([]);
  });

  it('설정이 없거나 빈 값이면 막지 않는다 — 미입력 차단은 필수 판정 소관', () => {
    expect(collectNumericIssues(q('textarea'), 'ㅋㅋㅋ')).toEqual([]);
    expect(collectNumericIssues(q('textarea', { textValidation: { minLength: 10 } }), '')).toEqual(
      [],
    );
    expect(
      collectNumericIssues(q('textarea', { textValidation: { minLength: 10 } }), undefined),
    ).toEqual([]);
  });

  it('숫자 모드·입력 형식 단답형은 품질 검사를 타지 않는다 — 배타', () => {
    const numeric = q('text', { inputType: 'number', textValidation: { minLength: 10 } });
    expect(collectNumericIssues(numeric, '5')).toEqual([]);
    const mobile = q('text', { inputType: 'mobile', textValidation: { minLength: 20 } });
    expect(collectNumericIssues(mobile, '010-1234-5678')).toEqual([]);
  });

  it('토큰 prefill 단답형은 대상이 아니다 — 응답자가 못 고치는 칸', () => {
    const prefilled = q('text', {
      defaultValueTemplate: '{{company}}',
      textValidation: { minLength: 10 },
    });
    expect(collectNumericIssues(prefilled, '메가')).toEqual([]);
  });
});

describe('collectNumericIssues — 응답 품질 검사의 이월 값 면제', () => {
  it('손대지 않은 지난 회차 값은 막지 않고, 고친 값은 다시 본다 — 형식 검사와 같은 면제', () => {
    const question = q('textarea', { textValidation: { minLength: 10, rejectMeaningless: true } });
    const ctx = { allResponses: {}, allQuestions: [], priorAnswers: { q1: 'ㅋㅋ' } };
    expect(collectNumericIssues(question, 'ㅋㅋ', ctx)).toEqual([]);
    expect(collectNumericIssues(question, 'ㅋㅋㅋ', ctx)[0]?.kind).toBe('text-quality');
  });
});

describe('collectNumericIssues — 표 input 셀 응답 품질', () => {
  function tableQuestion(cells: Array<Partial<TableCell> & { id: string }>): Question {
    return {
      id: 'qt',
      type: 'table',
      title: '표',
      required: false,
      order: 0,
      tableRowsData: [
        { id: 'r1', cells: cells.map((c) => ({ type: 'input', content: '', ...c })) },
      ],
    } as Question;
  }

  it('조건에 안 맞는 셀을 한 이슈에 모아 짚는다 — 사유 문구는 셀 아래가 맡는다', () => {
    const q = tableQuestion([
      { id: 'c1', textValidation: { minLength: 5 } },
      { id: 'c2', textValidation: { rejectMeaningless: true } },
      { id: 'c3' },
    ]);
    const issues = collectNumericIssues(q, { c1: '짧다', c2: 'ㅋㅋ', c3: 'ㅋㅋ' });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('text-quality');
    expect(issues[0]?.cellIds).toEqual(['c1', 'c2']);
    expect(collectNumericIssues(q, { c1: '충분히 긴 답', c2: '없음', c3: 'ㅋㅋ' })).toEqual([]);
  });

  it('숫자·형식 모드 셀은 대상이 아니고, 빈 셀도 막지 않는다', () => {
    const q = tableQuestion([
      { id: 'n', inputType: 'number', textValidation: { minLength: 5 } },
      { id: 'm', inputType: 'mobile', textValidation: { minLength: 20 } },
      { id: 'p', textValidation: { minLength: 5 } },
    ]);
    expect(collectNumericIssues(q, { n: '1', m: '010-1234-5678', p: '' })).toEqual([]);
  });
});

describe('collectNumericIssues — 보기 소스 표 input 셀 응답 품질', () => {
  const question = {
    id: 'qc',
    type: 'radio',
    title: '기타',
    required: false,
    order: 0,
    choiceGroups: [{ id: 'g', groupKey: 'rad1', type: 'radio', label: '보기' }],
    tableColumns: [
      { id: 'c1', label: '보기' },
      { id: 'c2', label: '상세' },
    ],
    tableRowsData: [
      {
        id: 'r1',
        cells: [
          { id: 'r1c1', type: 'choice_opt', content: '기타', choiceGroupId: 'g' },
          {
            id: 'r1c2',
            type: 'input',
            content: '',
            textValidation: { minLength: 5, rejectMeaningless: true },
          },
        ],
      },
    ],
  } as unknown as Question;

  it('사이드카 값이 조건에 안 맞으면 상세 타깃을 짚는 text-quality 이슈가 난다', () => {
    const ctx = { allResponses: {}, allQuestions: [question], optionTexts: { r1c2: 'ㅎㅎ' } };
    const issues = collectNumericIssues(question, { rad1: 'r1c1' }, ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('text-quality');
    expect(issues[0]?.detailTargetIds?.[0]).toContain('r1c2');
    const ok = { ...ctx, optionTexts: { r1c2: '자세한 사유 기재' } };
    expect(collectNumericIssues(question, { rad1: 'r1c1' }, ok)).toEqual([]);
  });
});
