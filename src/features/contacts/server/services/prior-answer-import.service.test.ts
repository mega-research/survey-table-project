import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  scope: 'real' as 'real' | 'test',
  parsedRows: [] as Array<Record<string, string>>,
  questionRows: [] as Array<Record<string, unknown>>,
  targetRows: [] as Array<{ id: string; resid: number }>,
  insertedValues: [] as Array<Record<string, unknown>>,
  insertCalls: 0,
  targetWhere: null as unknown,
}));

vi.mock('@/lib/operations/data-scope.server', () => ({
  loadOperationsDataScope: vi.fn(async () => h.scope),
}));

vi.mock('@/lib/contacts/excel-parser', () => ({
  parseExcelRows: vi.fn(async () => h.parsedRows),
  previewExcel: vi.fn(async () => ({
    sheetNames: ['rawdata'],
    headers: ['ID', 'BQ1'],
    rows: [{ ID: '1', BQ1: '메가리서치' }],
    totalRows: 1,
  })),
}));

vi.mock('@/lib/contacts/upload-limits', () => ({
  MAX_UPLOAD_ROWS: 5000,
  validateXlsxFile: vi.fn(() => null),
}));

vi.mock('@/lib/crypto/response-pii', () => ({
  encryptAnswerValue: vi.fn((value: unknown) => `enc:${String(value)}`),
}));

vi.mock('@/db', () => {
  const selectChain: Record<string, unknown> = {};
  selectChain['from'] = () => selectChain;
  selectChain['innerJoin'] = () => selectChain;
  selectChain['where'] = (clause: unknown) => {
    h.targetWhere = clause;
    return selectChain;
  };
  selectChain['then'] = <R,>(resolve: (v: unknown) => R) => Promise.resolve(h.targetRows).then(resolve);

  const txInsertChain: Record<string, unknown> = {};
  const insertChain: Record<string, unknown> = {};
  insertChain['values'] = (values: Array<Record<string, unknown>>) => {
    h.insertCalls += 1;
    h.insertedValues = values;
    return insertChain;
  };
  insertChain['onConflictDoUpdate'] = async () => undefined;

  txInsertChain['values'] = insertChain['values'];
  txInsertChain['onConflictDoUpdate'] = async () => undefined;

  return {
    db: {
      query: { questions: { findMany: async () => h.questionRows } },
      select: () => selectChain,
      insert: () => insertChain,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ insert: () => txInsertChain }),
    },
  };
});

import { importPriorAnswers } from './prior-answer-import.service';

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

function file(): File {
  return new File([new Uint8Array([1])], 'prior.xlsx');
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    surveyId: SURVEY_ID,
    file: file(),
    sheetName: 'rawdata',
    headerRow: 1,
    residColumnKey: 'ID',
    mapping: { BQ1: 'q-text' },
    ...overrides,
  } as Parameters<typeof importPriorAnswers>[0];
}

describe('importPriorAnswers', () => {
  beforeEach(() => {
    h.scope = 'real';
    h.insertCalls = 0;
    h.insertedValues = [];
    h.targetWhere = null;
    h.questionRows = [
      { id: 'q-text', type: 'text', title: '기업명', order: 1, questionCode: 'BQ1' },
    ];
    h.parsedRows = [{ ID: '7', BQ1: '메가리서치' }];
    h.targetRows = [{ id: 'target-7', resid: 7 }];
  });

  it('시스템ID 로 조사 대상을 찾아 이월 응답을 붙인다', async () => {
    const result = await importPriorAnswers(baseInput());
    expect(result.matched).toBe(1);
    expect(h.insertedValues).toEqual([
      { contactTargetId: 'target-7', answers: { 'q-text': '메가리서치' } },
    ]);
  });

  it('명단에서 찾지 못한 번호는 조용히 사라지지 않는다', async () => {
    h.targetRows = [];
    const result = await importPriorAnswers(baseInput());
    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(1);
    expect(result.unmatchedResids).toEqual(['7']);
    expect(h.insertCalls).toBe(0);
  });

  it('숫자가 아닌 시스템ID 는 조회에 넣지 않고 미매칭으로 남긴다', async () => {
    h.parsedRows = [{ ID: 'A-7', BQ1: '메가리서치' }];
    const result = await importPriorAnswers(baseInput());
    expect(result.unmatchedResids).toEqual(['A-7']);
    expect(h.insertCalls).toBe(0);
  });

  it('dryRun 이면 계산만 하고 쓰지 않는다', async () => {
    const result = await importPriorAnswers(baseInput({ dryRun: true }));
    expect(result.matched).toBe(1);
    expect(h.insertCalls).toBe(0);
  });

  it('PII 문항 값은 저장 직전 암호화한다', async () => {
    h.questionRows = [
      { id: 'q-text', type: 'text', title: '기업명', order: 1, questionCode: 'BQ1', piiEncrypted: true },
    ];
    await importPriorAnswers(baseInput());
    expect(h.insertedValues[0]?.['answers']).toEqual({ 'q-text': 'enc:메가리서치' });
  });

  it('이월 값이 하나도 들어가지 않은 문항을 알려준다', async () => {
    h.parsedRows = [{ ID: '7', BQ1: '' }];
    const result = await importPriorAnswers(baseInput());
    expect(result.questionsWithoutValues).toEqual(['q-text']);
    expect(result.parsedTargets).toBe(0);
  });

  it('앞뒤 0 이 붙은 같은 번호를 한 대상으로 접어 적재가 통째로 죽지 않는다', async () => {
    // 같은 contactTargetId 가 한 배치에 두 번 실리면 PG 가 ON CONFLICT 를 거부한다(21000).
    h.parsedRows = [
      { ID: '07', BQ1: '먼저' },
      { ID: '7', BQ1: '나중' },
    ];
    const result = await importPriorAnswers(baseInput());
    expect(result.matched).toBe(1);
    expect(h.insertedValues).toEqual([
      { contactTargetId: 'target-7', answers: { 'q-text': '나중' } },
    ]);
  });

  it('잇지 않은 컬럼을 목록으로 낸다', async () => {
    h.parsedRows = [{ ID: '7', BQ1: '메가리서치', 비고: '아무거나' }];
    const result = await importPriorAnswers(baseInput());
    expect(result.unmappedColumns).toEqual(['비고']);
  });
});
