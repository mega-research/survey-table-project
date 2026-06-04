import { describe, expect, it } from 'vitest';

import { type RawExportResponseRow, generateRawDataWorkbook } from '@/lib/excel-transformer';
import type { Question } from '@/types/survey';

const radioQ = {
  id: 'q1',
  type: 'radio',
  title: 'Q1. 성별',
  order: 1,
  required: false,
  questionCode: 'Q1',
  options: [
    { id: 'a', label: '남성', value: 'opt1', spssNumericCode: 1 },
    { id: 'b', label: '여성', value: 'opt2', spssNumericCode: 2 },
  ],
} as unknown as Question;

const checkboxQ = {
  id: 'q2',
  type: 'checkbox',
  title: 'Q2. 관심분야',
  order: 2,
  required: false,
  questionCode: 'Q2',
  options: [
    { id: 'x', label: 'AI', value: 'optA', spssNumericCode: 1 },
    { id: 'y', label: 'ML', value: 'optB', spssNumericCode: 2 },
  ],
} as unknown as Question;

// 옵션을 테이블 choice_opt 셀로 정의하는 체크박스(테이블-소스). content는 비고 exportLabel만 있음.
const tableSourceCheckboxQ = {
  id: 'q3',
  type: 'checkbox',
  title: 'Q3. 보유 분야',
  order: 3,
  required: false,
  questionCode: 'Q3',
  options: [],
  tableColumns: [{ id: 'tc', label: '', columnCode: 'c1' }],
  tableRowsData: [
    {
      id: 'tr1',
      label: '',
      rowCode: 'r1',
      cells: [
        {
          id: 'cellOpt1',
          type: 'choice_opt',
          content: '',
          exportLabel: 'ⓐ 머신러닝',
          spssNumericCode: 1,
        },
      ],
    },
    {
      id: 'tr2',
      label: '',
      rowCode: 'r2',
      cells: [
        {
          id: 'cellOpt2',
          type: 'choice_opt',
          content: '',
          exportLabel: 'ⓖ 에이전트',
          spssNumericCode: 2,
        },
      ],
    },
  ],
} as unknown as Question;

const tableSourceCheckboxWithTextQ = {
  id: 'q4',
  type: 'checkbox',
  title: 'Q4. 기타 보유 분야',
  order: 4,
  required: false,
  questionCode: 'Q4',
  options: [],
  tableColumns: [{ id: 'tc', label: '', columnCode: 'c1' }],
  tableRowsData: [
    {
      id: 'tr1',
      label: '',
      rowCode: 'r1',
      cells: [
        {
          id: 'cellOptText',
          type: 'choice_opt',
          content: '',
          exportLabel: 'ⓧ 기타 분야',
          spssNumericCode: 1,
          allowTextInput: true,
        },
      ],
    },
  ],
} as unknown as Question;

// 테이블 input 셀, exportLabel 미저장(null) → export 시 자동 라벨(질문코드_열_행) 폴백 대상
const tableInputQ = {
  id: 'qt',
  type: 'table',
  title: '문3. 매출액',
  order: 1,
  required: false,
  questionCode: 'Q3',
  tableColumns: [{ id: 'tc', label: '2020년 매출액', columnCode: '2020' }],
  tableRowsData: [
    {
      id: 'tr',
      label: '기업 전체',
      rowCode: 'u00',
      cells: [{ id: 'cellInput', type: 'input', content: '' }],
    },
  ],
} as unknown as Question;

const baseRow = (over: Partial<RawExportResponseRow>): RawExportResponseRow => ({
  id: 'r1',
  questionResponses: {},
  groupValue: null,
  resid: null,
  platform: 'desktop',
  browser: 'Chrome',
  status: 'completed',
  startedAt: new Date('2026-06-03T05:30:00Z'),
  completedAt: new Date('2026-06-03T05:40:00Z'),
  totalSeconds: 600,
  ...over,
});

describe('generateRawDataWorkbook', () => {
  it('3개 시트를 생성한다', () => {
    const wb = generateRawDataWorkbook([radioQ], [baseRow({})], 'sequence');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['응답 내역', 'Raw Data', '코딩북']);
  });

  it('공공(sequence)은 첫 컬럼 헤더가 순번이고 1부터 매긴다', () => {
    const rows = [baseRow({ id: 'a' }), baseRow({ id: 'b' })];
    const wb = generateRawDataWorkbook([radioQ], rows, 'sequence');
    const ws = wb.getWorksheet('응답 내역')!;
    expect(ws.getCell('A1').value).toBe('순번');
    expect(ws.getCell('A2').value).toBe(1);
    expect(ws.getCell('A3').value).toBe(2);
  });

  it('토큰(systemId)은 첫 컬럼 헤더가 systemID이고 resid 값을 쓴다', () => {
    const wb = generateRawDataWorkbook([radioQ], [baseRow({ resid: 77 })], 'systemId');
    const ws = wb.getWorksheet('응답 내역')!;
    expect(ws.getCell('A1').value).toBe('systemID');
    expect(ws.getCell('A2').value).toBe(77);
  });

  it('Raw Data 시트는 헤더 3행(질문제목/셀라벨/변수명) 후 코드값', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [baseRow({ questionResponses: { q1: 'opt2' } })],
      'sequence',
    );
    const ws = wb.getWorksheet('Raw Data')!;
    expect(ws.getCell('A1').value).toBe('순번'); // 식별자 헤더 (세로 병합 master)
    expect(ws.getCell('B1').value).toBe('Q1. 성별'); // 행1: 질문 제목
    expect(ws.getCell('B2').value ?? '').toBe(''); // 행2: 셀라벨 (단일질문 → 공백)
    expect(ws.getCell('B3').value).toBe('Q1'); // 행3: SPSS 변수명
    expect(ws.getCell('A4').value).toBe(1); // 데이터 행 식별자
    expect(ws.getCell('B4').value).toBe(2); // 코드값 (여성=2)
  });

  it('코딩북 시트는 변수번호/변수명/값라벨을 담는다', () => {
    const wb = generateRawDataWorkbook([radioQ], [baseRow({})], 'sequence');
    const ws = wb.getWorksheet('코딩북')!;
    expect([1, 2, 3, 4, 5].map((c) => ws.getRow(1).getCell(c).value)).toEqual([
      '변수번호',
      'SPSS 변수명',
      '질문 제목',
      '셀라벨',
      '값 라벨',
    ]);
    let valueLabel: unknown;
    ws.eachRow((row) => {
      if (row.getCell(2).value === 'Q1') valueLabel = row.getCell(5).value;
    });
    expect(valueLabel).toBe('1=남성, 2=여성');
  });

  it('시트2 1행은 같은 질문 변수 열끼리 가로 병합되고 식별자는 세로 병합된다', () => {
    // radio(변수1) + checkbox(변수2: Q2_1, Q2_2) → 열 A(식별자) B(Q1) C(Q2_1) D(Q2_2)
    const wb = generateRawDataWorkbook([radioQ, checkboxQ], [baseRow({})], 'sequence');
    const ws = wb.getWorksheet('Raw Data')!;
    const merges = ws.model.merges as string[];
    expect(merges).toContain('A1:A3'); // 식별자 세로 병합
    expect(merges).toContain('C1:D1'); // 같은 질문(Q2) 변수 열 가로 병합
    // 단일 변수 질문(Q1, B열)은 가로 병합 대상 아님
    expect(merges.some((m) => m.startsWith('B1:'))).toBe(false);
  });

  it('테이블 input 셀에 exportLabel 없으면 행2를 질문코드_열_행 자동 라벨로 채운다', () => {
    const wb = generateRawDataWorkbook([tableInputQ], [baseRow({})], 'sequence');
    const ws = wb.getWorksheet('Raw Data')!;
    expect(ws.getCell('B3').value).toBe('Q3_u00_2020'); // 행3: 변수명
    expect(ws.getCell('B2').value).toBe('Q3_2020년 매출액_기업 전체'); // 행2: 자동 셀라벨
  });

  it('테이블 셀에 커스텀 exportLabel 있으면 자동값 대신 그대로 쓴다', () => {
    const custom = {
      ...tableInputQ,
      tableRowsData: [
        {
          id: 'tr',
          label: '기업 전체',
          rowCode: 'u00',
          cells: [{ id: 'cellInput', type: 'input', content: '', exportLabel: '내수매출_2020' }],
        },
      ],
    } as unknown as Question;
    const wb = generateRawDataWorkbook([custom], [baseRow({})], 'sequence');
    const ws = wb.getWorksheet('Raw Data')!;
    expect(ws.getCell('B2').value).toBe('내수매출_2020');
  });

  it('테이블-소스 체크박스는 옵션 셀의 exportLabel을 행2에 쓴다', () => {
    const wb = generateRawDataWorkbook([tableSourceCheckboxQ], [baseRow({})], 'sequence');
    const ws = wb.getWorksheet('Raw Data')!;
    // 열 A=식별자, B=Q3_1, C=Q3_2
    expect(ws.getCell('B3').value).toBe('Q3_1'); // 행3: 변수명
    expect(ws.getCell('B2').value).toBe('ⓐ 머신러닝'); // 행2: content 비어도 exportLabel 사용
    expect(ws.getCell('C2').value).toBe('ⓖ 에이전트');
  });

  it('테이블-소스 체크박스의 텍스트 사이드카도 옵션 셀 exportLabel을 유지한다', () => {
    const wb = generateRawDataWorkbook([tableSourceCheckboxWithTextQ], [baseRow({})], 'sequence');
    const raw = wb.getWorksheet('Raw Data')!;
    const codebook = wb.getWorksheet('코딩북')!;

    expect(raw.getCell('B3').value).toBe('Q4_1');
    expect(raw.getCell('C3').value).toBe('Q4_1_text');
    expect(raw.getCell('B2').value).toBe('ⓧ 기타 분야');
    expect(raw.getCell('C2').value).toBe('ⓧ 기타 분야');

    const sidecar = codebook.getColumn(2).values.findIndex((v) => v === 'Q4_1_text');
    expect(sidecar).toBeGreaterThan(0);
    expect(codebook.getRow(sidecar).getCell(4).value).toBe('ⓧ 기타 분야');
  });

  it('시트2 헤더 1~3행에 색상(fill)과 열 너비가 적용된다', () => {
    const wb = generateRawDataWorkbook([radioQ], [baseRow({})], 'sequence');
    const ws = wb.getWorksheet('Raw Data')!;
    for (const ref of ['A1', 'B1', 'B2', 'B3']) {
      const fill = ws.getCell(ref).fill as { type?: string };
      expect(fill?.type).toBe('pattern');
    }
    expect(ws.getColumn(1).width).toBeGreaterThan(0);
    expect(ws.getColumn(2).width).toBeGreaterThan(0);
  });
});
