import { describe, expect, it } from 'vitest';

import { buildDataRow, generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { buildRawFormatRecords } from '@/lib/contacts/raw-format-import';
import type { Question } from '@/types/survey';

/**
 * Raw 양식 왕복 회귀 — 전 문항 유형을 한 설문에 담아 내보내고 그대로 되읽는다.
 *
 * 유형별 테스트가 각자 통과해도 유형이 섞였을 때만 나는 어긋남이 있다. 열 순서, 병합
 * 헤더, 사이드카가 서로 자리를 밀어내는 문제는 한 파일에 다 넣어야 보인다.
 *
 * 기대값을 손으로 적지 않는다 — 원본 응답 묶음 자체와 견준다. 내보내기 규칙이 바뀌면
 * 여기서 먼저 깨져야 왕복이 조용히 어긋나지 않는다.
 */
const questions: Question[] = [
  { id: 'q-text', type: 'text', title: '기업명', questionCode: 'Q1', order: 0, required: false },
  { id: 'q-area', type: 'textarea', title: '의견', questionCode: 'Q2', order: 1, required: false },
  {
    id: 'q-radio',
    type: 'radio',
    title: '단일선택',
    questionCode: 'Q3',
    order: 2,
    required: false,
    options: [
      { id: 'r1', value: 'rv1', label: '가' },
      { id: 'r2', value: 'rv2', label: '나' },
    ],
  },
  {
    id: 'q-select',
    type: 'select',
    title: '드롭다운',
    questionCode: 'Q4',
    order: 3,
    required: false,
    options: [
      { id: 's1', value: 'sv1', label: '하나' },
      { id: 's2', value: 'sv2', label: '둘' },
    ],
  },
  {
    id: 'q-check',
    type: 'checkbox',
    title: '복수선택',
    questionCode: 'Q5',
    order: 4,
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
    title: '다단계',
    questionCode: 'Q6',
    order: 5,
    required: false,
    selectLevels: [
      { id: 'l1', label: '시도', options: [{ id: 'm1', value: '서울', label: '서울' }] },
      { id: 'l2', label: '시군구', options: [{ id: 'm2', value: '강남', label: '강남' }] },
    ],
  },
  {
    id: 'q-rank',
    type: 'ranking',
    title: '순위',
    questionCode: 'Q7',
    order: 6,
    required: false,
    allowOtherOption: true,
    rankingConfig: { positions: 3 },
    options: [
      { id: 'k1', value: 'kv1', label: '가' },
      { id: 'k2', value: 'kv2', label: '나' },
      { id: 'k3', value: 'kv3', label: '다' },
    ],
  },
  {
    // 병합(colspan)과 숨김 셀이 섞인 표 — 자리가 밀리는지 본다.
    id: 'q-table',
    type: 'table',
    title: '표',
    questionCode: 'Q8',
    order: 7,
    required: false,
    tableColumns: [
      { id: 'x1', label: '가' },
      { id: 'x2', label: '나' },
      { id: 'x3', label: '다' },
    ],
    tableRowsData: [
      {
        id: 'row1',
        cells: [
          { id: 'cell-merged', type: 'text', content: '설명', colspan: 2 },
          { id: 'cell-hidden', type: 'text', content: '', isHidden: true },
          {
            id: 'cell-radio',
            type: 'radio',
            content: '',
            // id 와 value 를 **다르게** 둔다. 같게 두면 저장값 규칙 위반이 가려진다 —
            // 셀 컨트롤은 `option.value ?? option.id` 를 저장한다.
            radioOptions: [
              { id: 'tr-id-1', value: 'trv1', label: '좋음' },
              // 상세 기재가 붙는 보기 — 그 텍스트는 사이드카로 가야 하고, 이 셀의 선택값을
              // 덮어써서는 안 된다.
              { id: 'tr-id-2', value: 'trv2', label: '나쁨', allowTextInput: true },
            ],
          },
        ],
      },
      {
        id: 'row2',
        cells: [
          { id: 'cell-input', type: 'input', content: '' },
          {
            id: 'cell-check',
            type: 'checkbox',
            content: '',
            // 여기도 id 와 value 를 다르게 둔다. value 가 아예 없는 보기는 **내보내기 쪽이**
            // 표현하지 못한다(선택 판정을 `opt.value` 로만 해 항상 미선택으로 나간다) —
            // 되읽기가 고칠 수 있는 문제가 아니라 왕복 대상에서 뺀다.
            checkboxOptions: [
              { id: 'tc-id-1', value: 'tcv1', label: '가' },
              { id: 'tc-id-2', value: 'tcv2', label: '나' },
            ],
          },
          { id: 'cell-calc', type: 'calc', content: '' },
        ],
      },
    ],
  },
  {
    id: 'q-notice',
    type: 'notice',
    title: '안내',
    questionCode: 'Q9',
    order: 8,
    required: false,
    requiresAcknowledgment: true,
  },
] as unknown as Question[];

const columns = generateSPSSColumns(questions, {
  changeConfirmQuestionIds: new Set(questions.map((q) => q.id)),
});

function roundTrip(questionResponses: Record<string, unknown>) {
  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const dataRow = buildDataRow(columns, questionMap, { questionResponses } as never);
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

describe('Raw 양식 왕복 — 전 문항 유형', () => {
  /** 되읽지 않기로 한 열만 뺀 원본. 나머지는 통째로 같아야 한다. */
  const answered = {
    'q-text': '메가리서치',
    'q-area': '여러 줄\n의견',
    'q-radio': 'rv2',
    'q-select': 'sv1',
    'q-check': ['cv1', 'cv3'],
    'q-multi': ['서울', '강남'],
    'q-rank': [
      { rank: 1, optionValue: 'kv2' },
      { rank: 2, optionValue: '__other__', otherText: '직접 적은 것' },
    ],
    'q-table': {
      'cell-radio': 'trv2',
      'cell-check': ['tcv2'],
      'cell-input': '입력값',
    },
  };

  it('되읽는 열은 원본과 통째로 같다', () => {
    const result = roundTrip(answered);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.answers).toEqual(answered);
  });

  it('공지 동의는 되읽지 않고 보고한다 — 동의는 이번 회차에 다시 받는다', () => {
    const result = roundTrip({
      ...answered,
      'q-notice': { agreed: true, agreedAt: '2026-01-02T03:04:05.000Z' },
    });
    expect(result.records[0]?.answers).toEqual(answered);
    expect(result.skippedByRuleVarNames.length).toBeGreaterThan(0);
  });

  it('변동 확인은 되읽지 않는다 — 이번 회차 행위 기록이다', () => {
    const result = roundTrip({
      ...answered,
      __changeConfirm__: { 'q-radio': 'same' },
    });
    expect(result.records[0]?.answers).toEqual(answered);
    expect(Object.keys(result.records[0]?.answers ?? {})).not.toContain('__changeConfirm__');
  });

  it('값이 없던 문항은 키를 만들지 않는다', () => {
    const result = roundTrip({ 'q-text': '메가리서치' });
    expect(result.records[0]?.answers).toEqual({ 'q-text': '메가리서치' });
  });

  it('전 칸이 비면 그 대상은 담지 않는다', () => {
    expect(roundTrip({}).records).toEqual([]);
  });

  it('표 셀의 상세 기재가 선택값을 덮어쓰지 않고 사이드카로 간다', () => {
    // 상세 기재를 문항 답으로 흘리면 같은 셀 자리에 덮어써져 선택과 텍스트가 함께 망가진다.
    const result = roundTrip({
      ...answered,
      __optTexts__: { 'q-table': { 'tr-id-2': '직접 적은 상세' } },
    });
    expect(result.records[0]?.answers).toMatchObject({
      'q-table': { 'cell-radio': 'trv2' },
      __optTexts__: { 'q-table': { 'tr-id-2': '직접 적은 상세' } },
    });
  });

  it('되돌리지 못한 열이 하나도 없다', () => {
    const result = roundTrip(answered);
    expect(result.unsupportedVarNames).toEqual([]);
    expect(result.unknownVarNames).toEqual([]);
  });
});
