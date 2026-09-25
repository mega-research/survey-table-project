import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  initialScope: 'real' as 'real' | 'test',
  lockedTestMode: false,
  deleteWheres: [] as unknown[],
  targetInsertValues: [] as Array<Record<string, unknown>>,
  rows: [{ 회사명: '아크미' }] as Array<Record<string, string>>,
  /** 묶음(2행 이상) INSERT 를 실패시킨다 — 행 단위 재시도 경로 검증용 */
  failBatchInsert: false,
  /** 이 회사명을 가진 행은 한 행씩 넣어도 실패한다 */
  failRowCompany: null as string | null,
}));

vi.mock('@/server/data-scope', () => ({
  loadOperationsDataScope: vi.fn(async () => h.initialScope),
}));

vi.mock('./excel-parser', () => ({
  parseExcelRows: vi.fn(async () => h.rows),
  previewExcel: vi.fn(),
}));

vi.mock('@/lib/crypto/contact-pii-repo', () => ({
  buildPiiRows: vi.fn(() => []),
  insertPiiRows: vi.fn(async () => undefined),
}));

vi.mock('@/db', () => {
  function sqlText(value: unknown, seen = new Set<unknown>()): string {
    if (value == null || typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    const record = value as Record<string, unknown>;
    const own = Array.isArray(record['value'])
      ? (record['value'] as unknown[]).filter((item) => typeof item === 'string').join(' ')
      : '';
    const chunks = Array.isArray(record['queryChunks'])
      ? (record['queryChunks'] as unknown[]).map((chunk) => sqlText(chunk, seen)).join(' ')
      : '';
    return `${own} ${chunks}`;
  }

  function thenable<T>(value: T) {
    return { then: <R>(resolve: (resolved: T) => R) => Promise.resolve(value).then(resolve) };
  }

  const tx: Record<string, unknown> = {};
  tx['execute'] = vi.fn(async (query: unknown) => {
    const text = sqlText(query).toLowerCase();
    if (text.includes('for update')) {
      return [{ test_mode_enabled: h.lockedTestMode }];
    }
    if (text.includes('next_contact_resid')) return [{ resid: 1 }];
    throw new Error(`예상하지 못한 SQL: ${text}`);
  });
  tx['delete'] = vi.fn(() => ({
    where: (where: unknown) => {
      h.deleteWheres.push(where);
      return thenable(undefined);
    },
  }));
  tx['insert'] = vi.fn((table: Record<PropertyKey, unknown>) => {
    const tableName = table[Symbol.for('drizzle:Name')];
    return {
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const list = Array.isArray(values) ? values : [values];
        if (tableName === 'contact_targets') {
          if (h.failBatchInsert && list.length > 1) throw new Error('batch 실패');
          const attrs = list[0]?.['attrs'] as Record<string, string> | undefined;
          if (list.length === 1 && h.failRowCompany != null && attrs?.['회사명'] === h.failRowCompany) {
            throw new Error('row 실패');
          }
          h.targetInsertValues.push(...list);
        }
        return {
          // 조사 대상은 묶음 INSERT 라 넣은 행마다 id·resid 를 돌려준다
          returning: async () =>
            tableName === 'contact_uploads'
              ? [{ id: 'upload-1' }]
              : list.map((v, i) => ({ id: `target-${i + 1}`, resid: v['resid'] })),
        };
      },
    };
  });
  tx['update'] = vi.fn(() => ({
    set: () => ({ where: () => thenable(undefined) }),
  }));
  tx['transaction'] = vi.fn(async (callback: (sp: typeof tx) => Promise<unknown>) => callback(tx));

  return {
    db: {
      transaction: vi.fn(async (callback: (currentTx: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    },
  };
});

import { ingestContactUpload } from './contact-uploads';

const dialect = new PgDialect();
const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const input = {
  surveyId: SURVEY_ID,
  file: {
    name: 'contacts.xlsx',
    size: 11,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as File,
  mapping: {
    sheetName: '',
    headerRow: 1,
    systemFields: {},
    selectedAttrsKeys: ['회사명'],
  },
};

beforeEach(() => {
  h.initialScope = 'real';
  h.lockedTestMode = false;
  h.deleteWheres.length = 0;
  h.targetInsertValues.length = 0;
  h.rows = [{ 회사명: '아크미' }];
  h.failBatchInsert = false;
  h.failRowCompany = null;
});

describe('ingestContactUpload 삭제 직전 스코프 가드', () => {
  it('초기 조회 뒤 테스트 모드로 바뀌면 실제 대상자 삭제 전에 거부한다', async () => {
    h.lockedTestMode = true;

    await expect(ingestContactUpload(input)).rejects.toThrow(
      '테스트 모드에서는 실제 조사대상자를 업로드할 수 없습니다.',
    );

    expect(h.deleteWheres).toHaveLength(0);
  });

  it('실제 모드에서는 isTest=false 대상자만 삭제하고 신규 대상자도 실제 범위로 저장한다', async () => {
    await expect(ingestContactUpload(input)).resolves.toMatchObject({ uploadedRows: 1 });

    expect(h.deleteWheres).toHaveLength(1);
    const deleteQuery = dialect.sqlToQuery(h.deleteWheres[0] as never);
    expect(deleteQuery.params).toContain(SURVEY_ID);
    expect(deleteQuery.params).toContain(false);
    expect(h.targetInsertValues).toHaveLength(1);
    expect(h.targetInsertValues[0]).toMatchObject({ surveyId: SURVEY_ID, isTest: false });
  });
});

describe('ingestContactUpload 묶음 적재', () => {
  it('묶음 INSERT 가 실패하면 그 묶음만 행 단위로 다시 넣고, 실패 행은 시스템ID 를 소비하지 않는다', async () => {
    h.rows = [{ 회사명: 'A' }, { 회사명: 'B' }, { 회사명: 'C' }, { 회사명: 'D' }];
    h.failBatchInsert = true;
    h.failRowCompany = 'B';

    await expect(ingestContactUpload(input)).resolves.toMatchObject({
      uploadedRows: 3,
      errorRows: 1,
    });

    // mock 의 next_contact_resid 는 1 을 준다 — A=1, B 실패(번호 소비 없음), C=2, D=3
    expect(h.targetInsertValues.map((v) => [(v['attrs'] as Record<string, string>)['회사명'], v['resid']])).toEqual([
      ['A', 1],
      ['C', 2],
      ['D', 3],
    ]);
  });

  it('묶음이 성공하면 행마다 연속 시스템ID 를 붙여 한 번에 넣는다', async () => {
    h.rows = [{ 회사명: 'A' }, { 회사명: 'B' }, { 회사명: 'C' }];

    await expect(ingestContactUpload(input)).resolves.toMatchObject({ uploadedRows: 3, errorRows: 0 });
    expect(h.targetInsertValues.map((v) => v['resid'])).toEqual([1, 2, 3]);
  });
});
