import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import { splitHeaderBlocks, suggestBlockMapping } from './prior-answer-blocks';
import {
  buildPriorAnswerRecords,
  normalizeMatchValue,
  normalizeQuestionCode,
} from './prior-answer-import';

function q(overrides: Record<string, unknown>): Question {
  return {
    id: 'q1',
    title: '문항',
    required: false,
    order: 1,
    type: 'text',
    ...overrides,
  } as unknown as Question;
}

const textQuestion = q({ id: 'q-text', questionCode: 'BQ1_1', title: '창업 기업명' });
const choiceQuestion = q({
  id: 'q-choice',
  questionCode: 'BQ2',
  type: 'radio',
  title: '창업 여부',
  options: [
    { id: 'o1', value: 'yes', label: '예, 창업했습니다' },
    { id: 'o2', value: 'no', label: '아니오' },
  ],
});
const questions = [textQuestion, choiceQuestion];

/** 헤더 한 줄짜리 단순 rawdata — [시스템ID, BQ1-1., BQ2] */
const HEADER_ROWS = [['ID', 'BQ1-1.', 'BQ2']];

function assignmentsFor(headerRows: string[][] = HEADER_ROWS) {
  return suggestBlockMapping(splitHeaderBlocks(headerRows), questions)
    .filter((s) => s.questionId !== null)
    .map((s) => ({ block: s.block, questionId: s.questionId as string, slots: s.slots }));
}

function build(rows: string[][], headerRows: string[][] = HEADER_ROWS) {
  return buildPriorAnswerRecords({
    rows,
    matchColumnIndex: 0,
    assignments: assignmentsFor(headerRows),
    questions,
  });
}

describe('normalizeQuestionCode', () => {
  it('후행 마침표를 없앤다', () => {
    expect(normalizeQuestionCode('BQ1_1.')).toBe(normalizeQuestionCode('BQ1_1'));
  });

  it('대시를 밑줄로 본다', () => {
    expect(normalizeQuestionCode('BQ1-1')).toBe(normalizeQuestionCode('BQ1_1'));
  });

  it('대소문자를 무시한다', () => {
    expect(normalizeQuestionCode('bq1_1')).toBe(normalizeQuestionCode('BQ1_1'));
  });

  it('설문지 표기 BQ1-1. 이 문항코드 BQ1_1 과 같아진다', () => {
    expect(normalizeQuestionCode('BQ1-1.')).toBe(normalizeQuestionCode('BQ1_1'));
  });

  it('빈 값과 공백만 있는 값은 빈 코드다 — 아무것과도 매칭되지 않는다', () => {
    expect(normalizeQuestionCode('   ')).toBe('');
    expect(normalizeQuestionCode('')).toBe('');
  });
});

describe('normalizeMatchValue', () => {
  it('앞뒤 공백만 턴다', () => {
    expect(normalizeMatchValue(' 7 ')).toBe('7');
    expect(normalizeMatchValue('A-7')).toBe('A-7');
  });

  it('앞 0 을 접지 않는다 — 앞 0 이 의미 있는 식별자를 남의 대상에 붙이지 않는다', () => {
    expect(normalizeMatchValue('007')).toBe('007');
  });
});

describe('buildPriorAnswerRecords', () => {
  it('대조값별로 문항 값 묶음을 만든다', () => {
    const result = build([['101', '메가리서치', '예, 창업했습니다']]);
    expect(result.records).toEqual([
      { matchValue: '101', answers: { 'q-text': '메가리서치', 'q-choice': 'yes' } },
    ]);
  });

  it('엑셀의 라벨 텍스트가 선택지 저장값으로 변환된다', () => {
    expect(build([['1', '', '아니오']]).records[0]?.answers['q-choice']).toBe('no');
  });

  it('선택지 라벨 대조는 앞뒤 공백과 대소문자를 무시한다', () => {
    expect(build([['1', '', '  아니오  ']]).records[0]?.answers['q-choice']).toBe('no');
  });

  it('선택지에 없는 값은 그 문항만 비우고 경고로 남긴다', () => {
    const result = build([
      ['1', '메가리서치', '다소 그렇다'],
      ['2', '', '다소 그렇다'],
      ['3', '', '아니오'],
    ]);
    expect(result.records[0]?.answers).toEqual({ 'q-text': '메가리서치' });
    expect(result.optionMismatches).toEqual([
      {
        questionId: 'q-choice',
        total: 3,
        unmatched: 2,
        rate: 2 / 3,
        values: [{ value: '다소 그렇다', count: 2 }],
      },
    ]);
  });

  it('빈 셀은 값을 만들지 않는다 — 빈칸으로 덮어쓰지 않는다', () => {
    expect(build([['1', '', '   ']]).records).toEqual([]);
  });

  it('대조값이 비면 그 행을 버리고 세어둔다', () => {
    const result = build([['', '메가리서치', '']]);
    expect(result.records).toEqual([]);
    expect(result.emptyMatchRows).toBe(1);
  });

  it('같은 대조값이 두 번 나오면 양쪽 다 빼고 그 값을 보고한다', () => {
    // 어느 행이 맞는지 고르는 규칙이 없다. 잘못 붙은 이월 응답은 응답 화면에서 남의
    // 지난 답으로 보이므로 모호하면 붙이지 않는다.
    const result = build([
      ['1', '먼저', ''],
      ['1', '나중', ''],
    ]);
    expect(result.records).toEqual([]);
    expect(result.duplicateMatchValues).toEqual(['1']);
  });

  it('앞 0 이 붙은 값은 다른 대조값이다 — 접어서 억지로 모으지 않는다', () => {
    const result = build([
      ['07', '먼저', ''],
      ['7', '나중', ''],
    ]);
    expect(result.records).toEqual([
      { matchValue: '07', answers: { 'q-text': '먼저' } },
      { matchValue: '7', answers: { 'q-text': '나중' } },
    ]);
    expect(result.duplicateMatchValues).toEqual([]);
  });

  it('숫자가 아닌 대조값도 그대로 쓴다', () => {
    expect(build([['A-7', '메가리서치', '']]).records).toEqual([
      { matchValue: 'A-7', answers: { 'q-text': '메가리서치' } },
    ]);
  });

  it('값이 비어 있는 중복 행도 모호함을 만들어 그 대조값을 통째로 뺀다', () => {
    // 두 번째 행에 값이 없다고 해서 첫 행이 옳다는 근거가 되지는 않는다.
    const result = build([
      ['1', '메가리서치', ''],
      ['1', '', ''],
    ]);
    expect(result.records).toEqual([]);
    expect(result.duplicateMatchValues).toEqual(['1']);
  });

  it('매핑되지 않은 컬럼은 값에 실리지 않는다', () => {
    // 헤더에 코드가 없는 열은 블록이 되지 않아 배정 자체가 만들어지지 않는다.
    const result = build([['1', '메가리서치', '', '무언가']], [['ID', 'BQ1-1.', 'BQ2', '비고']]);
    expect(result.records[0]?.answers).toEqual({ 'q-text': '메가리서치' });
  });

  it('값을 만들 자리가 하나도 없는 배정은 건너뛰고 알린다', () => {
    const result = buildPriorAnswerRecords({
      rows: [['1', '아무거나']],
      matchColumnIndex: 0,
      assignments: [
        {
          block: {
            codeText: 'BQ2',
            code: 'BQ2',
            label: '',
            labelSource: 'none',
            columnIndexes: [1],
            part: '',
            detailLabels: [''],
          },
          questionId: 'q-choice',
          slots: [{ kind: 'unmatched' }],
        },
      ],
      questions,
    });
    expect(result.records).toEqual([]);
    expect(result.unsupportedQuestionIds).toEqual(['q-choice']);
  });
});
