import { describe, expect, it } from 'vitest';

import {
  generateSPSSColumns,
  buildDataRows,
} from '@/lib/analytics/spss-excel-export';
import type { Question, SurveySubmission } from '@/types/survey';

function makeQuestion(
  overrides: Partial<Question> & { type: Question['type']; order: number },
): Question {
  return {
    id: `q-${overrides.order}`,
    title: `문제${overrides.order}`,
    required: false,
    ...overrides,
  } as Question;
}

function makeSubmission(
  questionResponses: Record<string, any>,
  overrides?: Partial<SurveySubmission>,
): SurveySubmission {
  return {
    id: 'sub-1',
    surveyId: 'survey-1',
    startedAt: new Date('2025-01-01T09:00:00'),
    completedAt: new Date('2025-01-01T09:10:00'),
    isCompleted: true,
    currentGroupOrder: 0,
    questionResponses,
    updatedAt: new Date('2025-01-01T09:10:00'),
    ...overrides,
  };
}

const sampleQuestions: Question[] = [
  makeQuestion({
    type: 'radio',
    order: 1,
    id: 'q-gender',
    questionCode: 'Q1',
    title: '성별',
    options: [
      { id: 'o-male', label: '남성', value: 'o-male', spssNumericCode: 1 },
      { id: 'o-female', label: '여성', value: 'o-female', spssNumericCode: 2 },
    ],
  }),
  makeQuestion({
    type: 'checkbox',
    order: 2,
    id: 'q-products',
    questionCode: 'Q2',
    title: '생산품목',
    options: [
      { id: 'o-wood', label: '제제목', value: 'o-wood', spssNumericCode: 1 },
      { id: 'o-plywood', label: '합판', value: 'o-plywood', spssNumericCode: 2 },
      { id: 'o-fiber', label: '섬유판', value: 'o-fiber', spssNumericCode: 3 },
    ],
  }),
  makeQuestion({
    type: 'text',
    order: 3,
    id: 'q-opinion',
    questionCode: 'Q3',
    title: '기타 의견',
  }),
];

const sq0 = sampleQuestions[0];
const sq1 = sampleQuestions[1];
const sq2 = sampleQuestions[2];
if (!sq0 || !sq1 || !sq2) throw new Error('sampleQuestions 픽스처 누락');

describe('generateSPSSColumns', () => {
  it('단일선택 질문은 열 1개를 생성한다', () => {
    const columns = generateSPSSColumns([sq0]);
    expect(columns).toHaveLength(1);
    const col0 = columns[0];
    if (!col0) throw new Error('columns[0] 없음');
    expect(col0.spssVarName).toBe('Q1');
    expect(col0.type).toBe('single');
  });

  it('복수선택 질문은 옵션 수만큼 열을 생성한다', () => {
    const columns = generateSPSSColumns([sq1]);
    expect(columns).toHaveLength(3);
    const [cb0, cb1, cb2] = columns;
    if (!cb0 || !cb1 || !cb2) throw new Error('columns 없음');
    expect(cb0.spssVarName).toBe('Q2_1');
    expect(cb1.spssVarName).toBe('Q2_2');
    expect(cb2.spssVarName).toBe('Q2_3');
    expect(cb0.type).toBe('checkbox-item');
  });

  it('텍스트 질문은 열 1개를 생성한다', () => {
    const columns = generateSPSSColumns([sq2]);
    expect(columns).toHaveLength(1);
    const txtCol0 = columns[0];
    if (!txtCol0) throw new Error('columns[0] 없음');
    expect(txtCol0.spssVarName).toBe('Q3');
    expect(txtCol0.type).toBe('text');
  });

  it('notice 질문은 제외한다', () => {
    const questions = [makeQuestion({ type: 'notice', order: 1 })];
    const columns = generateSPSSColumns(questions);
    expect(columns).toHaveLength(0);
  });

  it('여러 질문을 순서대로 열 정의를 생성한다', () => {
    const columns = generateSPSSColumns(sampleQuestions);
    // Q1(1) + Q2_1~Q2_3(3) + Q3(1) = 5열
    expect(columns).toHaveLength(5);
    expect(columns.map((c) => c.spssVarName)).toEqual(['Q1', 'Q2_1', 'Q2_2', 'Q2_3', 'Q3']);
  });

  it('옵션 라벨을 포함한다', () => {
    const columns = generateSPSSColumns(sampleQuestions);
    const [lblCol0, lblCol1, lblCol2] = columns;
    if (!lblCol0 || !lblCol1 || !lblCol2) throw new Error('columns 없음');
    // radio는 모든 옵션을 "1. 남성 / 2. 여성" 형태로
    expect(lblCol0.optionLabel).toContain('남성');
    // checkbox는 개별 옵션 라벨
    expect(lblCol1.optionLabel).toContain('제제목');
    expect(lblCol2.optionLabel).toContain('합판');
  });

  it('isHidden 테이블 셀은 변수 열에서 제외한다', () => {
    const q: Question = {
      id: 'q1',
      type: 'table',
      title: 'Q1',
      order: 1,
      required: false,
      questionCode: 'Q1',
      tableColumns: [
        { id: 'c1', label: '항목', columnCode: 'c1' },
        { id: 'c2', label: '값1', columnCode: 'c2' },
        { id: 'c3', label: '값2', columnCode: 'c3' },
      ],
      tableRowsData: [
        {
          id: 'row1',
          label: '행1',
          rowCode: 'r1',
          cells: [
            { id: 'cellA', type: 'text', content: '항목', cellCode: 'Q1_r1_c1' },
            {
              id: 'cellB',
              type: 'radio',
              content: '',
              cellCode: 'Q1_r1_c2',
              radioOptions: [{ id: 'o1', label: '예', value: 'opt1', spssNumericCode: 1 }],
            },
            // 병합으로 가려진 셀 (컬럼 범위 안 index 2) — 변수에서 제외되어야 함
            {
              id: 'cellC',
              type: 'radio',
              content: '',
              cellCode: 'Q1_r1_c3',
              isHidden: true,
              radioOptions: [{ id: 'o1', label: '예', value: 'opt1', spssNumericCode: 1 }],
            },
          ],
        },
      ],
    } as unknown as Question;

    const cols = generateSPSSColumns([q]);
    const tableCols = cols.filter((c) => c.type === 'table-cell');
    expect(tableCols).toHaveLength(1);
    const tableCol0 = tableCols[0];
    if (!tableCol0) throw new Error('tableCols[0] 없음');
    expect(tableCol0.spssVarName).toBe('Q1_r1_c2');
  });

  it('테이블 셀 컬럼에 cellExportLabel을 실어 준다', () => {
    const q: Question = {
      id: 'q1',
      type: 'table',
      title: 'Q1',
      order: 1,
      required: false,
      questionCode: 'Q1',
      tableColumns: [{ id: 'c2', label: '값', columnCode: 'c2' }],
      tableRowsData: [
        {
          id: 'row1',
          label: '행1',
          rowCode: 'r1',
          cells: [
            {
              id: 'cellB',
              type: 'radio',
              content: '',
              cellCode: 'Q1_r1_c2',
              exportLabel: '영향평가_유무',
              radioOptions: [{ id: 'o1', label: '예', value: 'opt1', spssNumericCode: 1 }],
            },
          ],
        },
      ],
    } as unknown as Question;

    const col = generateSPSSColumns([q]).find((c) => c.type === 'table-cell');
    expect(col?.cellExportLabel).toBe('영향평가_유무');
  });

  it('radio-group 컬럼에 첫 멤버 셀의 cellExportLabel을 실어 준다', () => {
    const q: Question = {
      id: 'q1',
      type: 'table',
      title: 'Q1',
      order: 1,
      required: false,
      questionCode: 'Q1',
      tableColumns: [
        { id: 'c1', label: '항목', columnCode: 'c1' },
        { id: 'c2', label: '남성', columnCode: 'c2' },
        { id: 'c3', label: '여성', columnCode: 'c3' },
      ],
      tableRowsData: [
        {
          id: 'row1',
          label: '성별',
          rowCode: 'r1',
          cells: [
            { id: 'cA', type: 'text', content: '성별', cellCode: 'Q1_r1_c1' },
            {
              id: 'cB',
              type: 'radio',
              content: '',
              radioGroupName: 'g1',
              exportLabel: '대표자_성별',
              radioOptions: [{ id: 'm', label: '남성', value: 'optM', spssNumericCode: 1 }],
            },
            {
              id: 'cC',
              type: 'radio',
              content: '',
              radioGroupName: 'g1',
              radioOptions: [{ id: 'f', label: '여성', value: 'optF', spssNumericCode: 2 }],
            },
          ],
        },
      ],
    } as unknown as Question;

    const col = generateSPSSColumns([q]).find((c) => c.type === 'radio-group');
    expect(col).toBeDefined();
    expect(col?.cellExportLabel).toBe('대표자_성별');
  });

  it('radio-group 컬럼에 exportLabel이 없으면 첫 멤버 셀 기준 자동 라벨을 실어 준다', () => {
    const q: Question = {
      id: 'q1',
      type: 'table',
      title: 'Q1',
      order: 1,
      required: false,
      questionCode: 'Q1',
      tableColumns: [
        { id: 'c1', label: '항목', columnCode: 'c1' },
        { id: 'c2', label: '남성', columnCode: 'c2' },
        { id: 'c3', label: '여성', columnCode: 'c3' },
      ],
      tableRowsData: [
        {
          id: 'row1',
          label: '성별',
          rowCode: 'r1',
          cells: [
            { id: 'cA', type: 'text', content: '성별', cellCode: 'Q1_r1_c1' },
            {
              id: 'cB',
              type: 'radio',
              content: '',
              radioGroupName: 'g1',
              radioOptions: [{ id: 'm', label: '남성', value: 'optM', spssNumericCode: 1 }],
            },
            {
              id: 'cC',
              type: 'radio',
              content: '',
              radioGroupName: 'g1',
              radioOptions: [{ id: 'f', label: '여성', value: 'optF', spssNumericCode: 2 }],
            },
          ],
        },
      ],
    } as unknown as Question;

    const col = generateSPSSColumns([q]).find((c) => c.type === 'radio-group');
    expect(col).toBeDefined();
    expect(col?.cellExportLabel).toBe('Q1_남성_성별');
  });

  it('radio-group 멤버 셀들의 spssNumericCode가 충돌해도 값 라벨이 덮어쓰이지 않고 응답이 구분된다', () => {
    // 멤버 셀은 옵션 1개뿐이라 기본 spssNumericCode가 모두 1로 겹치기 쉽다(복붙/기본값).
    // 충돌 시 두 셀이 같은 코드로 합쳐지고 한쪽 라벨이 사라지던 회귀를 막는다.
    const q: Question = {
      id: 'q1',
      type: 'table',
      title: 'Q1',
      order: 1,
      required: false,
      questionCode: 'Q1',
      tableColumns: [
        { id: 'c1', label: '항목', columnCode: 'c1' },
        { id: 'c2', label: '남성', columnCode: 'c2' },
        { id: 'c3', label: '여성', columnCode: 'c3' },
      ],
      tableRowsData: [
        {
          id: 'row1',
          label: '성별',
          rowCode: 'r1',
          cells: [
            { id: 'cA', type: 'text', content: '성별', cellCode: 'Q1_r1_c1' },
            {
              id: 'cB',
              type: 'radio',
              content: '',
              radioGroupName: 'g1',
              radioOptions: [{ id: 'm', label: '남성', value: 'optM', spssNumericCode: 1 }],
            },
            {
              id: 'cC',
              type: 'radio',
              content: '',
              radioGroupName: 'g1',
              // 충돌: 두 번째 멤버도 spssNumericCode 1
              radioOptions: [{ id: 'f', label: '여성', value: 'optF', spssNumericCode: 1 }],
            },
          ],
        },
      ],
    } as unknown as Question;

    const col = generateSPSSColumns([q]).find((c) => c.type === 'radio-group');
    expect(col).toBeDefined();

    // 두 멤버 셀이 서로 다른 숫자값으로 매핑되어야 한다.
    const valueByCell = col?.radioGroupCellValueMap ?? {};
    const valueCB = valueByCell['cB'];
    const valueCC = valueByCell['cC'];
    expect(valueCB).toBeDefined();
    expect(valueCC).toBeDefined();
    expect(valueCB).not.toBe(valueCC);

    // 두 라벨이 모두 보존되어야 한다(한쪽 덮어쓰기 금지).
    const labels = Object.values(col?.radioGroupValueLabels ?? {});
    expect(labels).toContain('남성');
    expect(labels).toContain('여성');

    // 응답도 셀별로 구분되어 출력되어야 한다.
    const rows = buildDataRows(
      [col!],
      [q],
      [
        makeSubmission({ q1: { cB: 'optM' } }),
        makeSubmission({ q1: { cC: 'optF' } }),
      ],
    );
    expect(rows[0]?.[0]).toBe(valueCB);
    expect(rows[1]?.[0]).toBe(valueCC);
    expect(rows[0]?.[0]).not.toBe(rows[1]?.[0]);
  });
});

describe('buildDataRows', () => {
  it('단일선택 응답을 숫자코드로 변환한다', () => {
    const columns = generateSPSSColumns([sq0]);
    const submissions = [makeSubmission({ 'q-gender': 'o-male' })];
    const rows = buildDataRows(columns, [sq0], submissions);
    const row0 = rows[0];
    if (!row0) throw new Error('rows[0] 없음');
    expect(row0[0]).toBe(1);
  });

  it('복수선택 응답을 옵션별 분리한다', () => {
    const columns = generateSPSSColumns([sq1]);
    const submissions = [
      makeSubmission({ 'q-products': ['o-wood', 'o-fiber'] }),
    ];
    const rows = buildDataRows(columns, [sq1], submissions);
    const cbRow0 = rows[0];
    if (!cbRow0) throw new Error('rows[0] 없음');
    expect(cbRow0).toEqual([1, null, 3]); // 제제목=1, 합판=null, 섬유판=3
  });

  it('텍스트 응답을 그대로 유지한다', () => {
    const columns = generateSPSSColumns([sq2]);
    const submissions = [makeSubmission({ 'q-opinion': '좋았습니다' })];
    const rows = buildDataRows(columns, [sq2], submissions);
    const txtRow0 = rows[0];
    if (!txtRow0) throw new Error('rows[0] 없음');
    expect(txtRow0[0]).toBe('좋았습니다');
  });

  it('미응답은 null로 처리한다', () => {
    const columns = generateSPSSColumns([sq0]);
    const submissions = [makeSubmission({})];
    const rows = buildDataRows(columns, [sq0], submissions);
    const nullRow0 = rows[0];
    if (!nullRow0) throw new Error('rows[0] 없음');
    expect(nullRow0[0]).toBeNull();
  });

  it('여러 응답자의 데이터를 행으로 반환한다', () => {
    const columns = generateSPSSColumns([sq0]);
    const submissions = [
      makeSubmission({ 'q-gender': 'o-male' }),
      makeSubmission({ 'q-gender': 'o-female' }, { id: 'sub-2' }),
    ];
    const rows = buildDataRows(columns, [sq0], submissions);
    expect(rows).toHaveLength(2);
    const multiRow0 = rows[0];
    const multiRow1 = rows[1];
    if (!multiRow0 || !multiRow1) throw new Error('rows 없음');
    expect(multiRow0[0]).toBe(1);
    expect(multiRow1[0]).toBe(2);
  });

  it('테이블 radio 셀 응답을 옵션 spssNumericCode로 변환한다', () => {
    const q: Question = {
      id: 'q1',
      type: 'table',
      title: 'Q1',
      order: 1,
      required: false,
      questionCode: 'Q1',
      tableColumns: [{ id: 'c2', label: '값', columnCode: 'c2' }],
      tableRowsData: [
        {
          id: 'row1',
          label: '행1',
          rowCode: 'r1',
          cells: [
            {
              id: 'cellB',
              type: 'radio',
              content: '',
              cellCode: 'Q1_r1_c2',
              radioOptions: [
                { id: 'oA', label: '예', value: 'opt1', spssNumericCode: 1 },
                { id: 'oB', label: '아니오', value: 'opt2', spssNumericCode: 2 },
              ],
            },
          ],
        },
      ],
    } as unknown as Question;

    const cols = generateSPSSColumns([q]);
    const submissions = [
      { questionResponses: { q1: { cellB: 'opt2' } } },
      { questionResponses: { q1: { cellB: 'oA' } } }, // id로 저장된 경우도 매핑
    ] as unknown as SurveySubmission[];

    const rows = buildDataRows(cols, [q], submissions);
    const colIdx = cols.findIndex((c) => c.spssVarName === 'Q1_r1_c2');
    const tableRow0 = rows[0];
    const tableRow1 = rows[1];
    if (!tableRow0 || !tableRow1) throw new Error('rows 없음');
    expect(tableRow0[colIdx]).toBe(2);
    expect(tableRow1[colIdx]).toBe(1);
  });

  it('다단계 선택(multiselect) 응답을 밑줄로 합산한 STRING으로 변환한다', () => {
    // 회귀 방지: multiselect 컬럼이 switch default(콤마)로 빠지면 'a,b'가 되어 의도(밑줄)와 다르다.
    const q = makeQuestion({
      type: 'multiselect',
      order: 1,
      id: 'q-region',
      questionCode: 'Q1',
      title: '거주 지역',
    });

    const columns = generateSPSSColumns([q]);
    const msCol0 = columns[0];
    if (!msCol0) throw new Error('columns[0] 없음');
    expect(msCol0.type).toBe('multiselect');

    const submissions = [
      makeSubmission({ 'q-region': ['서울', '강남구', '역삼동'] }),
      makeSubmission({ 'q-region': [] }, { id: 'sub-2' }),
    ];
    const rows = buildDataRows(columns, [q], submissions);
    const msRow0 = rows[0];
    const msRow1 = rows[1];
    if (!msRow0 || !msRow1) throw new Error('rows 없음');
    // 콤마가 아니라 밑줄로 합산되어야 한다.
    expect(msRow0[0]).toBe('서울_강남구_역삼동');
    // 빈 배열은 system-missing(null).
    expect(msRow1[0]).toBeNull();
  });
});
