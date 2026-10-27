import { describe, expect, it } from 'vitest';

import {
  type RawExportContext,
  type RawExportResponseRow,
  generateRawDataWorkbook,
} from '@/lib/analytics/raw-workbook';
import type { Question } from '@/types/survey';
import type { SurveyLocale } from '@/types/survey-locale';

/**
 * Raw Data 엑셀의 공유 변수명 (CONTEXT.md 「공유 변수명」, ADR 0034) — 언어판끼리 같은 변수명은
 * 한 열이고 헤더 제목·코딩북 라벨은 한국어판 것이다.
 */

const radio = (id: string, title: string, labels: string[], order: number): Question =>
  ({
    id,
    type: 'radio',
    title,
    required: false,
    order,
    questionCode: 'Q2',
    isCustomSpssVarName: true,
    options: labels.map((label, i) => ({ id: `${id}-o${i}`, label, value: String(i + 1) })),
  }) as Question;

const QUESTIONS: Question[] = [
  radio('ko-q2', '2. 지원사업을 활용하셨습니까?', ['활용함', '활용하지 않음'], 1),
  radio('zh-q2', '2. 您是否利用其他机构的支持项目?', ['是', '否'], 11),
  radio('en-q2', '2. Did you utilize support programs?', ['Yes', 'No'], 21),
];

const LOCALES = new Map<string, SurveyLocale>([
  ['ko-q2', 'ko'],
  ['zh-q2', 'zh'],
  ['en-q2', 'en'],
]);

const CTX: RawExportContext = {
  appUrl: '',
  stepLabels: new Map(),
  hasContacts: true,
  questionMeta: new Map(),
  languageSetLocales: LOCALES,
};

function row(id: string, questionResponses: Record<string, unknown>): RawExportResponseRow {
  return {
    id,
    questionResponses,
    resid: null,
    inviteCode: null,
    ipHash: null,
    currentStepId: null,
    platform: null,
    browser: null,
    status: 'completed',
    startedAt: new Date('2026-10-27T00:00:00Z'),
    completedAt: new Date('2026-10-27T00:05:00Z'),
    totalSeconds: 300,
  };
}

describe('generateRawDataWorkbook — 공유 변수명', () => {
  it('세 언어판의 같은 변수명이 한 열이고 제목은 한국어판, 값은 각자 언어판 보기 코드다', () => {
    const wb = generateRawDataWorkbook(
      QUESTIONS,
      [row('r-ko', { 'ko-q2': '1' }), row('r-zh', { 'zh-q2': '2' }), row('r-en', { 'en-q2': '1' })],
      CTX,
    );
    const ws = wb.getWorksheet('Raw Data')!;
    // 변수 열은 메타 10열 뒤 11열부터
    expect(ws.getRow(1).getCell(11).value).toBe('2. 지원사업을 활용하셨습니까?');
    expect(ws.getRow(3).getCell(11).value).toBe('Q2');
    expect(ws.getRow(3).getCell(12).value ?? null).toBeNull();
    expect([4, 5, 6].map((r) => ws.getRow(r).getCell(11).value)).toEqual([1, 2, 1]);
  });

  it('코딩북의 값 라벨도 한국어판이다', () => {
    const wb = generateRawDataWorkbook(QUESTIONS, [], CTX);
    const codebook = wb.getWorksheet('코딩북')!;
    const cells: string[] = [];
    codebook.eachRow((r) => r.eachCell((c) => cells.push(String(c.value ?? ''))));
    const text = cells.join('\n');
    expect(text).toContain('활용함');
    expect(text).not.toContain('是');
  });
});
