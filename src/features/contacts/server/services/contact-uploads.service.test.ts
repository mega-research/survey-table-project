import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  initialScope: 'real' as 'real' | 'test',
  lockedTestMode: false,
  deleteWheres: [] as unknown[],
  targetInsertValues: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/operations/data-scope.server', () => ({
  loadOperationsDataScope: vi.fn(async () => h.initialScope),
}));

vi.mock('@/lib/contacts/excel-parser', () => ({
  parseExcelRows: vi.fn(async () => [{ 회사명: '아크미' }]),
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
      values: (values: Record<string, unknown>) => {
        if (tableName === 'contact_targets') h.targetInsertValues.push(values);
        return {
          returning: async () => [
            { id: tableName === 'contact_uploads' ? 'upload-1' : 'target-1' },
          ],
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

import { ingestContactUpload } from './contact-uploads.service';

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
