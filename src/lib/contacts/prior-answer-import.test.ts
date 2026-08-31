import { describe, expect, it } from 'vitest';

import {
  buildPriorAnswerRecords,
  normalizeQuestionCode,
  suggestPriorAnswerMapping,
} from './prior-answer-import';
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
const checkboxQuestion = q({
  id: 'q-multi',
  questionCode: 'BQ3',
  type: 'checkbox',
  title: '지원받은 분야',
  options: [{ id: 'c1', value: 'a', label: '자금' }],
});
/** 표(choice_opt 셀)에서 보기를 가져오는 라디오 — 저장값은 cell.id 다. */
const tableChoiceQuestion = q({
  id: 'q-table-choice',
  questionCode: 'BQ4',
  type: 'radio',
  title: '표 소스 라디오',
  tableColumns: [{ id: 'col1', label: '선택' }],
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      cells: [{ id: 'cell-yes', type: 'choice_opt', content: '예' }],
    },
  ],
});

/** 한 표 안에 보기 그룹이 여러 개 — 저장형이 { groupKey: cellId } 객체다. */
const groupedChoiceQuestion = q({
  id: 'q-grouped',
  questionCode: 'BQ5',
  type: 'radio',
  title: '그룹 라디오',
  choiceGroups: [{ id: 'g1', groupKey: 'rad1', type: 'radio', label: '그룹1' }],
  tableColumns: [{ id: 'col1', label: '선택' }],
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      cells: [{ id: 'cell-a', type: 'choice_opt', content: '가', choiceGroupId: 'g1' }],
    },
  ],
});

const questions = [
  textQuestion,
  choiceQuestion,
  checkboxQuestion,
  tableChoiceQuestion,
  groupedChoiceQuestion,
];

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

describe('suggestPriorAnswerMapping', () => {
  it('문항코드가 정규화 대조로 맞으면 자동 제안한다', () => {
    const suggestions = suggestPriorAnswerMapping(['BQ1-1.', 'bq2'], questions);
    expect(suggestions).toEqual([
      { columnKey: 'BQ1-1.', questionId: 'q-text', matchedBy: 'code' },
      { columnKey: 'bq2', questionId: 'q-choice', matchedBy: 'code' },
    ]);
  });

  it('맞는 문항이 없는 컬럼은 미매핑으로 남는다', () => {
    expect(suggestPriorAnswerMapping(['알수없는열'], questions)).toEqual([
      { columnKey: '알수없는열', questionId: null, matchedBy: null },
    ]);
  });

  it('여러 컬럼을 먹는 문항은 이 경로에서 제안하지 않는다', () => {
    // 복수응답은 펼침 컬럼이라 한 컬럼으로 값을 정할 수 없다 — 05 의 컬럼 블록 소관.
    expect(suggestPriorAnswerMapping(['BQ3'], questions)).toEqual([
      { columnKey: 'BQ3', questionId: null, matchedBy: null },
    ]);
  });

  it('코드와 라벨이 한 칸에 든 헤더도 선두 코드로 맞춘다', () => {
    // 실무 rawdata 헤더는 "BQ1-1. 창업 기업명" 처럼 코드와 문항 라벨이 붙어 있다.
    const suggestions = suggestPriorAnswerMapping(['BQ1-1. 창업 기업명'], questions);
    expect(suggestions[0]?.questionId).toBe('q-text');
  });

  it('보기 그룹이 있는 표 소스 문항은 제안하지 않는다', () => {
    // 저장형이 { groupKey: cellId } 객체라 한 컬럼 값으로 만들 수 없다.
    expect(suggestPriorAnswerMapping(['BQ5'], questions)).toEqual([
      { columnKey: 'BQ5', questionId: null, matchedBy: null },
    ]);
  });

  it('빈 문항코드끼리 서로 붙지 않는다', () => {
    const noCode = q({ id: 'q-nocode', title: '코드 없는 문항' });
    expect(suggestPriorAnswerMapping(['_col_3'], [noCode])).toEqual([
      { columnKey: '_col_3', questionId: null, matchedBy: null },
    ]);
  });

  it('한 문항에 두 컬럼이 걸리면 첫 컬럼만 가져간다', () => {
    const suggestions = suggestPriorAnswerMapping(['BQ2', 'BQ2.'], questions);
    expect(suggestions.map((s) => s.questionId)).toEqual(['q-choice', null]);
  });
});

describe('buildPriorAnswerRecords', () => {
  const base = {
    residColumnKey: 'ID',
    mapping: { 'BQ1-1.': 'q-text', BQ2: 'q-choice' },
    questions,
  };

  it('조사 대상 번호별로 문항 값 묶음을 만든다', () => {
    const result = buildPriorAnswerRecords({
      ...base,
      rows: [{ ID: '101', 'BQ1-1.': '메가리서치', BQ2: '예, 창업했습니다' }],
    });
    expect(result.records).toEqual([
      { resid: '101', answers: { 'q-text': '메가리서치', 'q-choice': 'yes' } },
    ]);
  });

  it('엑셀의 라벨 텍스트가 선택지 저장값으로 변환된다', () => {
    const result = buildPriorAnswerRecords({
      ...base,
      rows: [{ ID: '1', BQ2: '아니오' }],
    });
    expect(result.records[0]?.answers['q-choice']).toBe('no');
  });

  it('선택지 라벨 대조는 앞뒤 공백과 대소문자를 무시한다', () => {
    const result = buildPriorAnswerRecords({
      ...base,
      rows: [{ ID: '1', BQ2: '  아니오  ' }],
    });
    expect(result.records[0]?.answers['q-choice']).toBe('no');
  });

  it('선택지에 없는 값은 그 문항만 비우고 경고로 남긴다', () => {
    const result = buildPriorAnswerRecords({
      ...base,
      rows: [
        { ID: '1', 'BQ1-1.': '메가리서치', BQ2: '다소 그렇다' },
        { ID: '2', BQ2: '다소 그렇다' },
        { ID: '3', BQ2: '아니오' },
      ],
    });
    // 다른 문항 값은 살아 있다 — 그 문항만 비운다.
    expect(result.records[0]?.answers).toEqual({ 'q-text': '메가리서치' });
    expect(result.optionMismatches).toEqual([
      {
        questionId: 'q-choice',
        total: 3,
        unmatched: 2,
        values: [{ value: '다소 그렇다', count: 2 }],
      },
    ]);
  });

  it('빈 셀은 값을 만들지 않는다 — 빈칸으로 덮어쓰지 않는다', () => {
    const result = buildPriorAnswerRecords({
      ...base,
      rows: [{ ID: '1', 'BQ1-1.': '', BQ2: '   ' }],
    });
    expect(result.records).toEqual([]);
  });

  it('조사 대상 번호가 비면 그 행을 버리고 세어둔다', () => {
    const result = buildPriorAnswerRecords({
      ...base,
      rows: [{ ID: '', 'BQ1-1.': '메가리서치' }],
    });
    expect(result.records).toEqual([]);
    expect(result.emptyResidRows).toBe(1);
  });

  it('같은 번호가 두 번 나오면 뒤 행이 앞 행을 덮는다', () => {
    const result = buildPriorAnswerRecords({
      ...base,
      rows: [
        { ID: '1', 'BQ1-1.': '먼저' },
        { ID: '1', 'BQ1-1.': '나중' },
      ],
    });
    expect(result.records).toEqual([{ resid: '1', answers: { 'q-text': '나중' } }]);
    expect(result.duplicateResidRows).toBe(1);
  });

  it('표 소스 라디오는 셀 id 로 저장된다', () => {
    const result = buildPriorAnswerRecords({
      ...base,
      mapping: { BQ4: 'q-table-choice' },
      rows: [{ ID: '1', BQ4: '예' }],
    });
    expect(result.records[0]?.answers['q-table-choice']).toBe('cell-yes');
  });

  it('값이 하나도 살아남지 않은 행이 같은 번호의 앞 행을 지우지 않는다', () => {
    const result = buildPriorAnswerRecords({
      ...base,
      rows: [
        { ID: '1', 'BQ1-1.': '메가리서치' },
        { ID: '1', 'BQ1-1.': '' },
      ],
    });
    expect(result.records).toEqual([{ resid: '1', answers: { 'q-text': '메가리서치' } }]);
  });

  it('앞뒤 0 이 붙은 같은 번호는 한 대상으로 모은다', () => {
    // 조사 대상 번호는 정수라 "07" 과 "7" 이 같은 대상이다. 따로 두면 적재가
    // 같은 대상을 한 배치에 두 번 실어 통째로 실패한다.
    const result = buildPriorAnswerRecords({
      ...base,
      rows: [
        { ID: '07', 'BQ1-1.': '먼저' },
        { ID: '7', 'BQ1-1.': '나중' },
      ],
    });
    expect(result.records).toEqual([{ resid: '7', answers: { 'q-text': '나중' } }]);
    expect(result.duplicateResidRows).toBe(1);
  });

  it('정수가 아닌 번호는 원래 문자열 그대로 남긴다', () => {
    const result = buildPriorAnswerRecords({
      ...base,
      rows: [{ ID: 'A-7', 'BQ1-1.': '메가리서치' }],
    });
    expect(result.records).toEqual([{ resid: 'A-7', answers: { 'q-text': '메가리서치' } }]);
  });

  it('매핑되지 않은 컬럼은 값에 실리지 않는다', () => {
    const result = buildPriorAnswerRecords({
      ...base,
      rows: [{ ID: '1', 'BQ1-1.': '메가리서치', 알수없는열: '무언가' }],
    });
    expect(result.records[0]?.answers).toEqual({ 'q-text': '메가리서치' });
  });

  it('여러 컬럼을 먹는 문항으로 매핑되면 값을 만들지 않고 경고한다', () => {
    const result = buildPriorAnswerRecords({
      ...base,
      mapping: { BQ3: 'q-multi' },
      rows: [{ ID: '1', BQ3: '자금' }],
    });
    expect(result.records).toEqual([]);
    expect(result.unsupportedQuestionIds).toEqual(['q-multi']);
  });
});
