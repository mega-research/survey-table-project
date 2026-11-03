import { describe, expect, it } from 'vitest';

import { type RawExportContext, type RawExportResponseRow } from '@/lib/analytics/raw-workbook';
import { buildSplitWorkbook } from '@/lib/analytics/split-workbook';
import { NOT_RESPONDED_STATUS } from '@/lib/operations/profiles-format';
import type { Question, QuestionConditionGroup } from '@/types/survey';

const basisQ = {
  id: 'qb',
  type: 'radio',
  title: 'Q1. 그룹',
  order: 1,
  required: false,
  questionCode: 'Q1',
  options: [
    { id: 'a', label: 'A', value: 'opt1', spssNumericCode: 1 },
    { id: 'b', label: 'B', value: 'opt2', spssNumericCode: 2 },
  ],
} as unknown as Question;

const textQ = {
  id: 'qt',
  type: 'text',
  title: 'Q2. 의견',
  order: 2,
  required: false,
  questionCode: 'Q2',
} as unknown as Question;

const CTX: RawExportContext = {
  appUrl: 'https://app.example.com',
  stepLabels: new Map(),
  hasContacts: true,
  questionMeta: new Map(),
};

const row: RawExportResponseRow = {
  id: 'r-1',
  questionResponses: { qb: 'opt1', qt: '좋음' },
  resid: 3,
  inviteCode: null,
  ipHash: null,
  currentStepId: null,
  platform: 'mobile',
  browser: 'Safari',
  status: 'completed',
  startedAt: new Date('2026-07-01T00:00:00Z'),
  completedAt: new Date('2026-07-01T00:05:00Z'),
  totalSeconds: 300,
};

describe('분할 워크북 메타 컬럼', () => {
  it('응답 내역 제외 모든 변수 시트 왼쪽에 메타 10열이 붙는다', () => {
    const wb = buildSplitWorkbook([basisQ, textQ], [row], 'qb', CTX);
    for (const ws of wb.worksheets) {
      if (ws.name === '응답 내역' || ws.name === '코딩북') continue;
      expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => ws.getRow(1).getCell(c).value)).toEqual([
        'IP 해시', // 시스템ID·순번 열은 없다
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
      expect(ws.getRow(4).getCell(3).value).toBe('완료');
      expect(ws.getRow(4).getCell(5).value).toBe('조사완료'); // 조사 현황 — 온라인 응답 완료
    }
  });

  it('응답 내역 시트는 순번 없이 접속 단말로 시작하고 온라인 응답 상태 다음에 컨택결과코드·조사 현황이 붙는다', () => {
    const wb = buildSplitWorkbook([basisQ, textQ], [row], 'qb', CTX);
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
    expect(ws1.getRow(2).getCell(5).value).toBe('조사완료');
  });

  it('코딩북 끝에 온라인 응답 상태·컨택결과코드·조사 현황 값 라벨이 붙는다', () => {
    const wb = buildSplitWorkbook([basisQ, textQ], [row], 'qb', CTX);
    const ws = wb.getWorksheet('코딩북')!;
    const tail = [ws.rowCount - 2, ws.rowCount - 1, ws.rowCount].map((r) => ws.getRow(r).getCell(2).value);
    expect(tail).toEqual(['온라인 응답 상태', '컨택결과코드', '조사 현황']);
    expect(ws.getColumn(2).values).not.toContain('순번');
  });

  it('조사 현황은 컨택결과코드 1 이면 미응답이어도 조사완료, 컨택 없는 설문에는 열이 없다', () => {
    const resultCodes = [
      { code: '1.조사완료', label: '1.조사완료', order: 1 },
      { code: '3.부재', label: '3.부재', order: 3 },
    ];
    const notResponded = (id: string, resultCode: string): RawExportResponseRow => ({
      ...row,
      id,
      questionResponses: {},
      platform: null,
      browser: null,
      status: NOT_RESPONDED_STATUS,
      startedAt: null,
      completedAt: null,
      totalSeconds: null,
      resultCode,
    });
    const rows = [notResponded('t-1', '1.조사완료'), notResponded('t-2', '3.부재')];
    const wb = buildSplitWorkbook([basisQ, textQ], rows, 'qb', { ...CTX, resultCodes });
    for (const ws of wb.worksheets) {
      if (ws.name === '코딩북') continue;
      const first = ws.name === '응답 내역' ? 2 : 4;
      expect(ws.getRow(1).getCell(5).value).toBe('조사 현황');
      expect([first, first + 1].map((r) => ws.getRow(r).getCell(5).value)).toEqual(['조사완료', '']);
    }

    const noContact = buildSplitWorkbook([basisQ, textQ], [row], 'qb', { ...CTX, hasContacts: false });
    for (const ws of noContact.worksheets) {
      if (ws.name === '코딩북') continue;
      expect(ws.getRow(1).values as unknown[]).not.toContain('조사 현황');
      expect(ws.getRow(1).values as unknown[]).not.toContain('컨택결과코드');
    }
    expect(noContact.getWorksheet('코딩북')!.getColumn(2).values).not.toContain('조사 현황');
  });

  it('코딩북도 일반 Raw Data와 같은 9개 SPSS 감사 열을 제공한다', () => {
    const wb = buildSplitWorkbook([basisQ, textQ], [row], 'qb', CTX);
    const codebook = wb.getWorksheet('코딩북')!;

    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => codebook.getRow(1).getCell(c).value)).toEqual([
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

    const q1Row = codebook.getColumn(2).values.findIndex((value) => value === 'Q1');
    expect([6, 7, 8, 9].map((c) => codebook.getRow(q1Row).getCell(c).value ?? '')).toEqual([
      'Numeric',
      'Nominal',
      'F8.0',
      '',
    ]);
  });

  it('미응답 조사 대상 행은 모든 변수 시트에 상태 미응답·변수 열 빈칸으로 들어간다', () => {
    const nonRespondent: RawExportResponseRow = {
      id: 't-1',
      questionResponses: {},
      resid: 5,
      inviteCode: 'c5',
      ipHash: null,
      currentStepId: null,
      platform: null,
      browser: null,
      status: NOT_RESPONDED_STATUS,
      startedAt: null,
      completedAt: null,
      totalSeconds: null,
    };
    const wb = buildSplitWorkbook([basisQ, textQ], [row, nonRespondent], 'qb', CTX);
    for (const ws of wb.worksheets) {
      if (ws.name === '응답 내역' || ws.name === '코딩북') continue;
      expect(ws.rowCount).toBe(5); // 헤더 3행 + 데이터 2행
      const dr = ws.getRow(5);
      expect(dr.getCell(2).value).toBe('https://app.example.com/i/c5'); // 개별 URL
      expect(dr.getCell(3).value).toBe('미응답');
      expect([9, 10].map((c) => dr.getCell(c).value)).toEqual(['', '']); // 소요시간·접속 단말
      expect(dr.getCell(11).value).toBeNull(); // 변수 열
    }
  });
});

describe('분할 워크북 조사 대상 명단 열', () => {
  // A 응답자에게만 보이는 문항 — 옵션 시트가 하나 생겨 공통·옵션 시트 둘 다 검사할 수 있다.
  const onlyA: QuestionConditionGroup = {
    logicType: 'AND',
    conditions: [
      { id: 'c1', sourceQuestionId: 'qb', conditionType: 'value-match', requiredValues: ['opt1'], logicType: 'AND' },
    ],
  };
  const condQ = {
    id: 'qc',
    type: 'text',
    title: 'Q3. A 전용',
    order: 3,
    required: false,
    questionCode: 'Q3',
    displayCondition: onlyA,
  } as unknown as Question;

  const rosterCtx: RawExportContext = {
    ...CTX,
    contactColumns: [
      { source: 'attrs.기수', label: '기수', kind: 'attrs', key: '기수' },
      { source: 'pii.성명', label: '성명', kind: 'pii', key: '성명' },
    ],
  };

  it('공통·옵션 시트 전부 IP 해시 다음에 명단 열이 붙고 세로 병합되며 코딩북에는 없다', () => {
    const wb = buildSplitWorkbook(
      [basisQ, textQ, condQ],
      [{ ...row, contactValues: { 'attrs.기수': '15기', 'pii.성명': '홍길동' } }],
      'qb',
      rosterCtx,
    );
    const variableSheets = wb.worksheets.filter((ws) => ws.name !== '응답 내역' && ws.name !== '코딩북');
    expect(variableSheets.map((ws) => ws.name)).toContain('공통');
    expect(variableSheets.length).toBeGreaterThanOrEqual(2);
    for (const ws of variableSheets) {
      expect(ws.getRow(1).getCell(1).value).toBe('IP 해시');
      expect(ws.getRow(1).getCell(2).value).toBe('기수');
      expect(ws.getRow(1).getCell(3).value).toBe('성명');
      expect(ws.getRow(1).getCell(4).value).toBe('개별 URL');
      expect(ws.getRow(1).getCell(12).value).toBe('접속 단말');
      expect(ws.getRow(4).getCell(2).value).toBe('15기');
      expect(ws.getRow(4).getCell(3).value).toBe('홍길동');
      const merges = ws.model.merges as string[];
      expect(merges).toContain('B1:B3');
      expect(merges).toContain('C1:C3');
    }
    const names = wb.getWorksheet('코딩북')!.getColumn(2).values;
    expect(names).not.toContain('기수');
    expect(names).not.toContain('성명');
    // 응답 내역 시트에는 맨 앞(1열)부터 같은 명단 열이 붙는다
    const ws1 = wb.getWorksheet('응답 내역')!;
    expect([1, 2, 3].map((c) => ws1.getRow(1).getCell(c).value)).toEqual([
      '기수',
      '성명',
      '접속 단말',
    ]);
    expect([1, 2].map((c) => ws1.getRow(2).getCell(c).value)).toEqual(['15기', '홍길동']);
  });
});
