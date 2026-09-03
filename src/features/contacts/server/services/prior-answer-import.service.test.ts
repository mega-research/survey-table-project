import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * drizzle SQL 조각을 문자열로 눌러 검증에 쓴다.
 *
 * `queryChunks` 만 따라간다 — 컬럼 객체를 통째로 훑으면 `.table` 역참조를 타고 들어가
 * 그 테이블의 **모든 컬럼명**이 출력에 섞여, "이 컬럼을 쓰는가" 검증이 공허해진다.
 */
function sqlText(node: unknown, seen = new Set<unknown>()): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (typeof node !== 'object' || seen.has(node)) return '';
  seen.add(node);
  if (Array.isArray(node)) return node.map((item) => sqlText(item, seen)).join(' ');
  const record = node as Record<string, unknown>;
  if (Array.isArray(record['queryChunks'])) return sqlText(record['queryChunks'], seen);
  if (typeof record['value'] === 'string') return record['value'];
  if (Array.isArray(record['value'])) return sqlText(record['value'], seen);
  return '';
}

/**
 * `eq(컬럼, 값)` 절에서 그 컬럼에 실제로 바인딩된 값을 꺼낸다.
 * 컬럼 이름만 보면 `eq(isTest, false)` 로 파티션을 고정해버린 회귀를 놓친다.
 */
function boundValueOf(node: unknown, columnName: string): unknown {
  const stack: unknown[] = [node];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const chunks = (current as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(chunks)) {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i] as { name?: unknown } | undefined;
        if (chunk && typeof chunk === 'object' && chunk.name === columnName) {
          for (let j = i + 1; j < chunks.length; j++) {
            const candidate = chunks[j] as { value?: unknown } | undefined;
            // 연산자 조각(StringChunk)은 value 가 문자열 배열이다 — 바인딩 값만 고른다.
            if (
              candidate &&
              typeof candidate === 'object' &&
              'value' in candidate &&
              !Array.isArray(candidate.value)
            ) {
              return candidate.value;
            }
          }
        }
      }
      stack.push(...chunks);
      continue;
    }
    for (const value of Object.values(current as Record<string, unknown>)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return undefined;
}

const h = vi.hoisted(() => ({
  scope: 'real' as 'real' | 'test',
  headerRows: [] as string[][],
  parsedRows: [] as string[][],
  questionRows: [] as Array<Record<string, unknown>>,
  targetRows: [] as Array<{ id: string; resid: number }>,
  insertedValues: [] as Array<Record<string, unknown>>,
  insertCalls: 0,
  targetWhere: null as unknown,
  surveyConfig: null as unknown,
  updatedConfig: null as unknown,
  /** 쓰기가 어느 테이블로 갔는가 — 재업로드가 이웃을 건드리지 않는지 본다. */
  writtenTables: [] as string[],
  conflictSet: null as unknown,
}));

/** drizzle 테이블 객체에서 이름을 꺼낸다 (mock 검증용). */
function tableName(table: unknown): string {
  const symbols = Object.getOwnPropertySymbols(table ?? {});
  for (const symbol of symbols) {
    if (String(symbol).includes('Name')) {
      const value = (table as Record<symbol, unknown>)[symbol];
      if (typeof value === 'string') return value;
    }
  }
  return 'unknown';
}

vi.mock('@/lib/operations/data-scope.server', () => ({
  loadOperationsDataScope: vi.fn(async () => h.scope),
}));

vi.mock('@/lib/contacts/excel-parser', () => ({
  previewExcelGrid: vi.fn(async (_buffer: unknown, opts: { maxRows?: number }) => ({
    sheetNames: ['rawdata'],
    headerRows: h.headerRows,
    // 실제 파서처럼 maxRows 를 지킨다 — 제안 단계가 몇 행을 표본으로 읽는지가 곧 검증 대상이다.
    rows: opts.maxRows === undefined ? h.parsedRows : h.parsedRows.slice(0, opts.maxRows),
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
  insertChain['onConflictDoUpdate'] = async (config: { set?: unknown }) => {
    h.conflictSet = config?.set;
  };

  txInsertChain['values'] = insertChain['values'];
  txInsertChain['onConflictDoUpdate'] = insertChain['onConflictDoUpdate'];

  return {
    db: {
      query: { questions: { findMany: async () => h.questionRows } },
      select: () => selectChain,
      update: (table: unknown) => {
        h.writtenTables.push(tableName(table));
        return updateChain;
      },
      delete: (table: unknown) => {
        h.writtenTables.push(`delete:${tableName(table)}`);
        return { where: async () => undefined };
      },
      insert: (table: unknown) => {
        h.writtenTables.push(tableName(table));
        return insertChain;
      },
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          insert: (table: unknown) => {
            h.writtenTables.push(tableName(table));
            return txInsertChain;
          },
        }),
    },
  };
});

import { previewExcelGrid } from '@/lib/contacts/excel-parser';

import {
  PREVIEW_ROWS,
  SUGGEST_SAMPLE_ROWS,
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
    h.writtenTables = [];
    h.conflictSet = null;
    h.questionRows = [
      { id: 'q-text', type: 'text', title: '기업명', order: 1, questionCode: 'BQ1' },
    ];
    h.headerRows = [['ID', 'BQ1']];
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

describe('재업로드 안전성', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 스코프를 여기서 되돌린다 — 테스트 본문 끝에서 되돌리면 실패 시 다음 describe 로 샌다.
    h.scope = 'real';
    h.writtenTables = [];
    h.conflictSet = null;
    h.surveyConfig = null;
    h.questionRows = [
      { id: 'q-text', type: 'text', title: '기업명', order: 1, questionCode: 'BQ1' },
    ];
    h.headerRows = [['ID', 'BQ1']];
    h.parsedRows = [['7', '메가리서치']];
    h.targetRows = [{ id: 'target-7', resid: 7 }];
  });

  it('조사 대상과 응답 테이블을 건드리지 않는다 — 개별 링크와 수집된 응답이 그대로다', async () => {
    await importPriorAnswers(baseInput());
    // 쓰기는 이월 응답 테이블 하나뿐이다.
    expect(h.writtenTables).toEqual(['contact_prior_answers']);
  });

  it('다시 올리면 그 대상의 이월 응답이 통째로 교체된다 — 이전 임포트의 잔여 값이 남지 않는다', async () => {
    await importPriorAnswers(baseInput());
    // 병합(`||`)이 아니라 통째 대입이어야 지난 임포트의 문항 키가 남지 않는다.
    // `toContain('excluded.answers')` 만 보면 `answers || excluded.answers` 도 통과한다.
    const answersSql = sqlText((h.conflictSet as { answers?: unknown })?.answers).trim();
    expect(answersSql).toBe('excluded.answers');
  });

  it('값이 하나도 살아남지 않으면 아무것도 쓰지 않는다 — 지난 임포트가 그대로 남는다', async () => {
    // 매핑을 잘못 잡아 변환이 전부 실패했을 때 지난 임포트를 날려버리면 복구가 없다.
    // 쓰기 자체가 일어나지 않는 것이 그 보장이다(빈 묶음으로 덮지도, 지우지도 않는다).
    h.parsedRows = [['7', '']];
    await importPriorAnswers(baseInput());
    expect(h.writtenTables).toEqual([]);
  });

  it('테스트 모드에서는 테스트 조사 대상만 본다 — 실 대상과 섞이지 않는다', async () => {
    h.scope = 'test';
    await importPriorAnswers(baseInput());
    // 컬럼 이름만 보면 `eq(isTest, false)` 로 고정해버린 회귀를 놓친다 — 값까지 본다.
    expect(boundValueOf(h.targetWhere, 'is_test')).toBe(true);
  });

  it('실 모드에서는 실 조사 대상만 본다', async () => {
    h.scope = 'real';
    await importPriorAnswers(baseInput());
    expect(boundValueOf(h.targetWhere, 'is_test')).toBe(false);
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

describe('suggestPriorAnswerImportMapping — 값 기반 오매핑 방지', () => {
  function suggestInput() {
    return { surveyId: SURVEY_ID, file: file(), sheetName: 'rawdata', headerRowCount: 2 } as Parameters<
      typeof suggestPriorAnswerImportMapping
    >[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    h.surveyConfig = null;
    // 2025 HQ1.(과정 도움도) 열 — 2026 HQ1 은 창업 의향(예/아니오)이다.
    h.headerRows = [['HQ1.'], ['(과정 도움도)']];
    h.parsedRows = [...Array.from({ length: 8 }, () => ['매우 도움됨']), ...Array.from({ length: 4 }, () => ['도움됨'])];
    h.questionRows = [
      {
        id: 'q-intent',
        type: 'radio',
        title: 'HQ1. 귀하는 향후 창업하실 의향이 있으신가요?',
        order: 1,
        questionCode: 'HQ1',
        options: [
          { id: 'y', value: '1', label: '① 예' },
          { id: 'n', value: '2', label: '② 아니오' },
        ],
      },
    ];
  });

  it('코드는 같은데 값이 보기와 맞지 않으면 value-conflict 와 사유를 응답에 싣는다', async () => {
    const res = await suggestPriorAnswerImportMapping(suggestInput());
    const block = res.blocks[0];
    expect(block?.verdict).toBe('value-conflict');
    expect(block?.questionId).toBeNull();
    expect(block?.conflictQuestionId).toBe('q-intent');
    expect(block?.verdictReason).toContain('표본 12건 중 보기와 맞는 값 0건');
  });

  it('보관된 값 대응이 있으면 적합도에 들어가 auto 가 된다', async () => {
    h.surveyConfig = { blockMappings: {}, valueAliases: { 'q-intent': { '매우 도움됨': '1' } } };
    const res = await suggestPriorAnswerImportMapping(suggestInput());
    expect(res.blocks[0]?.verdict).toBe('auto');
    expect(res.blocks[0]?.verdictReason).toBeNull();
  });

  it('지난 확정 복원은 이 게이트를 타지 않는다 — 담당자가 이미 판단한 것', async () => {
    h.surveyConfig = { blockMappings: { hq1: { questionId: 'q-intent', label: '' } }, valueAliases: {} };
    const res = await suggestPriorAnswerImportMapping(suggestInput());
    const block = res.blocks[0];
    expect(block?.fromSavedConfig).toBe(true);
    expect(block?.verdict).toBe('auto');
    expect(block?.questionId).toBe('q-intent');
    expect(block?.verdictReason).toBeNull();
    expect(block?.conflictQuestionId).toBeNull();
  });
});

/** 2026 BQ1_1 의 "담당 직무" 두 행 — 세부 라벨 "담당 직무" 가 접두로 두 행에 걸려 표본값으로 갈라야 한다. */
function jobTableQuestion(): Record<string, unknown> {
  return {
    id: 'q-table',
    type: 'table',
    title: '귀하의 현재 취업 상태에 대해 몇 가지 질문드립니다.',
    order: 1,
    questionCode: 'BQ1_1',
    tableColumns: [{ id: 'c0', label: '라벨' }, { id: 'c1', label: '값' }],
    tableRowsData: [
      {
        id: 'r-it',
        label: '담당 직무_① IT/SW 관련 세부분야',
        cells: [
          { id: 'it-label', type: 'text', content: '' },
          { id: 'it', type: 'radio', content: '', radioOptions: [{ id: 'o1', value: '1', label: '① 정보기술 개발' }] },
        ],
      },
      {
        id: 'r-non',
        label: '담당 직무_② 비 IT/SW 관련 분야',
        cells: [
          { id: 'non-label', type: 'text', content: '' },
          { id: 'non', type: 'input', content: '' },
        ],
      },
    ],
  };
}

const JOB_HEADER_ROWS: string[][] = [
  ['', 'PART B.'],
  ['ID', 'BQ1-1.'],
  ['시스템ID', '담당 직무'],
];

function suggestJobInput() {
  return { surveyId: SURVEY_ID, file: file(), sheetName: 'rawdata', headerRowCount: 3 } as Parameters<
    typeof suggestPriorAnswerImportMapping
  >[0];
}

describe('suggestPriorAnswerImportMapping — 칸 배정 사유', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.surveyConfig = null;
    h.questionRows = [jobTableQuestion()];
    h.headerRows = JOB_HEADER_ROWS;
  });

  it('후보 행이 여럿인데 표본값으로 못 가르면 사유가 칸 배정 줄에 실린다', async () => {
    h.parsedRows = [['7', '영업']];
    const res = await suggestPriorAnswerImportMapping(suggestJobInput());
    const block = res.blocks.find((b) => b.code === 'BQ1-1.');
    expect(block?.questionId).toBe('q-table');
    expect(block?.unmatchedSlots).toBe(1);
    // 행 나열은 마법사의 슬롯 구분자 ' / ' 와 겹치지 않는 형태여야 "칸 배정:" 한 줄에서 읽힌다.
    expect(block?.slotLabels).toEqual([
      '배정 안 됨 — 후보 2행("담당 직무_① IT/SW 관련 세부분야", "담당 직무_② 비 IT/SW 관련 분야") — 표본값 "영업" 으로 못 가름',
    ]);
  });

  it('표본값이 한 행의 보기에 맞으면 그 행으로 배정된다', async () => {
    h.parsedRows = [['7', '정보기술 개발']];
    const res = await suggestPriorAnswerImportMapping(suggestJobInput());
    const block = res.blocks.find((b) => b.code === 'BQ1-1.');
    expect(block?.unmatchedSlots).toBe(0);
    expect(block?.slotLabels).toEqual(['담당 직무_① IT/SW 관련 세부분야']);
  });
});

describe('suggestPriorAnswerImportMapping — 표본 범위는 적재와 같다', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.scope = 'real';
    h.surveyConfig = null;
    h.insertCalls = 0;
    h.insertedValues = [];
    h.questionRows = [jobTableQuestion()];
    h.headerRows = JOB_HEADER_ROWS;
    h.targetRows = [{ id: 'target-7', resid: 7 }];
  });

  it('첫 다섯 행이 빈 열도 뒤 행의 값으로 갈라 미리보기와 적재가 같은 칸에 붙는다', async () => {
    // 2025 CQ1 담당 직무: 비어 있지 않은 행이 1,836 중 32 뿐이라 첫 다섯 행이 전부 빈칸이다.
    // 표본을 다섯 행만 보면 미리보기는 "표본값 없음" 미배정이라 마법사가 "그 칸의 값은 들어가지
    // 않습니다" 라고 안내하는데, 적재는 전량 표본으로 radio 행에 32건을 넣었다 — 두 경로가 갈렸다.
    h.parsedRows = [['', ''], ['', ''], ['', ''], ['', ''], ['', ''], ['7', '정보기술 개발']];

    const res = await suggestPriorAnswerImportMapping(suggestJobInput());
    const block = res.blocks.find((b) => b.code === 'BQ1-1.');
    expect(block?.unmatchedSlots).toBe(0);
    expect(block?.slotLabels).toEqual(['담당 직무_① IT/SW 관련 세부분야']);

    const imported = await importPriorAnswers(baseInput({ headerRowCount: 3, mapping: { '1': 'q-table' } }));
    expect(imported.matched).toBe(1);
    expect(h.insertedValues[0]?.['answers']).toEqual({ 'q-table': { it: '1' } });
  });

  it('제안 단계는 적재 상한까지 표본을 읽고, 화면에는 첫 다섯 행만 돌려준다', async () => {
    h.parsedRows = [['', ''], ['', ''], ['', ''], ['', ''], ['', ''], ['7', '정보기술 개발'], ['8', '']];
    const res = await suggestPriorAnswerImportMapping(suggestJobInput());
    // 숫자 리터럴이 아니라 서비스의 상수와 대조한다 — 상수가 적재 상한에서 떨어지면 여기서 드러난다.
    expect(vi.mocked(previewExcelGrid).mock.calls[0]?.[1]).toMatchObject({ maxRows: SUGGEST_SAMPLE_ROWS });
    expect(res.rows).toHaveLength(PREVIEW_ROWS);
    expect(res.totalRows).toBe(7);
    expect(res.blocks.find((b) => b.code === 'BQ1-1.')?.unmatchedSlots).toBe(0);
  });

  it('적재는 maxRows 없이 전량을 읽는다 — 기존 동작 고정', async () => {
    h.parsedRows = [['7', '정보기술 개발']];
    await importPriorAnswers(baseInput({ headerRowCount: 3, mapping: { '1': 'q-table' } }));
    const opts = vi.mocked(previewExcelGrid).mock.calls[0]?.[1];
    expect(opts).toBeDefined();
    expect(opts).not.toHaveProperty('maxRows');
  });
});
