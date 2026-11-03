import type ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  EDITED_CELL_FILL,
  type RawExportContext,
  type RawExportResponseRow,
  buildRawMetaHeaders,
  buildResultCodeNumbers,
  generateRawDataWorkbook,
} from '@/lib/analytics/raw-workbook';
import { NOT_RESPONDED_STATUS } from '@/lib/operations/profiles-format';
import type { ContactResultCode } from '@/shared/contracts/contacts';
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

const numericTableInputQ = {
  ...tableInputQ,
  tableRowsData: [
    {
      id: 'tr',
      label: '기업 전체',
      rowCode: 'u00',
      cells: [
        {
          id: 'cellInput',
          type: 'input',
          content: '',
          spssVarType: 'Numeric',
          spssMeasure: 'Continuous',
          numberFormat: { thousandSeparator: true, decimalPlaces: 2 },
        },
      ],
    },
  ],
} as unknown as Question;

const TEST_CTX: RawExportContext = {
  appUrl: 'https://app.example.com',
  stepLabels: new Map([['group:g1', 'Q1']]),
  hasContacts: true,
  questionMeta: new Map([['q1', { order: 1, label: 'Q1' }]]),
};

function makeRow(over: Partial<RawExportResponseRow> = {}): RawExportResponseRow {
  return {
    id: 'r-1',
    questionResponses: {},
    resid: 7,
    inviteCode: 'abc123defg',
    ipHash: '0123456789abcdef',
    currentStepId: 'group:g1',
    platform: 'desktop',
    browser: 'Chrome',
    status: 'completed',
    startedAt: new Date('2026-07-01T00:00:00Z'),
    completedAt: new Date('2026-07-01T00:10:00Z'),
    totalSeconds: 600,
    ...over,
  };
}

describe('generateRawDataWorkbook', () => {
  it('3개 시트를 생성한다', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow()], TEST_CTX);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['응답 내역', 'Raw Data', '코딩북']);
  });

  it('Raw Data 시트는 헤더 3행(질문제목/셀라벨/변수명) 후 코드값', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [makeRow({ questionResponses: { q1: 'opt2' } })],
      TEST_CTX,
    );
    const ws = wb.getWorksheet('Raw Data')!;
    // 변수 열은 메타 10열만큼 오프셋 (구 B열=2 → 신 11열)
    expect(ws.getRow(1).getCell(11).value).toBe('Q1. 성별'); // 행1: 질문 제목
    expect(ws.getRow(2).getCell(11).value ?? '').toBe(''); // 행2: 셀라벨 (단일질문 → 공백)
    expect(ws.getRow(3).getCell(11).value).toBe('Q1'); // 행3: SPSS 변수명
    expect(ws.getRow(4).getCell(11).value).toBe(2); // 코드값 (여성=2)
  });

  it('코딩북 시트는 변수번호/변수명/값라벨과 SPSS 감사 메타데이터를 담는다', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow()], TEST_CTX);
    const ws = wb.getWorksheet('코딩북')!;
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => ws.getRow(1).getCell(c).value)).toEqual([
      '변수번호',
      'SPSS 변수명',
      '질문 제목',
      '셀라벨',
      '값 라벨',
      '변수 유형',
      '측정 수준',
      '표시 형식',
      '다중응답 세트',
      'SPSS 변수 라벨',
    ]);
    let valueLabel: unknown;
    ws.eachRow((row) => {
      if (row.getCell(2).value === 'Q1') valueLabel = row.getCell(5).value;
    });
    expect(valueLabel).toBe('1=남성, 2=여성');
  });

  it('코딩북은 숫자 설정과 다중응답 세트명을 실제 export 정의에서 표시한다', () => {
    const wb = generateRawDataWorkbook([numericTableInputQ, checkboxQ], [makeRow()], TEST_CTX);
    const ws = wb.getWorksheet('코딩북')!;
    const findRow = (varName: string) => {
      const rowIndex = ws.getColumn(2).values.findIndex((value) => value === varName);
      expect(rowIndex).toBeGreaterThan(0);
      return ws.getRow(rowIndex);
    };

    const amount = findRow('Q3_u00_2020');
    expect([6, 7, 8, 9].map((c) => amount.getCell(c).value ?? '')).toEqual([
      'Numeric',
      'Scale',
      'COMMA20.2',
      '',
    ]);

    const checkbox = findRow('Q2_1');
    expect([6, 7, 8, 9].map((c) => checkbox.getCell(c).value ?? '')).toEqual([
      'Numeric',
      'Nominal',
      'F8.0',
      '$Q2',
    ]);
  });

  // 코딩북 셀라벨 = Raw Data 2행 셀라벨. 코딩북만 표 칸 엑셀라벨을 읽어 복수응답 보기 열의 셀라벨이
  // 비어 있었다 — 값 라벨이 「빈값=비선택, 1=선택」뿐이라 어느 보기의 열인지 알 수 없었다(2026-10-30).
  it('코딩북 셀라벨은 Raw Data 2행과 같다 — 복수응답 보기 열에는 보기 글자', () => {
    const wb = generateRawDataWorkbook([radioQ, checkboxQ], [makeRow()], TEST_CTX);
    const raw = wb.getWorksheet('Raw Data')!;
    const codebook = wb.getWorksheet('코딩북')!;
    const rawLabels = new Map<string, unknown>();
    raw.getRow(3).eachCell((cell, col) => rawLabels.set(String(cell.value), raw.getRow(2).getCell(col).value ?? ''));
    const labelOf = (varName: string) => {
      const rowIndex = codebook.getColumn(2).values.findIndex((value) => value === varName);
      return codebook.getRow(rowIndex).getCell(4).value ?? '';
    };
    expect(labelOf('Q2_1')).toBe('AI');
    expect(labelOf('Q2_2')).toBe('ML');
    for (const varName of ['Q1', 'Q2_1', 'Q2_2']) expect(labelOf(varName)).toBe(rawLabels.get(varName));
  });

  // 코딩북 끝 열 = .sav 에 실제로 들어가는 변수 라벨(buildLabel 그대로) — SPSS 화면과 코딩북이 같은 글자
  it('코딩북 SPSS 변수 라벨 열은 .sav 변수 라벨과 같다 — 「문항코드 - 셀라벨」', () => {
    const wb = generateRawDataWorkbook([radioQ, checkboxQ], [makeRow()], TEST_CTX);
    const ws = wb.getWorksheet('코딩북')!;
    const labelOf = (varName: string) => {
      const rowIndex = ws.getColumn(2).values.findIndex((value) => value === varName);
      return ws.getRow(rowIndex).getCell(10).value;
    };
    expect(labelOf('Q2_1')).toBe('Q2 - AI');
    expect(labelOf('Q1')).toBe('Q1. 성별');
  });

  // 코딩북 값 라벨도 .sav 와 같은 기준 — 보기 글자의 줄바꿈은 공백 한 칸(CONTEXT.md 「옵션 라벨 줄바꿈」)
  it('코딩북 값 라벨은 보기 글자의 줄바꿈을 공백으로 접는다 (.sav 와 같게)', () => {
    const q = {
      ...radioQ,
      options: [
        { id: 'a', label: 'SW계열\n(전산 등)', value: '1', spssNumericCode: 1 },
        { id: 'b', label: '기타', value: '2', spssNumericCode: 2 },
      ],
    } as unknown as Question;
    const ws = generateRawDataWorkbook([q], [makeRow()], TEST_CTX).getWorksheet('코딩북')!;
    const rowIndex = ws.getColumn(2).values.findIndex((value) => value === 'Q1');
    expect(ws.getRow(rowIndex).getCell(5).value).toBe('1=SW계열 (전산 등), 2=기타');
  });

  it('시트2 1행은 같은 질문 변수 열끼리 가로 병합되고 메타 열은 세로 병합된다', () => {
    // radio(변수1) + checkbox(변수2: Q2_1, Q2_2) → 메타 10열(A~J) 후 K(Q1) L(Q2_1) M(Q2_2)
    const wb = generateRawDataWorkbook([radioQ, checkboxQ], [makeRow()], TEST_CTX);
    const ws = wb.getWorksheet('Raw Data')!;
    const merges = ws.model.merges as string[];
    expect(merges).toContain('A1:A3'); // 메타 첫 열 세로 병합
    expect(merges).toContain('J1:J3'); // 메타 마지막(10번째) 열 세로 병합
    expect(merges).toContain('L1:M1'); // 같은 질문(Q2) 변수 열 가로 병합 (오프셋 +9: C,D → L,M)
    // 단일 변수 질문(Q1, 11번째=K열)은 가로 병합 대상 아님
    expect(merges.some((m) => m.startsWith('K1:'))).toBe(false);
  });

  it('테이블 input 셀에 exportLabel 없으면 행2를 질문코드_열_행 자동 라벨로 채운다', () => {
    const wb = generateRawDataWorkbook([tableInputQ], [makeRow()], TEST_CTX);
    const ws = wb.getWorksheet('Raw Data')!;
    expect(ws.getRow(3).getCell(11).value).toBe('Q3_u00_2020'); // 행3: 변수명
    expect(ws.getRow(2).getCell(11).value).toBe('Q3_2020년 매출액_기업 전체'); // 행2: 자동 셀라벨
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
    const wb = generateRawDataWorkbook([custom], [makeRow()], TEST_CTX);
    const ws = wb.getWorksheet('Raw Data')!;
    expect(ws.getRow(2).getCell(11).value).toBe('내수매출_2020');
  });

  it('테이블-소스 체크박스는 옵션 셀의 exportLabel을 행2에 쓴다', () => {
    const wb = generateRawDataWorkbook([tableSourceCheckboxQ], [makeRow()], TEST_CTX);
    const ws = wb.getWorksheet('Raw Data')!;
    // 열 K=Q3_1, L=Q3_2 (메타 10열 오프셋)
    expect(ws.getRow(3).getCell(11).value).toBe('Q3_1'); // 행3: 변수명
    expect(ws.getRow(2).getCell(11).value).toBe('ⓐ 머신러닝'); // 행2: content 비어도 exportLabel 사용
    expect(ws.getRow(2).getCell(12).value).toBe('ⓖ 에이전트');
  });

  // 사이드카는 옵션 셀 exportLabel 을 따르되 「상세 기재」를 붙여 본 변수와 가른다(2026-10-30)
  it('테이블-소스 체크박스의 텍스트 사이드카도 옵션 셀 exportLabel을 유지한다', () => {
    const wb = generateRawDataWorkbook([tableSourceCheckboxWithTextQ], [makeRow()], TEST_CTX);
    const raw = wb.getWorksheet('Raw Data')!;
    const codebook = wb.getWorksheet('코딩북')!;

    expect(raw.getRow(3).getCell(11).value).toBe('Q4_1');
    expect(raw.getRow(3).getCell(12).value).toBe('Q4_1_text');
    expect(raw.getRow(2).getCell(11).value).toBe('ⓧ 기타 분야');
    expect(raw.getRow(2).getCell(12).value).toBe('ⓧ 기타 분야 상세 기재');

    const sidecar = codebook.getColumn(2).values.findIndex((v) => v === 'Q4_1_text');
    expect(sidecar).toBeGreaterThan(0);
    expect(codebook.getRow(sidecar).getCell(4).value).toBe('ⓧ 기타 분야 상세 기재');
  });

  it('시트2 헤더 1~3행에 색상(fill)과 열 너비가 적용된다', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow()], TEST_CTX);
    const ws = wb.getWorksheet('Raw Data')!;
    for (const ref of ['A1', 'B1', 'B2', 'B3']) {
      const fill = ws.getCell(ref).fill as { type?: string };
      expect(fill?.type).toBe('pattern');
    }
    expect(ws.getColumn(1).width).toBeGreaterThan(0);
    expect(ws.getColumn(2).width).toBeGreaterThan(0);
  });
});

describe('Raw Data 시트 메타 컬럼', () => {
  it('왼쪽 10열 헤더가 붙고 1~3행 세로 병합된다 — 조사 대상 그룹 고정 열은 없다', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow()], TEST_CTX);
    const ws = wb.getWorksheet('Raw Data')!;
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => ws.getRow(1).getCell(c).value)).toEqual([
      'IP 해시',
      '개별 URL',
      '온라인 응답 상태',
      '컨택결과코드',
      '조사 현황',
      '마지막 입력 문항',
      '시작일시',
      '종료일시',
      '소요시간',
      '접속 단말',
    ]);
    expect(ws.getRow(1).getCell(11).value).toBe('Q1. 성별');
  });

  it('순번 열은 어느 시트에도 없다', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow(), makeRow({ id: 'r-2' })], TEST_CTX);
    for (const name of ['Raw Data', '응답 내역']) {
      const headers = wb.getWorksheet(name)!.getRow(1).values as unknown[];
      expect(headers).not.toContain('순번');
    }
    expect(buildRawMetaHeaders(TEST_CTX)).not.toContain('순번');
    expect(wb.getWorksheet('코딩북')!.getColumn(2).values).not.toContain('순번');
  });

  it('컨택 없는 설문은 컨택결과코드·조사 현황 열을 만들지 않는다', () => {
    const noContactCtx: RawExportContext = {
      ...TEST_CTX,
      hasContacts: false,
    };
    const wb = generateRawDataWorkbook(
      [radioQ],
      [makeRow({ resid: null })],
      noContactCtx,
    );
    const ws = wb.getWorksheet('Raw Data')!;
    // 메타 8열 (컨택결과코드·조사 현황 생략) → IP 해시/개별 URL/온라인 응답 상태... 순, 변수 열은 9열부터
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((c) => ws.getRow(1).getCell(c).value)).toEqual([
      'IP 해시',
      '개별 URL',
      '온라인 응답 상태',
      '마지막 입력 문항',
      '시작일시',
      '종료일시',
      '소요시간',
      '접속 단말',
    ]);
    expect(ws.getRow(1).getCell(9).value).toBe('Q1. 성별');
    // 응답 내역 시트도 동일 규칙 (6열)
    const ws1 = wb.getWorksheet('응답 내역')!;
    expect(ws1.getRow(1).values).toEqual([
      undefined,
      '접속 단말',
      '브라우저',
      '온라인 응답 상태',
      '시작일시',
      '종료일시',
      '소요시간',
    ]);
  });

  it('메타 데이터 값이 규칙대로 채워진다', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow()], TEST_CTX);
    const dr = wb.getWorksheet('Raw Data')!.getRow(4);
    expect(dr.getCell(1).value).toBe('0123456789abcdef'); // IP 해시 앞 16자리
    expect(dr.getCell(2).value).toBe('https://app.example.com/i/abc123defg'); // 시스템ID·순번 열은 없다
    expect(dr.getCell(3).value).toBe('완료');
    expect(dr.getCell(4).value).toBe(''); // 컨택결과코드 — 회차 없음
    expect(dr.getCell(5).value).toBe('조사완료'); // 조사 현황 — 온라인 응답 완료
    expect(dr.getCell(6).value).toBe('Q1'); // 마지막 입력 문항
    expect(dr.getCell(10).value).toBe('PC');
  });

  it('익명·진행중 응답은 URL 공백, 상태·소요시간이 진행 표기된다', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [
        makeRow({
          resid: null,
          inviteCode: null,
          status: 'in_progress',
          completedAt: null,
          totalSeconds: null,
        }),
      ],
      TEST_CTX,
    );
    const dr = wb.getWorksheet('Raw Data')!.getRow(4);
    expect(dr.getCell(2).value).toBe(''); // 개별 URL
    expect(dr.getCell(3).value).toBe('진행중');
    expect(dr.getCell(5).value).toBe(''); // 조사 현황
    expect(dr.getCell(8).value).toBe(''); // 종료일시
    expect(dr.getCell(9).value).toBe('진행 중'); // 소요시간
  });

  it('자격 미달 응답은 두 시트 모두 상태가 완료(자격 미달)로 표기된다', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [makeRow({ status: 'screened_out' })],
      TEST_CTX,
    );
    expect(wb.getWorksheet('Raw Data')!.getRow(4).getCell(3).value).toBe('완료(자격 미달)');
    expect(wb.getWorksheet('응답 내역')!.getRow(2).getCell(3).value).toBe('완료(자격 미달)');
  });

  it('응답 내역 시트는 컨택 설문에서 시스템ID·순번 없이 접속 단말로 시작하고 온라인 응답 상태 다음에 컨택결과코드·조사 현황이 붙는다', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow()], TEST_CTX);
    const ws1 = wb.getWorksheet('응답 내역')!;
    expect(ws1.getRow(1).values).toEqual([
      undefined,
      '접속 단말',
      '브라우저',
      '온라인 응답 상태',
      '컨택결과코드',
      '조사 현황',
      '시작일시',
      '종료일시',
      '소요시간',
    ]);
    expect(ws1.getRow(2).getCell(1).value).toBe('PC');
  });

  it('진행 위치가 없는 구응답은 응답값 최후순 질문으로 폴백한다', () => {
    const ctx: RawExportContext = {
      ...TEST_CTX,
      questionMeta: new Map([
        ['q1', { order: 1, label: 'Q1' }],
        ['q2', { order: 2, label: 'Q2' }],
        ['q3', { order: 3, label: 'Q3' }],
      ]),
    };
    const wb = generateRawDataWorkbook(
      [radioQ],
      [
        makeRow({
          currentStepId: null,
          questionResponses: { q1: 'opt2', q2: ['optA'], q3: {} },
        }),
      ],
      ctx,
    );
    // q3 응답은 빈 객체(미입력)라 제외 → 응답값 존재 최후순은 q2 → 'Q2'
    expect(wb.getWorksheet('Raw Data')!.getRow(4).getCell(6).value).toBe('Q2');
  });

  it('진행 위치가 현재 문항 구조와 매칭 실패해도 응답값 기준이 동작한다', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [makeRow({ currentStepId: 'group:deleted', questionResponses: { q1: 'opt2' } })],
      TEST_CTX,
    );
    expect(wb.getWorksheet('Raw Data')!.getRow(4).getCell(6).value).toBe('Q1');
  });

  it('진행 페이지 라벨보다 응답값 최후순 문항이 우선한다', () => {
    // currentStepId 는 'group:g1'(라벨 Q1) 이지만 q2 까지 입력됨 — 한 페이지 다문항 케이스
    const ctx: RawExportContext = {
      ...TEST_CTX,
      questionMeta: new Map([
        ['q1', { order: 1, label: 'Q1' }],
        ['q2', { order: 2, label: 'Q2' }],
      ]),
    };
    const wb = generateRawDataWorkbook(
      [radioQ],
      [makeRow({ questionResponses: { q1: 'opt2', q2: '서울' } })],
      ctx,
    );
    expect(wb.getWorksheet('Raw Data')!.getRow(4).getCell(6).value).toBe('Q2');
  });

  it('다중 행에서 null 메타는 폴백된다', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [
        makeRow(),
        makeRow({
          ipHash: null,
          currentStepId: 'group:unknown',
          startedAt: new Date('2026-07-01T01:00:00Z'),
        }),
      ],
      TEST_CTX,
    );
    const ws = wb.getWorksheet('Raw Data')!;
    // null 폴백: IP 해시(1열) → '', 응답 없음+stepLabels 미스(6열) → ''
    expect(ws.getRow(5).getCell(1).value).toBe('');
    expect(ws.getRow(5).getCell(6).value).toBe('');
  });
});

describe('미응답 조사 대상 행', () => {
  const nonRespondentRow = () =>
    makeRow({
      status: NOT_RESPONDED_STATUS,
      questionResponses: {},
      ipHash: null,
      currentStepId: null,
      platform: null,
      browser: null,
      startedAt: null,
      completedAt: null,
      totalSeconds: null,
    });

  it('조사 대상 값만 채우고 응답 메타·문항 열은 빈칸이며 상태는 미응답이다', () => {
    const wb = generateRawDataWorkbook([radioQ], [nonRespondentRow()], TEST_CTX);
    const dr = wb.getWorksheet('Raw Data')!.getRow(4);
    expect(dr.getCell(1).value).toBe(''); // IP 해시
    expect(dr.getCell(2).value).toBe('https://app.example.com/i/abc123defg'); // 개별 URL
    expect(dr.getCell(3).value).toBe('미응답');
    expect([4, 5, 6, 7, 8, 9, 10].map((c) => dr.getCell(c).value)).toEqual(['', '', '', '', '', '', '']);
    expect(dr.getCell(11).value).toBeNull(); // Q1

    const lr = wb.getWorksheet('응답 내역')!.getRow(2);
    expect(lr.getCell(1).value).toBe(''); // 접속 단말
    expect(lr.getCell(2).value).toBe(''); // 브라우저
    expect(lr.getCell(3).value).toBe('미응답');
    expect(lr.getCell(8).value).toBe(''); // 소요시간
  });

  it('응답 행과 미응답 행은 들어온 순서 그대로 놓이고 상태만 갈린다', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [
        makeRow(),
        nonRespondentRow(),
        makeRow({ status: 'in_progress', startedAt: new Date('2026-07-02T00:00:00Z') }),
      ],
      TEST_CTX,
    );
    const ws = wb.getWorksheet('Raw Data')!;
    expect([4, 5, 6].map((r) => ws.getRow(r).getCell(3).value)).toEqual(['완료', '미응답', '진행중']);
    const ws1 = wb.getWorksheet('응답 내역')!;
    expect([2, 3, 4].map((r) => ws1.getRow(r).getCell(3).value)).toEqual(['완료', '미응답', '진행중']);
  });
});

describe('조사 대상 명단 열', () => {
  // 명단 열은 IP 해시(1열) 다음·개별 URL 앞 — 2·3열. 뒤 메타 열이 밀려 문항은 13열부터.
  const rosterCtx: RawExportContext = {
    ...TEST_CTX,
    contactColumns: [
      { source: 'attrs.기수', label: '기수', kind: 'attrs', key: '기수' },
      { source: 'pii.성명', label: '성명', kind: 'pii', key: '성명' },
    ],
  };

  it('IP 해시 다음·개별 URL 앞에 라벨 헤더가 붙고 1~3행 세로 병합되며 뒤 열이 그만큼 밀린다', () => {
    const wb = generateRawDataWorkbook([radioQ, checkboxQ], [makeRow()], rosterCtx);
    const ws = wb.getWorksheet('Raw Data')!;
    expect([1, 2, 3, 4].map((c) => ws.getRow(1).getCell(c).value)).toEqual([
      'IP 해시',
      '기수',
      '성명',
      '개별 URL',
    ]);
    expect(ws.getRow(1).getCell(12).value).toBe('접속 단말');
    expect(ws.getRow(1).getCell(13).value).toBe('Q1. 성별');
    // 2·3행은 1행 헤더에 세로 병합된 셀 — 변수명 행이 없다 (SPSS 변수가 아니다)
    for (const ref of ['B2', 'B3', 'C2', 'C3']) {
      expect(ws.getCell(ref).master.address).toBe(`${ref[0]}1`);
    }
    const merges = ws.model.merges as string[];
    expect(merges).toContain('B1:B3');
    expect(merges).toContain('C1:C3');
    // 같은 질문(Q2) 변수 열 가로 병합도 명단 열만큼 밀린다 (L:M → N:O)
    expect(merges).toContain('N1:O1');
    expect(merges).not.toContain('L1:M1');
  });

  // 자리를 헤더 문자열로 찾던 시절에는 못 찾은 findIndex(-1) 가 slice(0, -1) 로 흘러
  // 명단 열이 메타 마지막 열(접속 단말) 바로 앞에 조용히 생겼다. 앞뒤 고정 열을 통째로
  // 못박아, 그 오배치가 되살아나면 병합 좌표가 아니라 여기서 먼저 걸리게 한다.
  it('메타 열 순서 전체가 못박히고, 컨택결과코드·조사 현황 열이 빠져도 명단 열은 IP 해시와 개별 URL 사이다', () => {
    expect(buildRawMetaHeaders(rosterCtx)).toEqual([
      'IP 해시',
      '기수',
      '성명',
      '개별 URL',
      '온라인 응답 상태',
      '컨택결과코드',
      '조사 현황',
      '마지막 입력 문항',
      '시작일시',
      '종료일시',
      '소요시간',
      '접속 단말',
    ]);
    // 고정 열이 하나 빠져도 자리는 그대로 — 슬롯이 인덱스가 아니라 위치라는 확인
    expect(buildRawMetaHeaders({ ...rosterCtx, hasContacts: false })).toEqual([
      'IP 해시',
      '기수',
      '성명',
      '개별 URL',
      '온라인 응답 상태',
      '마지막 입력 문항',
      '시작일시',
      '종료일시',
      '소요시간',
      '접속 단말',
    ]);
  });

  it('명단 값은 source 키로 채우고 문항 코드값은 그 오른쪽에 온다', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [
        makeRow({
          questionResponses: { q1: 'opt2' },
          contactValues: { 'attrs.기수': '15기', 'pii.성명': '홍길동' },
        }),
      ],
      rosterCtx,
    );
    const dr = wb.getWorksheet('Raw Data')!.getRow(4);
    expect(dr.getCell(2).value).toBe('15기');
    expect(dr.getCell(3).value).toBe('홍길동');
    expect(dr.getCell(4).value).toBe('https://app.example.com/i/abc123defg'); // 개별 URL 은 명단 뒤
    expect(dr.getCell(13).value).toBe(2);
  });

  it('조사 대상이 없는 익명 응답은 전부 빈칸, 값 없는 키만 빈칸이다', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [
        makeRow({ resid: null, inviteCode: null }),
        makeRow({ id: 'r-2', contactValues: { 'attrs.기수': '15기' } }),
      ],
      rosterCtx,
    );
    const ws = wb.getWorksheet('Raw Data')!;
    expect([2, 3].map((c) => ws.getRow(4).getCell(c).value)).toEqual(['', '']);
    expect([2, 3].map((c) => ws.getRow(5).getCell(c).value)).toEqual(['15기', '']);
  });

  it('contactColumns 가 비었거나 없으면 명단 열 없는 열 구성이고, 응답 내역 시트에는 맨 앞에 같은 열이 붙는다', () => {
    for (const ctx of [TEST_CTX, { ...TEST_CTX, contactColumns: [] }]) {
      const wb = generateRawDataWorkbook([radioQ], [makeRow()], ctx);
      expect(wb.getWorksheet('Raw Data')!.getRow(1).getCell(11).value).toBe('Q1. 성별');
      expect(wb.getWorksheet('응답 내역')!.getRow(1).getCell(1).value).toBe('접속 단말');
    }
    const ws1 = generateRawDataWorkbook(
      [radioQ],
      [makeRow({ contactValues: { 'attrs.기수': '15기', 'pii.성명': '홍길동' } })],
      rosterCtx,
    ).getWorksheet('응답 내역')!;
    expect([1, 2].map((c) => ws1.getRow(2).getCell(c).value)).toEqual(['15기', '홍길동']);
    expect(ws1.getRow(1).values).toEqual([
      undefined,
      '기수',
      '성명',
      '접속 단말',
      '브라우저',
      '온라인 응답 상태',
      '컨택결과코드',
      '조사 현황',
      '시작일시',
      '종료일시',
      '소요시간',
    ]);
  });

  it('미응답 조사 대상 행에도 명단 값이 채워지고 상태는 미응답이다', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [
        makeRow({
          status: NOT_RESPONDED_STATUS,
          questionResponses: {},
          ipHash: null,
          currentStepId: null,
          platform: null,
          browser: null,
          startedAt: null,
          completedAt: null,
          totalSeconds: null,
          contactValues: { 'attrs.기수': '15기', 'pii.성명': '홍길동' },
        }),
      ],
      rosterCtx,
    );
    const dr = wb.getWorksheet('Raw Data')!.getRow(4);
    expect(dr.getCell(5).value).toBe('미응답');
    expect(dr.getCell(2).value).toBe('15기');
    expect(dr.getCell(3).value).toBe('홍길동');
    expect(dr.getCell(13).value).toBeNull();
  });

  it('코딩북에는 명단 열이 없다', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow()], rosterCtx);
    const names = wb.getWorksheet('코딩북')!.getColumn(2).values;
    expect(names).not.toContain('기수');
    expect(names).not.toContain('성명');
  });
});

describe('컨택결과코드 열', () => {
  const codes: ContactResultCode[] = [
    { code: '1.조사완료', label: '1.조사완료', order: 1 },
    { code: '9.휴/폐업', label: '9.휴/폐업', order: 9 },
    { code: '13. 독려', label: '13. 독려', order: 13 },
    { code: '수신거부', label: '수신거부', order: 14 },
  ];
  const ctx: RawExportContext = { ...TEST_CTX, resultCodes: codes };

  it('번호 없는 코드는 가장 큰 번호 다음을 받는다 — 겹치지 않는다', () => {
    expect([...buildResultCodeNumbers(codes)]).toEqual([
      ['1.조사완료', 1],
      ['9.휴/폐업', 9],
      ['13. 독려', 13],
      ['수신거부', 14],
    ]);
    // 13.독려가 없는 옛 기본값에서는 수신거부가 13
    expect(
      buildResultCodeNumbers([
        { code: '12.담당자퇴사', label: '12.담당자퇴사', order: 12 },
        { code: '수신거부', label: '수신거부', order: 13 },
      ]).get('수신거부'),
    ).toBe(13);
  });

  it('앞 번호가 겹치는 자유 코드는 뒤쪽이 가장 큰 번호 다음을 받는다 — 한 숫자가 두 코드를 가리키지 않는다', () => {
    const numbers = buildResultCodeNumbers([
      { code: '3.부재', label: '3.부재', order: 3 },
      { code: '3-1.재통화', label: '3-1.재통화', order: 4 },
      { code: '수신거부', label: '수신거부', order: 5 },
    ]);
    expect([...numbers]).toEqual([
      ['3.부재', 3],
      ['3-1.재통화', 4],
      ['수신거부', 5],
    ]);
    // 목록에 없는 옛 코드의 앞 번호가 목록 번호와 겹치면 빈칸 — 남의 번호를 빌리지 않는다
    const wb = generateRawDataWorkbook(
      [radioQ],
      [makeRow({ resultCode: '4.출장' }), makeRow({ id: 'r-2', resultCode: '7.결번' }), makeRow({ id: 'r-3', resultCode: '기타메모' })],
      {
        ...TEST_CTX,
        resultCodes: [
          { code: '3.부재', label: '3.부재', order: 3 },
          { code: '3-1.재통화', label: '3-1.재통화', order: 4 },
        ],
      },
    );
    const ws = wb.getWorksheet('Raw Data')!;
    expect([4, 5, 6].map((r) => ws.getRow(r).getCell(4).value)).toEqual(['', 7, '']);
  });

  it('온라인 응답 상태 다음 칸에 숫자만 — 목록에 없는 옛 코드는 겹치지 않는 앞 번호만, 회차가 없으면 빈칸', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [
        makeRow({ resultCode: '13. 독려' }),
        makeRow({ id: 'r-2', resultCode: '수신거부' }),
        makeRow({ id: 'r-3', resultCode: '9.전시회미참가' }), // 9 는 목록의 9.휴/폐업 번호라 빌리지 않는다
        makeRow({ id: 'r-4', resultCode: '5.출장' }),
        makeRow({ id: 'r-5' }),
      ],
      ctx,
    );
    const ws = wb.getWorksheet('Raw Data')!;
    expect(ws.getRow(1).getCell(3).value).toBe('온라인 응답 상태');
    expect(ws.getRow(1).getCell(4).value).toBe('컨택결과코드');
    expect([4, 5, 6, 7, 8].map((r) => ws.getRow(r).getCell(4).value)).toEqual([13, 14, '', 5, '']);
    const ws1 = wb.getWorksheet('응답 내역')!;
    expect(ws1.getRow(1).getCell(3).value).toBe('온라인 응답 상태');
    expect(ws1.getRow(1).getCell(4).value).toBe('컨택결과코드');
    expect([2, 3, 4, 5, 6].map((r) => ws1.getRow(r).getCell(4).value)).toEqual([13, 14, '', 5, '']);
  });

  it('코딩북 끝에 온라인 응답 상태·컨택결과코드·조사 현황 값 라벨이 붙는다 — 변수 행 번호는 그대로', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow()], ctx);
    const ws = wb.getWorksheet('코딩북')!;
    expect(ws.getRow(2).getCell(1).value).toBe(1);
    const tail = [ws.rowCount - 2, ws.rowCount - 1, ws.rowCount].map((r) => ws.getRow(r));
    expect(tail.map((r) => r.getCell(2).value)).toEqual([
      '온라인 응답 상태',
      '컨택결과코드',
      '조사 현황',
    ]);
    expect(tail[0]!.getCell(5).value).toBe(
      '완료, 완료(자격 미달), 쿼터마감, 불량, 진행중, 이탈, 미응답',
    );
    expect(tail[1]!.getCell(5).value).toBe(
      '빈값=회차 없음 또는 목록에 없는 코드, 1=조사완료, 9=휴/폐업, 13=독려, 14=수신거부',
    );
    expect(tail[2]!.getCell(5).value).toBe(
      '조사완료=온라인 응답 완료 또는 컨택결과코드 1, 빈값=그 외',
    );
  });

  it('조사 대상이 없는 설문은 컨택결과코드·조사 현황 열도 코딩북 행도 없다', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow()], { ...ctx, hasContacts: false });
    const headers = buildRawMetaHeaders({ ...ctx, hasContacts: false });
    expect(headers).not.toContain('컨택결과코드');
    expect(headers).not.toContain('조사 현황');
    const names = wb.getWorksheet('코딩북')!.getColumn(2).values;
    expect(names).toContain('온라인 응답 상태');
    expect(names).not.toContain('컨택결과코드');
    expect(names).not.toContain('조사 현황');
  });
});

describe('조사 현황 열', () => {
  // 조사 현황 = 온라인 응답 완료 또는 컨택결과코드 1(조사완료)이면 「조사완료」, 아니면 빈칸.
  // 컨택 설문의 메타 열: 온라인 응답 상태(3) · 컨택결과코드(4) · 조사 현황(5) — 응답 내역 시트도 같은 3·4·5열.
  const codes: ContactResultCode[] = [
    { code: '1.조사완료', label: '1.조사완료', order: 1 },
    { code: '3.부재', label: '3.부재', order: 3 },
    { code: '13. 독려', label: '13. 독려', order: 13 },
  ];
  const ctx: RawExportContext = { ...TEST_CTX, resultCodes: codes };
  const notResponded = (over: Partial<RawExportResponseRow> = {}) =>
    makeRow({
      status: NOT_RESPONDED_STATUS,
      ipHash: null,
      currentStepId: null,
      platform: null,
      browser: null,
      startedAt: null,
      completedAt: null,
      totalSeconds: null,
      ...over,
    });
  const cases: { name: string; row: RawExportResponseRow; status: string; code: number | ''; expected: string }[] = [
    { name: '온라인 완료 + 코드 13', row: makeRow({ resultCode: '13. 독려' }), status: '완료', code: 13, expected: '조사완료' },
    { name: '미응답 + 코드 1', row: notResponded({ id: 'r-2', resultCode: '1.조사완료' }), status: '미응답', code: 1, expected: '조사완료' },
    { name: '이탈 + 코드 1', row: makeRow({ id: 'r-3', status: 'drop', completedAt: null, resultCode: '1.조사완료' }), status: '이탈', code: 1, expected: '조사완료' },
    { name: '미응답 + 코드 3', row: notResponded({ id: 'r-4', resultCode: '3.부재' }), status: '미응답', code: 3, expected: '' },
    { name: '자격 미달 + 코드 없음', row: makeRow({ id: 'r-5', status: 'screened_out' }), status: '완료(자격 미달)', code: '', expected: '' },
  ];

  it('컨택결과코드 다음 열이다', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow()], ctx);
    expect(wb.getWorksheet('Raw Data')!.getRow(1).getCell(5).value).toBe('조사 현황');
    expect(wb.getWorksheet('응답 내역')!.getRow(1).getCell(5).value).toBe('조사 현황');
  });

  it.each(cases)('$name → 「$expected」 — Raw Data·응답 내역 두 시트 모두', ({ row, status, code, expected }) => {
    const wb = generateRawDataWorkbook([radioQ], [row], ctx);
    for (const [name, rowNo] of [['Raw Data', 4], ['응답 내역', 2]] as const) {
      const r = wb.getWorksheet(name)!.getRow(rowNo);
      expect([3, 4, 5].map((c) => r.getCell(c).value)).toEqual([status, code, expected]);
    }
  });

  it('여러 행을 한 파일에 넣어도 행마다 따로 판정한다', () => {
    const wb = generateRawDataWorkbook([radioQ], cases.map((c) => c.row), ctx);
    const expected = cases.map((c) => c.expected);
    const raw = wb.getWorksheet('Raw Data')!;
    expect(cases.map((_, i) => raw.getRow(4 + i).getCell(5).value)).toEqual(expected);
    const list = wb.getWorksheet('응답 내역')!;
    expect(cases.map((_, i) => list.getRow(2 + i).getCell(5).value)).toEqual(expected);
  });

  it('조사 대상이 없는 설문에는 두 시트 모두 열이 없다 — 온라인 완료여도', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow({ resultCode: '1.조사완료' })], {
      ...ctx,
      hasContacts: false,
    });
    for (const [name, rowNo] of [['Raw Data', 4], ['응답 내역', 2]] as const) {
      const ws = wb.getWorksheet(name)!;
      expect(ws.getRow(1).values as unknown[]).not.toContain('조사 현황');
      expect(ws.getRow(rowNo).values as unknown[]).not.toContain('조사완료');
    }
  });
});

describe('손으로 고친 명단 칸', () => {
  const rosterCtx: RawExportContext = {
    ...TEST_CTX,
    contactColumns: [
      { source: 'attrs.기수', label: '기수', kind: 'attrs', key: '기수' },
      { source: 'pii.성명', label: '성명', kind: 'pii', key: '성명' },
    ],
  };
  const isYellow = (cell: ExcelJS.Cell) =>
    (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb === EDITED_CELL_FILL.fgColor?.argb &&
    cell.fill?.type === 'pattern';

  it('고친 열의 칸만 두 시트 모두 노랗다', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [
        makeRow({
          contactValues: { 'attrs.기수': '15기', 'pii.성명': '홍길동' },
          editedSources: new Set(['pii.성명']),
        }),
        makeRow({ id: 'r-2', contactValues: { 'attrs.기수': '16기', 'pii.성명': '김철수' } }),
      ],
      rosterCtx,
    );
    const raw = wb.getWorksheet('Raw Data')!;
    expect(isYellow(raw.getRow(4).getCell(3))).toBe(true); // 성명
    expect(isYellow(raw.getRow(4).getCell(2))).toBe(false); // 기수
    expect(isYellow(raw.getRow(5).getCell(3))).toBe(false); // 다른 행
    const list = wb.getWorksheet('응답 내역')!;
    expect(list.getRow(1).getCell(2).value).toBe('성명'); // 명단 열은 1열부터
    expect(isYellow(list.getRow(2).getCell(2))).toBe(true); // 성명
    expect(isYellow(list.getRow(2).getCell(1))).toBe(false); // 기수
    expect(isYellow(list.getRow(3).getCell(2))).toBe(false);
  });

  it('명단 열로 내보내지 않는 열을 고쳤으면 칠할 칸이 없다', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [makeRow({ contactValues: { 'attrs.기수': '15기', 'pii.성명': '' }, editedSources: new Set(['attrs.연락처']) })],
      rosterCtx,
    );
    const raw = wb.getWorksheet('Raw Data')!;
    for (let c = 1; c <= 13; c++) expect(isYellow(raw.getRow(4).getCell(c))).toBe(false);
  });
});

describe('이어 넘길 값 열 (패널 회원 ID)', () => {
  const panelCtx: RawExportContext = { ...TEST_CTX, hasContacts: false, entryParamNames: ['euid'] };

  it('IP 해시(와 명단 열) 다음·개별 URL 앞에 이름 그대로 열이 붙는다', () => {
    expect(buildRawMetaHeaders(panelCtx).slice(0, 3)).toEqual(['IP 해시', 'euid', '개별 URL']);
    expect(
      buildRawMetaHeaders({
        ...panelCtx,
        contactColumns: [{ source: 'attrs.기수', label: '기수', kind: 'attrs', key: '기수' }],
      }).slice(1, 4),
    ).toEqual(['기수', 'euid', '개별 URL']);
  });

  it('값은 응답 행의 entryParams 에서, 없으면 빈칸', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [makeRow({ entryParams: { euid: '12345' } }), makeRow({ id: 'r-2' })],
      panelCtx,
    );
    const ws = wb.getWorksheet('Raw Data')!;
    expect(ws.getRow(4).getCell(2).value).toBe('12345');
    expect(ws.getRow(5).getCell(2).value).toBe('');
    const list = wb.getWorksheet('응답 내역')!;
    expect(list.getRow(1).getCell(1).value).toBe('euid');
    expect(list.getRow(2).getCell(1).value).toBe('12345');
  });

  it('설정이 없으면 열이 없다', () => {
    expect(buildRawMetaHeaders({ ...TEST_CTX, entryParamNames: [] })).not.toContain('euid');
  });
});
