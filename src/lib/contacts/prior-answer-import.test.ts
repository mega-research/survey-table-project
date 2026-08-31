import { describe, expect, it } from 'vitest';

import {
  buildPriorAnswerRecords,
  normalizeQuestionCode,
  normalizeResid,
} from './prior-answer-import';
import { splitHeaderBlocks, suggestBlockMapping } from './prior-answer-blocks';
import type { Question } from '@/types/survey';

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
    residColumnIndex: 0,
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

describe('normalizeResid', () => {
  it('앞 0 을 없애 07 과 7 을 같은 대상으로 만든다', () => {
    expect(normalizeResid('07')).toBe('7');
    expect(normalizeResid(' 7 ')).toBe('7');
  });

  it('정수가 아니면 원래 문자열 그대로 둔다', () => {
    expect(normalizeResid('A-7')).toBe('A-7');
  });
});

describe('buildPriorAnswerRecords', () => {
  it('조사 대상 번호별로 문항 값 묶음을 만든다', () => {
    const result = build([['101', '메가리서치', '예, 창업했습니다']]);
    expect(result.records).toEqual([
      { resid: '101', answers: { 'q-text': '메가리서치', 'q-choice': 'yes' } },
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

  it('조사 대상 번호가 비면 그 행을 버리고 세어둔다', () => {
    const result = build([['', '메가리서치', '']]);
    expect(result.records).toEqual([]);
    expect(result.emptyResidRows).toBe(1);
  });

  it('같은 번호가 두 번 나오면 뒤 행이 앞 행을 덮는다', () => {
    const result = build([
      ['1', '먼저', ''],
      ['1', '나중', ''],
    ]);
    expect(result.records).toEqual([{ resid: '1', answers: { 'q-text': '나중' } }]);
    expect(result.duplicateResidRows).toBe(1);
  });

  it('앞뒤 0 이 붙은 같은 번호는 한 대상으로 모은다', () => {
    // 접지 않으면 적재가 같은 대상을 한 배치에 두 번 실어 통째로 실패한다.
    const result = build([
      ['07', '먼저', ''],
      ['7', '나중', ''],
    ]);
    expect(result.records).toEqual([{ resid: '7', answers: { 'q-text': '나중' } }]);
    expect(result.duplicateResidRows).toBe(1);
  });

  it('정수가 아닌 번호는 원래 문자열 그대로 남긴다', () => {
    expect(build([['A-7', '메가리서치', '']]).records).toEqual([
      { resid: 'A-7', answers: { 'q-text': '메가리서치' } },
    ]);
  });

  it('값이 하나도 살아남지 않은 행이 같은 번호의 앞 행을 지우지 않는다', () => {
    const result = build([
      ['1', '메가리서치', ''],
      ['1', '', ''],
    ]);
    expect(result.records).toEqual([{ resid: '1', answers: { 'q-text': '메가리서치' } }]);
  });

  it('매핑되지 않은 컬럼은 값에 실리지 않는다', () => {
    // 헤더에 코드가 없는 열은 블록이 되지 않아 배정 자체가 만들어지지 않는다.
    const result = build([['1', '메가리서치', '', '무언가']], [['ID', 'BQ1-1.', 'BQ2', '비고']]);
    expect(result.records[0]?.answers).toEqual({ 'q-text': '메가리서치' });
  });

  it('값을 만들 자리가 하나도 없는 배정은 건너뛰고 알린다', () => {
    const result = buildPriorAnswerRecords({
      rows: [['1', '아무거나']],
      residColumnIndex: 0,
      assignments: [
        {
          block: {
            codeText: 'BQ2',
            code: 'BQ2',
            label: '',
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
