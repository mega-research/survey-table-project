import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { generateRawDataWorkbook, type RawExportResponseRow } from '@/lib/excel-transformer';
import type { Question } from '@/types/survey';

const radioQ = {
  id: 'q1', type: 'radio', title: 'Q1. 성별', order: 1, required: false,
  questionCode: 'Q1',
  options: [
    { id: 'a', label: '남성', value: 'opt1', spssNumericCode: 1 },
    { id: 'b', label: '여성', value: 'opt2', spssNumericCode: 2 },
  ],
} as unknown as Question;

const baseRow = (over: Partial<RawExportResponseRow>): RawExportResponseRow => ({
  id: 'r1', questionResponses: {}, groupValue: null, resid: null,
  platform: 'desktop', browser: 'Chrome', status: 'completed',
  startedAt: new Date('2026-06-03T05:30:00Z'), completedAt: new Date('2026-06-03T05:40:00Z'),
  totalSeconds: 600, ...over,
});

function sheetAOA(wb: XLSX.WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: true }) as unknown[][];
}

describe('generateRawDataWorkbook', () => {
  it('3개 시트를 생성한다', () => {
    const wb = generateRawDataWorkbook([radioQ], [baseRow({})], 'sequence');
    expect(wb.SheetNames).toEqual(['응답 내역', 'Raw Data', '코딩북']);
  });

  it('공공(sequence)은 첫 컬럼 헤더가 순번이고 1부터 매긴다', () => {
    const rows = [baseRow({ id: 'a' }), baseRow({ id: 'b' })];
    const wb = generateRawDataWorkbook([radioQ], rows, 'sequence');
    const aoa = sheetAOA(wb, '응답 내역');
    expect(aoa[0][0]).toBe('순번');
    expect(aoa[1][0]).toBe(1);
    expect(aoa[2][0]).toBe(2);
  });

  it('토큰(systemId)은 첫 컬럼 헤더가 systemID이고 resid 값을 쓴다', () => {
    const wb = generateRawDataWorkbook([radioQ], [baseRow({ resid: 77 })], 'systemId');
    const aoa = sheetAOA(wb, '응답 내역');
    expect(aoa[0][0]).toBe('systemID');
    expect(aoa[1][0]).toBe(77);
  });

  it('Raw Data 시트는 헤더 3행(질문제목/셀라벨/변수명) 후 코드값', () => {
    const row = baseRow({ questionResponses: { q1: 'opt2' } });
    const wb = generateRawDataWorkbook([radioQ], [row], 'sequence');
    const aoa = sheetAOA(wb, 'Raw Data');
    expect(aoa[0][0]).toBe('순번');
    expect(aoa[0][1]).toBe('Q1. 성별');
    expect(aoa[1][1]).toBe('');
    expect(aoa[2][1]).toBe('Q1');
    expect(aoa[3][0]).toBe(1);
    expect(aoa[3][1]).toBe(2);
  });

  it('코딩북 시트는 변수명/값라벨을 담는다', () => {
    const wb = generateRawDataWorkbook([radioQ], [baseRow({})], 'sequence');
    const aoa = sheetAOA(wb, '코딩북');
    expect(aoa[0]).toEqual(['변수번호', 'SPSS 변수명', '질문 제목', '셀라벨', '값 라벨']);
    const q1 = aoa.find((r) => r[1] === 'Q1');
    expect(q1?.[4]).toBe('1=남성, 2=여성');
  });
});
