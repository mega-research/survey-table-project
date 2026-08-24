import { describe, expect, it } from 'vitest';

import { type RawExportContext, type RawExportResponseRow } from '@/lib/analytics/raw-workbook';
import { buildSplitWorkbook } from '@/lib/analytics/split-workbook';
import type { Question } from '@/types/survey';

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
  hasContactGroups: true,
  questionMeta: new Map(),
};

const row: RawExportResponseRow = {
  id: 'r-1',
  questionResponses: { qb: 'opt1', qt: '좋음' },
  groupValue: null,
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
  it('응답 내역 제외 모든 변수 시트 왼쪽에 메타 11열이 붙는다', () => {
    const wb = buildSplitWorkbook([basisQ, textQ], [row], 'qb', CTX);
    for (const ws of wb.worksheets) {
      if (ws.name === '응답 내역' || ws.name === '코딩북') continue;
      expect(ws.getRow(1).getCell(1).value).toBe('IP 해시');
      expect(ws.getRow(1).getCell(2).value).toBe('시스템ID');
      expect(ws.getRow(1).getCell(11).value).toBe('접속 단말');
      expect(ws.getRow(4).getCell(2).value).toBe(3); // 번호=resid
      expect(ws.getRow(4).getCell(3).value).toBe(1); // 순번
    }
  });

  it('응답 내역 시트는 번호+순번 9열 구조다', () => {
    const wb = buildSplitWorkbook([basisQ, textQ], [row], 'qb', CTX);
    const ws1 = wb.getWorksheet('응답 내역')!;
    expect(ws1.getRow(1).getCell(1).value).toBe('시스템ID');
    expect(ws1.getRow(1).getCell(2).value).toBe('순번');
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
});
