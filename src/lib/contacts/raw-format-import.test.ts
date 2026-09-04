import { describe, expect, it } from 'vitest';

import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
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
const CHECK_ITEM = varNameOf('q-check', 'checkbox-item');

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

  it('아직 되돌릴 수 없는 열 종류는 종류별로 보고한다', () => {
    const result = build([['7', '', '2', '메가리서치', '1']], [SINGLE, TEXT, CHECK_ITEM]);
    expect(result.unsupportedVarNames).toEqual([CHECK_ITEM]);
    expect(result.records[0]?.answers).toEqual({ 'q-single': 'v2', 'q-text': '메가리서치' });
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
