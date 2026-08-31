import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  scope: 'real' as 'real' | 'test',
  headerRows: [] as string[][],
  codeRowMerged: undefined as boolean[] | undefined,
  parsedRows: [] as string[][],
  questionRows: [] as Array<Record<string, unknown>>,
  targetRows: [] as Array<{ id: string; resid: number }>,
  insertedValues: [] as Array<Record<string, unknown>>,
  insertCalls: 0,
  targetWhere: null as unknown,
  surveyConfig: null as unknown,
  updatedConfig: null as unknown,
}));

vi.mock('@/lib/operations/data-scope.server', () => ({
  loadOperationsDataScope: vi.fn(async () => h.scope),
}));

vi.mock('@/lib/contacts/excel-parser', () => ({
  previewExcelGrid: vi.fn(async () => ({
    sheetNames: ['rawdata'],
    headerRows: h.headerRows,
    codeRowMerged: h.codeRowMerged,
    rows: h.parsedRows,
    totalRows: h.parsedRows.length,
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
  // surveys 설정 조회는 .limit(1) 로 끝나고, contact_targets 조회는 thenable 로 끝난다.
  const selectChain: Record<string, unknown> = {};
  selectChain['from'] = () => selectChain;
  selectChain['innerJoin'] = () => selectChain;
  selectChain['where'] = (clause: unknown) => {
    h.targetWhere = clause;
    return selectChain;
  };
  selectChain['limit'] = async () => [{ config: h.surveyConfig }];
  selectChain['then'] = <R,>(resolve: (v: unknown) => R) => Promise.resolve(h.targetRows).then(resolve);

  const updateChain: Record<string, unknown> = {};
  updateChain['set'] = (values: Record<string, unknown>) => {
    h.updatedConfig = values['priorAnswerImportConfig'];
    return updateChain;
  };
  updateChain['where'] = () => updateChain;
  updateChain['returning'] = async () => [{ id: 'survey-1' }];

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
      update: () => updateChain,
      insert: () => insertChain,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ insert: () => txInsertChain }),
    },
  };
});

import {
  importPriorAnswers,
  savePriorAnswerImportConfig,
  suggestPriorAnswerImportMapping,
} from './prior-answer-import.service';

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

function file(): File {
  return new File([new Uint8Array([1])], 'prior.xlsx');
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    surveyId: SURVEY_ID,
    file: file(),
    sheetName: 'rawdata',
    headerRowCount: 1,
    residColumnIndex: 0,
    // 블록 번호 1 = 두 번째 컬럼(BQ1)
    mapping: { '1': 'q-text' },
    ...overrides,
  } as Parameters<typeof importPriorAnswers>[0];
}

describe('importPriorAnswers', () => {
  beforeEach(() => {
    h.scope = 'real';
    h.insertCalls = 0;
    h.insertedValues = [];
    h.targetWhere = null;
    h.surveyConfig = null;
    h.updatedConfig = null;
    h.questionRows = [
      { id: 'q-text', type: 'text', title: '기업명', order: 1, questionCode: 'BQ1' },
    ];
    h.headerRows = [['ID', 'BQ1']];
    h.codeRowMerged = undefined;
    h.parsedRows = [['7', '메가리서치']];
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
    h.parsedRows = [['A-7', '메가리서치']];
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
    h.parsedRows = [['7', '']];
    const result = await importPriorAnswers(baseInput());
    expect(result.questionsWithoutValues).toEqual(['q-text']);
    expect(result.parsedTargets).toBe(0);
  });

  it('앞뒤 0 이 붙은 같은 번호를 한 대상으로 접어 적재가 통째로 죽지 않는다', async () => {
    // 같은 contactTargetId 가 한 배치에 두 번 실리면 PG 가 ON CONFLICT 를 거부한다(21000).
    h.parsedRows = [
      ['07', '먼저'],
      ['7', '나중'],
    ];
    const result = await importPriorAnswers(baseInput());
    expect(result.matched).toBe(1);
    expect(h.insertedValues).toEqual([
      { contactTargetId: 'target-7', answers: { 'q-text': '나중' } },
    ]);
  });

  it('요청에 실린 값 대응은 저장 없이도 결과에 반영된다', async () => {
    h.questionRows = [
      {
        id: 'q-need',
        type: 'radio',
        title: '창업지원 필요여부',
        order: 1,
        questionCode: 'BQ1',
        options: [{ id: 'n2', value: 'some', label: '어느 정도 필요' }],
      },
    ];
    h.parsedRows = [['7', '다소 필요']];
    h.surveyConfig = null;

    const result = await importPriorAnswers(
      baseInput({
        mapping: { '1': 'q-need' },
        valueAliases: { 'q-need': { '다소 필요': 'some' } },
        dryRun: true,
      }),
    );
    expect(result.optionMismatches).toEqual([]);
    expect(h.updatedConfig).toBeNull();
  });

  it('확정된 값 대응이 있으면 라벨이 바뀐 값도 들어간다', async () => {
    h.questionRows = [
      {
        id: 'q-need',
        type: 'radio',
        title: '창업지원 필요여부',
        order: 1,
        questionCode: 'BQ1',
        options: [{ id: 'n2', value: 'some', label: '어느 정도 필요' }],
      },
    ];
    h.parsedRows = [['7', '다소 필요']];
    h.surveyConfig = { blockMappings: {}, valueAliases: { 'q-need': { '다소 필요': 'some' } } };

    const result = await importPriorAnswers(baseInput({ mapping: { '1': 'q-need' } }));
    expect(result.optionMismatches).toEqual([]);
    expect(h.insertedValues[0]?.['answers']).toEqual({ 'q-need': 'some' });
  });

  it('형태가 깨진 확정 설정은 빈 설정으로 흡수한다', async () => {
    h.surveyConfig = { blockMappings: 'nope', valueAliases: [1, 2] };
    const result = await importPriorAnswers(baseInput());
    expect(result.matched).toBe(1);
  });

  it('3단 헤더의 표 문항 블록이 칸 단위로 한 번에 붙는다', async () => {
    h.questionRows = [
      {
        id: 'q-table',
        type: 'table',
        title: '창업 기업 현황',
        order: 1,
        questionCode: 'BQ2',
        tableColumns: [{ id: 'c0', label: '항목' }, { id: 'c1', label: '값' }],
        tableRowsData: [
          {
            id: 'r1',
            label: '대표자',
            cells: [
              { id: 'cell-r1c0', type: 'text', content: '대표자' },
              { id: 'cell-r1c1', type: 'input', content: '' },
            ],
          },
          {
            id: 'r2',
            label: '업종',
            cells: [
              { id: 'cell-r2c0', type: 'text', content: '업종' },
              { id: 'cell-r2c1', type: 'input', content: '' },
            ],
          },
        ],
      },
    ];
    h.headerRows = [
      ['', 'Ⅰ. 창업 현황', ''],
      ['ID', 'BQ2', ''],
      ['시스템ID', '대표자', '업종'],
    ];
    h.codeRowMerged = [false, false, true];
    h.parsedRows = [['7', '홍길동', '제조업']];

    const result = await importPriorAnswers(
      baseInput({ headerRowCount: 3, mapping: { '1': 'q-table' } }),
    );

    expect(result.matched).toBe(1);
    expect(h.insertedValues[0]?.['answers']).toEqual({
      'q-table': { 'cell-r1c1': '홍길동', 'cell-r2c1': '제조업' },
    });
  });

  it('잇지 않은 블록을 목록으로 낸다', async () => {
    h.headerRows = [['ID', 'BQ1', '비고']];
    h.parsedRows = [['7', '메가리서치', '아무거나']];
    const result = await importPriorAnswers(baseInput());
    // 블록 0(ID)·2(비고)는 문항에 잇지 않았다.
    expect(result.unmappedColumns).toEqual(['ID', '비고']);
  });
});

describe('savePriorAnswerImportConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.updatedConfig = null;
    h.surveyConfig = null;
  });

  it('보관된 확정을 통째로 덮지 않고 병합한다', async () => {
    // 191개 매핑을 여러 번에 걸쳐 맞추는 것이 정상 경로라, 이번 파일에 없는 블록의
    // 확정이 사라지면 그 자체로 기능 상실이다.
    h.surveyConfig = {
      blockMappings: { bq9: { questionId: 'q-old', label: '지난 문항' } },
      valueAliases: { 'q-old': { 예전값: 'old' } },
    };
    await savePriorAnswerImportConfig({
      surveyId: SURVEY_ID,
      blockMappings: { bq1: { questionId: 'q-text', label: '창업 기업명' } },
      valueAliases: { 'q-text': { 새값: 'new' } },
    });
    expect(h.updatedConfig).toEqual({
      blockMappings: {
        bq9: { questionId: 'q-old', label: '지난 문항' },
        bq1: { questionId: 'q-text', label: '창업 기업명' },
      },
      valueAliases: { 'q-old': { 예전값: 'old' }, 'q-text': { 새값: 'new' } },
    });
  });

  it('확정 매핑과 값 대응을 정규화해 보관한다', async () => {
    await savePriorAnswerImportConfig({
      surveyId: SURVEY_ID,
      blockMappings: {
        bq1: { questionId: 'q-text', label: '창업 기업명' },
        bq2: { questionId: '', label: '' },
      },
      valueAliases: { 'q-text': { '다소 필요': 'some', 빈값: '' } },
    });
    expect(h.updatedConfig).toEqual({
      blockMappings: { bq1: { questionId: 'q-text', label: '창업 기업명' } },
      valueAliases: { 'q-text': { '다소 필요': 'some' } },
    });
  });
});

describe('suggestPriorAnswerImportMapping — 확정 복원', () => {
  function suggestInput() {
    return { surveyId: SURVEY_ID, file: file(), sheetName: 'rawdata', headerRowCount: 1 } as Parameters<
      typeof suggestPriorAnswerImportMapping
    >[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    h.codeRowMerged = undefined;
    h.parsedRows = [];
    h.questionRows = [
      { id: 'q-sat', type: 'radio', title: '창업 지원 만족도', order: 1, questionCode: 'BQ7' },
      { id: 'q-intent', type: 'radio', title: '창업 의향', order: 2, questionCode: 'BQ8' },
    ];
  });

  it('지난 확정이 있으면 자동 제안보다 우선한다', async () => {
    h.headerRows = [['BQ7. 창업 지원 만족도']];
    h.surveyConfig = {
      blockMappings: { bq7: { questionId: 'q-intent', label: '창업 지원 만족도' } },
      valueAliases: {},
    };
    const res = await suggestPriorAnswerImportMapping(suggestInput());
    expect(res.blocks[0]?.questionId).toBe('q-intent');
    expect(res.blocks[0]?.fromSavedConfig).toBe(true);
  });

  it('확정 시점과 문항 내용이 어긋나면 되살리지 않고 경고를 남긴다', async () => {
    // 파트가 재편돼 BQ7 자리에 다른 문항이 들어온 파일 — 지난 확정이 부활하면
    // "코드는 같은데 내용이 다르다" 경고가 사라진다.
    h.headerRows = [['BQ7. 창업 의향이 있으십니까']];
    h.surveyConfig = {
      blockMappings: { bq7: { questionId: 'q-sat', label: '창업 지원 만족도' } },
      valueAliases: {},
    };
    const res = await suggestPriorAnswerImportMapping(suggestInput());
    expect(res.blocks[0]?.fromSavedConfig).toBe(false);
    expect(res.blocks[0]?.verdict).toBe('code-conflict');
    expect(res.blocks[0]?.questionId).toBeNull();
  });

  it('보관된 값 대응을 화면으로 돌려준다 — 시드가 없으면 재사용이 끊긴다', async () => {
    h.headerRows = [['BQ7']];
    h.surveyConfig = {
      blockMappings: {},
      valueAliases: { 'q-sat': { '다소 필요': 'some' } },
    };
    const res = await suggestPriorAnswerImportMapping(suggestInput());
    expect(res.savedValueAliases).toEqual({ 'q-sat': { '다소 필요': 'some' } });
  });
});
