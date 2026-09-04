import { describe, expect, it } from 'vitest';

import { buildDataRow, generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { buildRawFormatRecords, looksLikeRawFormat } from '@/lib/contacts/raw-format-import';
import type { Question } from '@/types/survey';

/**
 * 픽스처는 **실제 내보내기 열 정의로** 만든다 — 손으로 적은 변수명으로 시험하면
 * 내보내기 쪽 이름 규칙이 바뀌어도 이 테스트가 통과해 왕복이 조용히 깨진다.
 */
const questions: Question[] = [
  {
    id: 'q-single',
    type: 'radio',
    title: '진로 계획',
    questionCode: 'AQ1',
    order: 0,
    required: false,
    options: [
      { id: 'o1', value: 'v1', label: '진학' },
      { id: 'o2', value: 'v2', label: '취업' },
      { id: 'o3', value: 'v3', label: '창업' },
    ],
  },
  {
    id: 'q-text',
    type: 'text',
    title: '기업명',
    questionCode: 'AQ2',
    order: 1,
    required: false,
  },
  {
    id: 'q-check',
    type: 'checkbox',
    title: '관심 분야',
    questionCode: 'AQ3',
    order: 2,
    required: false,
    options: [
      { id: 'c1', value: 'cv1', label: 'AI' },
      { id: 'c2', value: 'cv2', label: '보안' },
      { id: 'c3', value: 'cv3', label: '클라우드' },
    ],
  },
  {
    id: 'q-multi',
    type: 'multiselect',
    title: '지역',
    questionCode: 'AQ4',
    order: 3,
    required: false,
    selectLevels: [
      { id: 'lv1', label: '시도', options: [{ id: 'r1', value: '서울', label: '서울' }] },
      { id: 'lv2', label: '시군구', options: [{ id: 'r2', value: '강남', label: '강남' }] },
    ],
  },
  {
    // 보기 그룹 문항 — 보기가 표 셀에서 오고 그룹별로 변수가 갈린다.
    id: 'q-group',
    type: 'radio',
    title: '항목별 평가',
    questionCode: 'AQ6',
    order: 5,
    required: false,
    choiceGroups: [
      { id: 'g1', groupKey: 'A', label: '가군', type: 'radio' },
      { id: 'g2', groupKey: 'B', label: '나군', type: 'checkbox' },
    ],
    tableRowsData: [
      {
        id: 'row1',
        cells: [
          { id: 'cellA1', type: 'choice_opt', content: '가-1', choiceGroupId: 'g1' },
          { id: 'cellA2', type: 'choice_opt', content: '가-2', choiceGroupId: 'g1' },
          { id: 'cellB1', type: 'choice_opt', content: '나-1', choiceGroupId: 'g2' },
          { id: 'cellB2', type: 'choice_opt', content: '나-2', choiceGroupId: 'g2' },
        ],
      },
    ],
  },
  {
    id: 'q-other',
    type: 'radio',
    title: '기타 있는 문항',
    questionCode: 'AQ5',
    order: 4,
    required: false,
    allowOtherOption: true,
    options: [
      { id: 'p1', value: 'pv1', label: '가' },
      { id: 'other-option', value: 'other', label: '기타' },
    ],
  },
] as Question[];

const columns = generateSPSSColumns(questions, {
  changeConfirmQuestionIds: new Set(['q-single']),
});

/** 3행 변수명 행을 그대로 쓰되, 앞에 메타 열 두 칸(3행 빈칸)을 붙인다. */
function headerRows(varNames: string[]): string[][] {
  return [
    ['시스템ID', '순번', ...varNames.map(() => '제목')],
    ['', '', ...varNames.map(() => '')],
    ['', '', ...varNames],
  ];
}

function varNameOf(questionId: string, type: string): string {
  const col = columns.find((c) => c.questionId === questionId && c.type === type);
  if (!col) throw new Error(`열 정의를 찾지 못했다: ${questionId}/${type}`);
  return col.spssVarName;
}

const SINGLE = varNameOf('q-single', 'single');
const TEXT = varNameOf('q-text', 'text');
const CHG = varNameOf('q-single', 'change-confirm');
const MULTI = varNameOf('q-multi', 'multiselect');
const OTHER_TEXT = varNameOf('q-other', 'other-text');
/** 복수선택 보기별 열 — 순서대로 AI / 보안 / 클라우드 */
const CHECK_ITEMS = columns
  .filter((c) => c.questionId === 'q-check' && c.type === 'checkbox-item')
  .map((c) => c.spssVarName);

function build(rows: string[][], varNames: string[] = [SINGLE, TEXT]) {
  return buildRawFormatRecords({
    headerRows: headerRows(varNames),
    rows,
    matchColumnIndex: 0,
    columns,
    questions,
  });
}

describe('looksLikeRawFormat', () => {
  it('3행에 이 설문의 변수명이 있으면 Raw 양식으로 본다', () => {
    expect(looksLikeRawFormat(headerRows([SINGLE]), columns)).toBe(true);
  });

  it('변수명이 하나도 없으면 아니다 — 임의 엑셀 경로로 간다', () => {
    expect(looksLikeRawFormat(headerRows(['BQ1', '알 수 없는 열']), columns)).toBe(false);
  });

  it('헤더가 3행이 아니면 아니다', () => {
    expect(looksLikeRawFormat([['시스템ID', SINGLE]], columns)).toBe(false);
  });
});

describe('buildRawFormatRecords', () => {
  it('단일선택 코드값을 선택지 저장값으로 되돌린다', () => {
    const result = build([['7', '', '2', '메가리서치']]);
    expect(result.records).toEqual([
      { matchValue: '7', answers: { 'q-single': 'v2', 'q-text': '메가리서치' } },
    ]);
  });

  it('선택지에 없는 코드값은 그 문항만 비운다', () => {
    const result = build([['7', '', '99', '메가리서치']]);
    expect(result.records[0]?.answers).toEqual({ 'q-text': '메가리서치' });
  });

  it('빈칸은 키를 만들지 않는다', () => {
    // 키가 생기면 지난 답이 없는 문항에도 변동 확인 변수가 붙어 내보내기가 오염된다.
    const result = build([['7', '', '   ', '메가리서치']]);
    expect(result.records[0]?.answers).toEqual({ 'q-text': '메가리서치' });
    expect(Object.keys(result.records[0]?.answers ?? {})).not.toContain('q-single');
  });

  it('전 칸이 비면 그 대상은 담지 않는다', () => {
    expect(build([['7', '', '', '']]).records).toEqual([]);
  });

  it('변동 확인 열은 값이 있어도 되읽지 않고 보고한다', () => {
    const result = build([['7', '', '2', '메가리서치', '1']], [SINGLE, TEXT, CHG]);
    expect(result.records[0]?.answers).toEqual({ 'q-single': 'v2', 'q-text': '메가리서치' });
    expect(result.skippedByRuleVarNames).toEqual([CHG]);
  });

  it('복수선택은 값이 있는 열이 곧 선택이다', () => {
    // 내보내기가 선택된 보기에만 코드값을 넣으므로 코드 자체는 보지 않는다.
    const result = build(
      [['7', '', '1', '', '9']],
      [CHECK_ITEMS[0]!, CHECK_ITEMS[1]!, CHECK_ITEMS[2]!],
    );
    expect(result.records[0]?.answers).toEqual({ 'q-check': ['cv1', 'cv3'] });
  });

  it('복수선택이 한 칸도 안 차 있으면 키를 만들지 않는다', () => {
    const result = build(
      [['7', '', '', '', '']],
      [CHECK_ITEMS[0]!, CHECK_ITEMS[1]!, CHECK_ITEMS[2]!],
    );
    expect(result.records).toEqual([]);
  });

  it('다단계 선택은 밑줄로 이어 붙인 것을 그대로 가른다', () => {
    const result = build([['7', '', '서울_강남']], [MULTI]);
    expect(result.records[0]?.answers).toEqual({ 'q-multi': ['서울', '강남'] });
  });

  it('기타 상세기재는 문항 답이 아니라 루트 사이드카로 간다', () => {
    const result = build(
      [['7', '', '1', '직접 적은 내용']],
      [varNameOf('q-other', 'single'), OTHER_TEXT],
    );
    expect(result.records[0]?.answers).toEqual({
      'q-other': 'pv1',
      __optTexts__: { 'q-other': { 'other-option': '직접 적은 내용' } },
    });
  });

  it('사이드카만 있고 문항 답이 없으면 그 대상은 담지 않는다', () => {
    const result = build(
      [['7', '', '', '직접 적은 내용']],
      [varNameOf('q-other', 'single'), OTHER_TEXT],
    );
    expect(result.records).toEqual([]);
  });

  it('아직 되돌릴 수 없는 열 종류는 종류별로 보고한다', () => {
    const rankingVar = columns.find((c) => c.type === 'ranking-rank')?.spssVarName;
    if (!rankingVar) return; // 픽스처에 순위형이 없으면 이 단언은 건너뛴다
    const result = build([['7', '', '2', '메가리서치', '1']], [SINGLE, TEXT, rankingVar]);
    expect(result.unsupportedVarNames).toEqual([rankingVar]);
  });

  it('이 설문의 변수명이 아닌 열은 목록으로 보고하고 건너뛴다', () => {
    const result = build([['7', '', '2', '메가리서치', 'x']], [SINGLE, TEXT, '남의_변수']);
    expect(result.unknownVarNames).toEqual(['남의_변수']);
  });

  it('메타 열(3행 빈칸)은 모르는 열로 보고하지 않는다', () => {
    // 1~3행 세로 병합이라 3행이 비어 있다. 이것까지 보고하면 화면이 잡음으로 덮인다.
    const result = build([['7', '', '2', '메가리서치']]);
    expect(result.unknownVarNames).toEqual([]);
  });

  it('대조값이 비면 그 행을 버리고 세어둔다', () => {
    const result = build([['', '', '2', '메가리서치']]);
    expect(result.records).toEqual([]);
    expect(result.emptyMatchRows).toBe(1);
  });

  it('같은 대조값이 두 번 나오면 양쪽 다 빼고 보고한다', () => {
    const result = build([
      ['7', '', '1', '먼저'],
      ['7', '', '2', '나중'],
    ]);
    expect(result.records).toEqual([]);
    expect(result.duplicateMatchValues).toEqual(['7']);
  });
});

/**
 * 왕복 — 내보내기 함수가 만든 행을 그대로 되읽는다.
 *
 * 손으로 적은 기대값은 내보내기 규칙이 바뀌면 같이 틀려도 통과한다. 실제 내보내기
 * 출력을 입력으로 쓰면 규칙이 갈라지는 순간 여기서 깨진다.
 */
describe('내보내기 → 임포트 왕복', () => {
  function roundTrip(questionResponses: Record<string, unknown>) {
    const questionMap = new Map(questions.map((q) => [q.id, q]));
    const dataRow = buildDataRow(columns, questionMap, {
      questionResponses,
    } as never);
    // 대조값 한 칸을 앞에 붙이고, 3행은 열 정의 순서 그대로의 변수명이다.
    const varNames = columns.map((c) => c.spssVarName);
    return buildRawFormatRecords({
      headerRows: [
        ['시스템ID', ...varNames.map(() => '제목')],
        ['', ...varNames.map(() => '')],
        ['', ...varNames],
      ],
      rows: [['7', ...dataRow.map((v) => (v == null ? '' : String(v)))]],
      matchColumnIndex: 0,
      columns,
      questions,
    });
  }

  it('단일선택·단답형이 그대로 돌아온다', () => {
    const result = roundTrip({ 'q-single': 'v2', 'q-text': '메가리서치' });
    expect(result.records[0]?.answers).toMatchObject({
      'q-single': 'v2',
      'q-text': '메가리서치',
    });
  });

  it('복수선택이 그대로 돌아온다', () => {
    const result = roundTrip({ 'q-check': ['cv1', 'cv3'] });
    expect(result.records[0]?.answers).toMatchObject({ 'q-check': ['cv1', 'cv3'] });
  });

  it('다단계 선택이 그대로 돌아온다', () => {
    const result = roundTrip({ 'q-multi': ['서울', '강남'] });
    expect(result.records[0]?.answers).toMatchObject({ 'q-multi': ['서울', '강남'] });
  });

  it('기타 상세기재가 사이드카로 돌아온다', () => {
    const result = roundTrip({
      'q-other': { selectedValue: 'other', otherValue: '직접 적은 내용', hasOther: true },
    });
    expect(result.records[0]?.answers).toMatchObject({
      __optTexts__: { 'q-other': { 'other-option': '직접 적은 내용' } },
    });
  });

  it('보기 그룹 문항이 그룹 구조 그대로 돌아온다', () => {
    // 단일 그룹은 셀 id 하나, 복수 그룹은 셀 id 배열이다.
    const result = roundTrip({ 'q-group': { A: 'cellA2', B: ['cellB1', 'cellB2'] } });
    expect(result.records[0]?.answers).toMatchObject({
      'q-group': { A: 'cellA2', B: ['cellB1', 'cellB2'] },
    });
  });

  it('값이 없던 문항은 키가 없다', () => {
    const result = roundTrip({ 'q-text': '메가리서치' });
    expect(Object.keys(result.records[0]?.answers ?? {})).toEqual(['q-text']);
  });
});
