import { describe, expect, it } from 'vitest';

import {
  type RawExportContext,
  type RawExportResponseRow,
  generateRawDataWorkbook,
} from '@/lib/analytics/raw-workbook';
import { NOT_RESPONDED_STATUS } from '@/lib/operations/profiles';
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
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => ws.getRow(1).getCell(c).value)).toEqual([
      '변수번호',
      'SPSS 변수명',
      '질문 제목',
      '셀라벨',
      '값 라벨',
      '변수 유형',
      '측정 수준',
      '표시 형식',
      '다중응답 세트',
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

  it('테이블-소스 체크박스의 텍스트 사이드카도 옵션 셀 exportLabel을 유지한다', () => {
    const wb = generateRawDataWorkbook([tableSourceCheckboxWithTextQ], [makeRow()], TEST_CTX);
    const raw = wb.getWorksheet('Raw Data')!;
    const codebook = wb.getWorksheet('코딩북')!;

    expect(raw.getRow(3).getCell(11).value).toBe('Q4_1');
    expect(raw.getRow(3).getCell(12).value).toBe('Q4_1_text');
    expect(raw.getRow(2).getCell(11).value).toBe('ⓧ 기타 분야');
    expect(raw.getRow(2).getCell(12).value).toBe('ⓧ 기타 분야');

    const sidecar = codebook.getColumn(2).values.findIndex((v) => v === 'Q4_1_text');
    expect(sidecar).toBeGreaterThan(0);
    expect(codebook.getRow(sidecar).getCell(4).value).toBe('ⓧ 기타 분야');
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
      '시스템ID',
      '순번',
      '개별 URL',
      '상태',
      '마지막 입력 문항',
      '시작일시',
      '종료일시',
      '소요시간',
      '접속 단말',
    ]);
    expect(ws.getRow(1).getCell(11).value).toBe('Q1. 성별');
  });

  it('컨택 없는 설문은 번호 열을 만들지 않는다', () => {
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
    // 메타 9열 (번호 생략) → IP 해시/순번/개별 URL... 순, 변수 열은 10열부터
    expect(ws.getRow(1).getCell(1).value).toBe('IP 해시');
    expect(ws.getRow(1).getCell(2).value).toBe('순번');
    expect(ws.getRow(1).getCell(3).value).toBe('개별 URL');
    expect(ws.getRow(1).getCell(9).value).toBe('접속 단말');
    expect(ws.getRow(1).getCell(10).value).toBe('Q1. 성별');
    expect(ws.getRow(4).getCell(2).value).toBe(1); // 순번
    // 응답 내역 시트도 동일 규칙 (7열)
    const ws1 = wb.getWorksheet('응답 내역')!;
    expect(ws1.getRow(1).getCell(1).value).toBe('순번');
    expect(ws1.getRow(1).getCell(7).value).toBe('소요시간');
    expect(ws1.getRow(1).getCell(8).value ?? '').toBe('');
  });

  it('메타 데이터 값이 규칙대로 채워진다', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow()], TEST_CTX);
    const dr = wb.getWorksheet('Raw Data')!.getRow(4);
    expect(dr.getCell(1).value).toBe('0123456789abcdef'); // IP 해시 앞 16자리
    expect(dr.getCell(2).value).toBe(7); // 번호=resid
    expect(dr.getCell(3).value).toBe(1); // 순번
    expect(dr.getCell(4).value).toBe('https://app.example.com/i/abc123defg');
    expect(dr.getCell(5).value).toBe('완료');
    expect(dr.getCell(6).value).toBe('Q1'); // 마지막 입력 문항 — 상태 바로 옆
    expect(dr.getCell(10).value).toBe('PC');
  });

  it('익명·진행중 응답은 번호/URL 공백, 상태·소요시간이 진행 표기된다', () => {
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
    expect(dr.getCell(2).value).toBe(''); // 번호
    expect(dr.getCell(4).value).toBe(''); // 개별 URL
    expect(dr.getCell(5).value).toBe('진행중');
    expect(dr.getCell(8).value).toBe(''); // 종료일시
    expect(dr.getCell(9).value).toBe('진행 중'); // 소요시간
  });

  it('자격 미달 응답은 두 시트 모두 상태가 완료(자격 미달)로 표기된다', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [makeRow({ status: 'screened_out' })],
      TEST_CTX,
    );
    expect(wb.getWorksheet('Raw Data')!.getRow(4).getCell(5).value).toBe('완료(자격 미달)');
    expect(wb.getWorksheet('응답 내역')!.getRow(2).getCell(5).value).toBe('완료(자격 미달)');
  });

  it('응답 내역 시트는 컨택 설문에서 번호+순번 두 식별자를 갖는다', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow()], TEST_CTX);
    const ws1 = wb.getWorksheet('응답 내역')!;
    expect(ws1.getRow(1).values).toEqual([
      undefined,
      '시스템ID',
      '순번',
      '접속 단말',
      '브라우저',
      '상태',
      '시작일시',
      '종료일시',
      '소요시간',
    ]);
    expect(ws1.getRow(2).getCell(1).value).toBe(7);
    expect(ws1.getRow(2).getCell(2).value).toBe(1);
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

  it('다중 행에서 순번이 증가하고 null 메타는 폴백된다', () => {
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
    // 순번(3열): 시작일시 순 — 데이터 1행(시트 4행)=1, 데이터 2행(시트 5행)=2
    expect(ws.getRow(4).getCell(3).value).toBe(1);
    expect(ws.getRow(5).getCell(3).value).toBe(2);
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
    expect(dr.getCell(2).value).toBe(7); // 시스템ID
    expect(dr.getCell(3).value).toBe(''); // 순번 — 응답이 아니므로 접수 순번이 없다
    expect(dr.getCell(4).value).toBe('https://app.example.com/i/abc123defg'); // 개별 URL
    expect(dr.getCell(5).value).toBe('미응답');
    expect([6, 7, 8, 9, 10].map((c) => dr.getCell(c).value)).toEqual(['', '', '', '', '']);
    expect(dr.getCell(11).value).toBeNull(); // Q1

    const lr = wb.getWorksheet('응답 내역')!.getRow(2);
    expect(lr.getCell(2).value).toBe(''); // 순번
    expect(lr.getCell(3).value).toBe(''); // 접속 단말
    expect(lr.getCell(4).value).toBe(''); // 브라우저
    expect(lr.getCell(5).value).toBe('미응답');
    expect(lr.getCell(8).value).toBe(''); // 소요시간
  });

  it('미응답 행은 순번이 빈칸이고 응답 행끼리만 접수 순번이 이어진다', () => {
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
    expect([4, 5, 6].map((r) => ws.getRow(r).getCell(3).value)).toEqual([1, '', 2]);
    expect([4, 5, 6].map((r) => ws.getRow(r).getCell(5).value)).toEqual(['완료', '미응답', '진행중']);
    const ws1 = wb.getWorksheet('응답 내역')!;
    expect([2, 3, 4].map((r) => ws1.getRow(r).getCell(2).value)).toEqual([1, '', 2]);
  });

  it('순번은 행 정렬이 아니라 시작일시 순이다 — 시스템ID 순으로 정렬된 파일에서도 접수 순번을 지킨다', () => {
    const wb = generateRawDataWorkbook(
      [radioQ],
      [
        makeRow({ resid: 1, startedAt: new Date('2026-07-03T00:00:00Z') }),
        makeRow({ resid: 2, startedAt: new Date('2026-07-01T00:00:00Z') }),
        nonRespondentRow(),
        makeRow({ resid: 4, startedAt: new Date('2026-07-02T00:00:00Z') }),
      ],
      TEST_CTX,
    );
    const ws = wb.getWorksheet('Raw Data')!;
    expect([4, 5, 6, 7].map((r) => ws.getRow(r).getCell(3).value)).toEqual([3, 1, '', 2]);
    const ws1 = wb.getWorksheet('응답 내역')!;
    expect([2, 3, 4, 5].map((r) => ws1.getRow(r).getCell(2).value)).toEqual([3, 1, '', 2]);
  });
});

describe('조사 대상 명단 열', () => {
  // 명단 열은 순번(3열) 다음·개별 URL 앞 — 4·5열. 뒤 메타 열이 밀려 문항은 13열부터.
  const rosterCtx: RawExportContext = {
    ...TEST_CTX,
    contactColumns: [
      { source: 'attrs.기수', label: '기수', kind: 'attrs', key: '기수' },
      { source: 'pii.성명', label: '성명', kind: 'pii', key: '성명' },
    ],
  };

  it('순번 다음·개별 URL 앞에 라벨 헤더가 붙고 1~3행 세로 병합되며 뒤 열이 그만큼 밀린다', () => {
    const wb = generateRawDataWorkbook([radioQ, checkboxQ], [makeRow()], rosterCtx);
    const ws = wb.getWorksheet('Raw Data')!;
    expect([3, 4, 5, 6].map((c) => ws.getRow(1).getCell(c).value)).toEqual([
      '순번',
      '기수',
      '성명',
      '개별 URL',
    ]);
    expect(ws.getRow(1).getCell(12).value).toBe('접속 단말');
    expect(ws.getRow(1).getCell(13).value).toBe('Q1. 성별');
    // 2·3행은 1행 헤더에 세로 병합된 셀 — 변수명 행이 없다 (SPSS 변수가 아니다)
    for (const ref of ['D2', 'D3', 'E2', 'E3']) {
      expect(ws.getCell(ref).master.address).toBe(`${ref[0]}1`);
    }
    const merges = ws.model.merges as string[];
    expect(merges).toContain('D1:D3');
    expect(merges).toContain('E1:E3');
    // 같은 질문(Q2) 변수 열 가로 병합도 명단 열만큼 밀린다 (L:M → N:O)
    expect(merges).toContain('N1:O1');
    expect(merges).not.toContain('L1:M1');
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
    expect(dr.getCell(4).value).toBe('15기');
    expect(dr.getCell(5).value).toBe('홍길동');
    expect(dr.getCell(6).value).toBe('https://app.example.com/i/abc123defg'); // 개별 URL 은 명단 뒤
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
    expect([4, 5].map((c) => ws.getRow(4).getCell(c).value)).toEqual(['', '']);
    expect([4, 5].map((c) => ws.getRow(5).getCell(c).value)).toEqual(['15기', '']);
  });

  it('contactColumns 가 비었거나 없으면 명단 열 없는 열 구성이고, 응답 내역 시트에는 순번 다음에 같은 열이 붙는다', () => {
    for (const ctx of [TEST_CTX, { ...TEST_CTX, contactColumns: [] }]) {
      const wb = generateRawDataWorkbook([radioQ], [makeRow()], ctx);
      expect(wb.getWorksheet('Raw Data')!.getRow(1).getCell(11).value).toBe('Q1. 성별');
      expect(wb.getWorksheet('응답 내역')!.getRow(1).getCell(3).value).toBe('접속 단말');
    }
    const ws1 = generateRawDataWorkbook(
      [radioQ],
      [makeRow({ contactValues: { 'attrs.기수': '15기', 'pii.성명': '홍길동' } })],
      rosterCtx,
    ).getWorksheet('응답 내역')!;
    expect([3, 4].map((c) => ws1.getRow(2).getCell(c).value)).toEqual(['15기', '홍길동']);
    expect(ws1.getRow(1).values).toEqual([
      undefined,
      '시스템ID',
      '순번',
      '기수',
      '성명',
      '접속 단말',
      '브라우저',
      '상태',
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
    expect(dr.getCell(7).value).toBe('미응답');
    expect(dr.getCell(4).value).toBe('15기');
    expect(dr.getCell(5).value).toBe('홍길동');
    expect(dr.getCell(13).value).toBeNull();
  });

  it('코딩북에는 명단 열이 없다', () => {
    const wb = generateRawDataWorkbook([radioQ], [makeRow()], rosterCtx);
    const names = wb.getWorksheet('코딩북')!.getColumn(2).values;
    expect(names).not.toContain('기수');
    expect(names).not.toContain('성명');
  });
});
