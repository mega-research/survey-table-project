import { describe, expect, it } from 'vitest';

import type { Question, TableCell, TableRow } from '@/types/survey';

import { collectNumericIssues } from './numeric-validation';

function textQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'text',
    title: '연락처',
    required: false,
    order: 0,
    ...overrides,
  } as Question;
}

describe('collectNumericIssues — 입력 형식', () => {
  it('형식이 맞으면 이슈가 없다', () => {
    const q = textQuestion({ inputType: 'mobile' });
    expect(collectNumericIssues(q, '010-1234-5678')).toEqual([]);
    expect(collectNumericIssues(q, '01012345678')).toEqual([]);
  });

  it('형식이 틀리면 kind format 이슈가 나오고 사유별 문구가 실린다', () => {
    const issues = collectNumericIssues(textQuestion({ inputType: 'mobile' }), '02-1234-5678');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('format');
    expect(issues[0]?.message).toBe('휴대전화 번호가 아닙니다');

    const bizIssues = collectNumericIssues(
      textQuestion({ inputType: 'biz_number' }),
      '111-11-11111',
    );
    expect(bizIssues[0]?.message).toBe('사업자번호 확인번호가 맞지 않습니다. 다시 확인해 주세요');
  });

  it('빈 값은 형식 검사 대상이 아니다 — 미입력 차단은 필수 판정 소관', () => {
    const q = textQuestion({ inputType: 'email', required: true });
    expect(collectNumericIssues(q, '')).toEqual([]);
    expect(collectNumericIssues(q, '   ')).toEqual([]);
    expect(collectNumericIssues(q, undefined)).toEqual([]);
  });

  it('형식을 지정하지 않은 단답형은 어떤 값도 막지 않는다', () => {
    expect(collectNumericIssues(textQuestion(), '아무 말')).toEqual([]);
    expect(collectNumericIssues(textQuestion({ inputType: 'text' }), '010-1')).toEqual([]);
  });

  it('숫자 모드는 형식 검사를 타지 않는다 — 범위 검증 그대로', () => {
    const q = textQuestion({ inputType: 'number', numberFormat: { min: 10 } });
    expect(collectNumericIssues(q, '5')[0]?.kind).toBe('range');
    expect(collectNumericIssues(q, '50')).toEqual([]);
  });
});

function tableQuestion(cells: Array<Partial<TableCell> & { id: string }>): Question {
  const rows: TableRow[] = [
    {
      id: 'r1',
      cells: cells.map((c) => ({ type: 'input', content: '', ...c })),
    },
  ] as TableRow[];
  return {
    id: 'qt',
    type: 'table',
    title: '표',
    required: false,
    order: 0,
    tableRowsData: rows,
  } as Question;
}

describe('collectNumericIssues — 표 input 셀 형식', () => {
  const q = tableQuestion([
    { id: 'c1', inputType: 'mobile' },
    { id: 'c2', inputType: 'email' },
    { id: 'c3' },
  ]);

  it('형식이 맞으면 이슈가 없다', () => {
    expect(collectNumericIssues(q, { c1: '010-1234-5678', c2: 'a@b.com', c3: '아무 말' })).toEqual(
      [],
    );
  });

  it('형식이 틀린 셀을 짚어낸다', () => {
    const issues = collectNumericIssues(q, { c1: '02-1234-5678', c2: 'a@b.com' });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('format');
    expect(issues[0]?.cellIds).toEqual(['c1']);
  });

  it('여러 셀이 틀리면 한 이슈에 모아 짚는다', () => {
    const issues = collectNumericIssues(q, { c1: '02-1234-5678', c2: '이메일아님' });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.cellIds).toEqual(['c1', 'c2']);
  });

  it('빈 셀과 형식 미지정 셀은 검사하지 않는다', () => {
    expect(collectNumericIssues(q, { c1: '', c2: '   ', c3: '010-1' })).toEqual([]);
  });

  it('숨은 셀·미선택 동적 행의 잔존값은 막지 않는다', () => {
    const hidden = tableQuestion([{ id: 'c1', inputType: 'mobile', isHidden: true }]);
    expect(collectNumericIssues(hidden, { c1: '틀린값' })).toEqual([]);
  });
});

describe('collectNumericIssues — 보기 상세기재 형식', () => {
  const question = {
    id: 'qc',
    type: 'checkbox',
    title: '연락 수단',
    required: false,
    order: 0,
    options: [
      { id: 'o1', label: '휴대전화', value: '1', allowTextInput: true, textInputType: 'mobile' },
      { id: 'o2', label: '이메일', value: '2', allowTextInput: true, textInputType: 'email' },
      { id: 'o3', label: '기타', value: '3', allowTextInput: true },
    ],
  } as unknown as Question;

  const ctxWith = (optionTexts: Record<string, string>) => ({
    allResponses: {},
    allQuestions: [question],
    optionTexts,
  });

  it('선택한 보기의 상세기재가 형식에 맞으면 이슈가 없다', () => {
    const issues = collectNumericIssues(question, ['1'], ctxWith({ o1: '010-1234-5678' }));
    expect(issues).toEqual([]);
  });

  it('선택한 보기의 상세기재가 형식에 어긋나면 막는다', () => {
    const issues = collectNumericIssues(question, ['1'], ctxWith({ o1: '02-1234-5678' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('format');
    expect(issues[0]?.message).toBe('휴대전화 번호가 아닙니다');
    expect(issues[0]?.detailTargetIds).toEqual(['qc:option:o1']);
  });

  it('선택하지 않은 보기의 잔존 텍스트는 보지 않는다', () => {
    expect(collectNumericIssues(question, ['3'], ctxWith({ o1: '02-1234-5678' }))).toEqual([]);
  });

  it('형식을 지정하지 않은 상세기재는 아무 값이나 받는다', () => {
    expect(collectNumericIssues(question, ['3'], ctxWith({ o3: '아무 말' }))).toEqual([]);
  });
});

describe('collectNumericIssues — 보기-소스 표 안의 input 셀 형식', () => {
  const question = {
    id: 'qs',
    type: 'radio',
    title: '보기 표',
    required: false,
    order: 0,
    tableRowsData: [
      {
        id: 'r1',
        cells: [
          { id: 'src', type: 'choice_opt', content: '보기' },
          { id: 'tel', type: 'input', content: '', inputType: 'phone' },
        ],
      },
    ],
  } as unknown as Question;

  const ctxWith = (optionTexts: Record<string, string>) => ({
    allResponses: {},
    allQuestions: [question],
    optionTexts,
  });

  it('형식이 맞으면 이슈가 없다', () => {
    expect(collectNumericIssues(question, 'src', ctxWith({ tel: '02-123-4567' }))).toEqual([]);
  });

  it('형식이 어긋나면 그 칸을 짚어 막는다', () => {
    const issues = collectNumericIssues(question, 'src', ctxWith({ tel: '1544-1234' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('format');
    expect(issues[0]?.detailTargetIds).toEqual(['qs:option:tel']);
  });

  it('빈 칸은 검사하지 않는다', () => {
    expect(collectNumericIssues(question, 'src', ctxWith({ tel: '' }))).toEqual([]);
  });
});

describe('collectNumericIssues — 이월 프리필 면제', () => {
  const prior = {
    q1: '02-1234-5678',
    qt: { c1: '1544-1234' },
    __optTexts__: { qc: { o1: 'nobody@nowhere' } },
  };

  it('단답형: 이월 원본과 글자 그대로 같으면 검사하지 않는다', () => {
    const q = textQuestion({ inputType: 'mobile' });
    expect(
      collectNumericIssues(q, '02-1234-5678', {
        allResponses: {},
        allQuestions: [q],
        priorAnswers: prior,
      }),
    ).toEqual([]);
  });

  it('단답형: 한 글자라도 고치면 그때부터 검사한다', () => {
    const q = textQuestion({ inputType: 'mobile' });
    const issues = collectNumericIssues(q, '02-1234-5679', {
      allResponses: {},
      allQuestions: [q],
      priorAnswers: prior,
    });
    expect(issues[0]?.kind).toBe('format');
  });

  it('표 셀: 셀 단위로 각자 판정한다', () => {
    const q = { ...tableQuestion([{ id: 'c1', inputType: 'phone' }]), id: 'qt' } as Question;
    expect(
      collectNumericIssues(
        q,
        { c1: '1544-1234' },
        {
          allResponses: {},
          allQuestions: [q],
          priorAnswers: prior,
        },
      ),
    ).toEqual([]);
    expect(
      collectNumericIssues(
        q,
        { c1: '1544-12345' },
        {
          allResponses: {},
          allQuestions: [q],
          priorAnswers: prior,
        },
      )[0]?.kind,
    ).toBe('format');
  });

  it('상세기재: 사이드카 값도 각자 판정한다', () => {
    const q = {
      id: 'qc',
      type: 'checkbox',
      title: '연락 수단',
      required: false,
      order: 0,
      options: [
        { id: 'o1', label: '이메일', value: '1', allowTextInput: true, textInputType: 'email' },
      ],
    } as unknown as Question;
    expect(
      collectNumericIssues(q, ['1'], {
        allResponses: {},
        allQuestions: [q],
        optionTexts: { o1: 'nobody@nowhere' },
        priorAnswers: prior,
      }),
    ).toEqual([]);
    expect(
      collectNumericIssues(q, ['1'], {
        allResponses: {},
        allQuestions: [q],
        optionTexts: { o1: 'nobody@nowhere.' },
        priorAnswers: prior,
      })[0]?.kind,
    ).toBe('format');
  });

  it('이월 응답이 없으면 종전대로 전부 검사한다', () => {
    const q = textQuestion({ inputType: 'mobile' });
    expect(collectNumericIssues(q, '02-1234-5678')[0]?.kind).toBe('format');
  });
});
