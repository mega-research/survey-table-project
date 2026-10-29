import { describe, expect, it } from 'vitest';

import type { Question, SumConstraint, TableCell, TableRow } from '@/types/survey';

import {
  collectUnfilledChoiceGroupIssues,
  resolveGroupedRequiredMessage,
} from './answer-validation';
import { type NumericValidationCtx, collectNumericIssues } from './numeric-validation';

/**
 * 차단 검증 문구의 현재 언어 (CONTEXT.md 「다국어 설문」) — 시스템이 만드는 문구는 고른 언어를
 * 따르고, 저작자 문구(필수 안내·합계 제약 문구)는 번역하지 않는다. 언어를 주지 않은 경우의
 * 한국어 문구는 기존 검증 테스트들이 지킨다.
 */

const cell = (id: string, over: Partial<TableCell> = {}): TableCell =>
  ({ id, type: 'input', content: '', inputType: 'number', ...over }) as TableCell;

function tableQuestion(cells: TableCell[], over: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'table',
    title: '표',
    required: false,
    order: 0,
    tableRowsData: cells.map((c, i) => ({ id: `r${i}`, label: '', cells: [c] })) as TableRow[],
    ...over,
  } as Question;
}

function ctxFor(question: Question, response: unknown): NumericValidationCtx {
  return { allResponses: { [question.id]: response }, allQuestions: [question] };
}

const messagesOf = (question: Question, response: unknown, locale: 'zh' | 'en') =>
  collectNumericIssues(question, response, ctxFor(question, response), locale).map(
    (issue) => issue.message,
  );

describe('collectNumericIssues — 현재 언어', () => {
  it('비어 있는 필수 칸은 고른 언어로 알린다', () => {
    const q = tableQuestion([cell('a'), cell('b', { required: true })]);
    expect(messagesOf(q, { a: '1' }, 'zh')).toEqual(['有必填项未填写']);
    expect(messagesOf(q, { a: '1' }, 'en')).toEqual(['A required field is empty']);
  });

  it('범위를 벗어난 칸 · 형식이 맞지 않은 칸 묶음 문구', () => {
    const q = tableQuestion([
      cell('a', { numberFormat: { min: 10 } }),
      cell('b', { inputType: 'email' }),
    ]);
    expect(messagesOf(q, { a: '5', b: 'abc' }, 'zh')).toEqual([
      '有单元格的数值超出允许范围',
      '有单元格的输入格式不正确',
    ]);
  });

  it('단답형 형식 위반은 사유 문구가 고른 언어다', () => {
    const q = {
      id: 'mail',
      type: 'text',
      title: '이메일',
      required: true,
      order: 0,
      inputType: 'email',
    } as Question;
    expect(messagesOf(q, 'abc', 'en')).toEqual(['This is not a valid email address']);
    expect(messagesOf(q, 'abc', 'zh')).toEqual(['电子邮箱格式不正确']);
  });

  it('단답형 숫자 범위 위반', () => {
    const q = {
      id: 'n',
      type: 'text',
      title: '숫자',
      required: false,
      order: 0,
      inputType: 'number',
      numberFormat: { max: 100 },
    } as Question;
    expect(messagesOf(q, '500', 'en')).toEqual(['Please enter 100 or less']);
  });

  const sumRule: SumConstraint = { id: 's1', cellIds: ['a', 'b'], operator: 'lte', target: 10 };

  it('합계 제약 기본 문구는 고른 언어다', () => {
    const q = tableQuestion([cell('a'), cell('b')], { sumConstraints: [sumRule] });
    expect(messagesOf(q, { a: '6', b: '7' }, 'zh')).toEqual([
      '所选单元格合计应小于或等于10（当前 13）',
    ]);
    expect(messagesOf(q, { a: '6', b: '7' }, 'en')).toEqual([
      'The total of the selected cells must be at most 10 (current: 13)',
    ]);
  });

  it('저작자 합계 문구는 번역하지 않고 자리표시자만 채운다', () => {
    const q = tableQuestion([cell('a'), cell('b')], {
      sumConstraints: [{ ...sumRule, errorMessage: '总咨询数不能超过 {기준값}（现 {현재값}）' }],
    });
    expect(messagesOf(q, { a: '6', b: '7' }, 'en')).toEqual(['总咨询数不能超过 10（现 13）']);
  });

  it('입력된 칸 수 기본 문구', () => {
    const q = tableQuestion([cell('a'), cell('b')], {
      sumConstraints: [{ ...sumRule, aggregate: 'count', operator: 'gte', target: 1 }],
    });
    expect(messagesOf(q, {}, 'en')).toEqual([
      'Of the selected fields, at least 1 must be filled in (currently 0)',
    ]);
  });

  it('필수 문항에서 고른 「기타」의 상세 기재가 비면 고른 언어로 알린다', () => {
    const q = {
      id: 'support',
      type: 'checkbox',
      title: '지원 부문',
      required: true,
      order: 0,
      options: [
        { id: 'o1', value: '1', label: '홍보' },
        { id: 'o8', value: '8', label: '기타', allowTextInput: true },
      ],
    } as Question;
    const issues = collectNumericIssues(
      q,
      ['8'],
      { ...ctxFor(q, ['8']), optionTexts: { o8: '' } },
      'zh',
    );
    expect(issues.map((issue) => issue.message)).toEqual(['有必填项未填写']);
  });

  it('최대 선택 개수 초과', () => {
    const q = {
      id: 'b3',
      type: 'checkbox',
      title: 'B3',
      required: false,
      order: 1,
      options: [
        { id: 'o1', label: '1', value: '1' },
        { id: 'o2', label: '2', value: '2' },
      ],
      maxSelectionsSource: { questionId: 'b2', unlimitedFrom: 5 },
    } as Question;
    const issues = collectNumericIssues(
      q,
      ['1', '2'],
      { allResponses: { b2: '1', b3: ['1', '2'] }, allQuestions: [q] },
      'zh',
    );
    expect(issues.map((issue) => issue.message)).toEqual(['最多可选择1项。（当前已选2项）']);
  });
});

describe('필수 안내 문구 — 현재 언어', () => {
  const plain = { id: 'p', type: 'text', title: '성명', required: true, order: 0 } as Question;

  it('기본 문구는 고른 언어, 저작자 문구는 그대로다', () => {
    expect(resolveGroupedRequiredMessage(plain, undefined, {}, 'en')).toBe(
      'Please answer this required question.',
    );
    expect(
      resolveGroupedRequiredMessage(
        { ...plain, requiredMessage: '请填写姓名' },
        undefined,
        {},
        'en',
      ),
    ).toBe('请填写姓名');
  });

  it('보기 그룹 미충족 안내도 기본 문구가 고른 언어다', () => {
    const grouped = {
      id: 'qg',
      type: 'radio',
      title: '그룹 라디오',
      required: true,
      order: 0,
      tableColumns: [{ id: 'c1', label: '열' }],
      tableRowsData: [
        {
          id: 'r1',
          label: '',
          cells: [{ id: 'cellA', type: 'choice_opt', content: '', choiceGroupId: 'grp1' }],
        },
      ],
      choiceGroups: [{ id: 'grp1', type: 'radio', groupKey: 'rad1', label: '그룹1' }],
    } as unknown as Question;
    expect(collectUnfilledChoiceGroupIssues(grouped, {}, {}, 'zh')).toEqual([
      { message: '请回答此必答题。', cellIds: ['cellA'] },
    ]);
  });
});
