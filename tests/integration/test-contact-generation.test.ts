import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactColumnScheme } from '@/db/schema/schema-types';
import { addContactTarget } from '@/features/contacts/server/services/contact-targets.service';
import { ingestContactUpload } from '@/features/contacts/server/services/contact-uploads.service';
import { generateTestContacts } from '@/features/contacts/server/services/test-contacts.service';

type TargetRow = {
  id: string;
  surveyId: string;
  resid: number;
  isTest: boolean;
  groupValue: string | null;
  attrs: Record<string, string>;
};

type ResponseRow = {
  id: string;
  surveyId: string;
  isTest: boolean;
  contactTargetId: string | null;
};

const h = vi.hoisted(() => ({
  survey: {
    id: '11111111-1111-4111-8111-111111111111',
    testModeEnabled: true,
    contactColumns: {
      version: 1,
      headerRow: 1,
      columns: [
        {
          key: '담당자',
          label: '담당자',
          source: 'pii.담당자',
          piiType: 'representative',
          order: 1,
        },
        { key: '소속', label: '회사명', source: 'attrs.소속', order: 2 },
      ],
    } as ContactColumnScheme,
    testContactColumns: null as ContactColumnScheme | null,
  },
  targets: [] as TargetRow[],
  responses: [] as ResponseRow[],
  piiWrites: [] as Array<{
    targetId: string;
    columnKey: string;
    fieldType: string;
    plain: string;
  }>,
  lockCount: 0,
  countWheres: [] as unknown[],
  responseDeleteWheres: [] as unknown[],
  scope: 'test' as 'real' | 'test',
}));

const parseExcelRowsMock = vi.fn(async () => [] as Array<Record<string, string>>);

vi.mock('@/lib/operations/data-scope.server', () => ({
  loadOperationsDataScope: vi.fn(async () => h.scope),
}));

vi.mock('@/lib/contacts/excel-parser', () => ({
  parseExcelRows: (...args: unknown[]) => parseExcelRowsMock(...(args as [])),
  previewExcel: vi.fn(),
}));

vi.mock('@/lib/crypto/contact-pii-repo', () => ({
  upsertPiiValue: vi.fn(
    async (_tx: unknown, targetId: string, columnKey: string, fieldType: string, plain: string) => {
      h.piiWrites.push({ targetId, columnKey, fieldType, plain });
    },
  ),
}));

vi.mock('@/db', () => {
  let lockTail = Promise.resolve();

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

  function createTx(releaseRef: { current: (() => void) | null }) {
    let activeIsTest = false;
    return {
      execute: vi.fn(async (query: unknown) => {
        const text = sqlText(query).toLowerCase();
        if (text.includes('for update')) {
          const previous = lockTail;
          let release!: () => void;
          lockTail = new Promise<void>((resolve) => {
            release = resolve;
          });
          await previous;
          releaseRef.current = release;
          h.lockCount += 1;
          activeIsTest = h.survey.testModeEnabled;
          return [
            {
              id: h.survey.id,
              test_mode_enabled: h.survey.testModeEnabled,
              contact_columns: h.survey.contactColumns,
              test_contact_columns: h.survey.testContactColumns,
            },
          ];
        }
        if (text.includes('next_contact_resid')) {
          const used = h.targets
            .filter((target) => target.surveyId === h.survey.id && target.isTest === activeIsTest)
            .map((target) => target.resid);
          return [{ resid: Math.max(0, ...used) + 1 }];
        }
        throw new Error(`예상하지 못한 SQL: ${text}`);
      }),
      select: vi.fn(() => {
        const chain = {
          from: () => chain,
          where: (where: unknown) => {
            h.countWheres.push(where);
            return thenable([
              {
                total: h.targets.filter(
                  (target) => target.surveyId === h.survey.id && target.isTest === activeIsTest,
                ).length,
              },
            ]);
          },
        };
        return chain;
      }),
      delete: vi.fn(() => ({
        where: (where: unknown) => {
          h.responseDeleteWheres.push(where);
          h.responses = h.responses.filter(
            (response) =>
              !(
                response.surveyId === h.survey.id &&
                response.isTest &&
                response.contactTargetId == null
              ),
          );
          return thenable(undefined);
        },
      })),
      update: vi.fn(() => ({
        set: (values: { testContactColumns?: ContactColumnScheme }) => ({
          where: () => {
            if (values.testContactColumns) {
              h.survey.testContactColumns = structuredClone(values.testContactColumns);
            }
            return thenable(undefined);
          },
        }),
      })),
      insert: vi.fn(() => ({
        values: (values: Omit<TargetRow, 'id'>) => ({
          returning: async () => {
            const row = { ...values, id: `target-${h.targets.length + 1}` };
            h.targets.push(row);
            return [{ id: row.id, resid: row.resid }];
          },
        }),
      })),
    };
  }

  return {
    db: {
      transaction: vi.fn(
        async (callback: (tx: ReturnType<typeof createTx>) => Promise<unknown>) => {
          const releaseRef = { current: null as (() => void) | null };
          const tx = createTx(releaseRef);
          try {
            return await callback(tx);
          } finally {
            releaseRef.current?.();
          }
        },
      ),
    },
  };
});

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  h.survey.testModeEnabled = true;
  h.survey.testContactColumns = null;
  h.targets.length = 0;
  h.responses.length = 0;
  h.piiWrites.length = 0;
  h.lockCount = 0;
  h.countWheres.length = 0;
  h.responseDeleteWheres.length = 0;
  h.scope = 'test';
  parseExcelRowsMock.mockClear();
});

const dialect = new PgDialect();

describe('테스트 대상자 자동 생성', () => {
  it('테스트 모드에서는 ingestContactUpload를 파싱 전에 거부한다', async () => {
    await expect(
      ingestContactUpload({
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
          selectedAttrsKeys: [],
        },
      }),
    ).rejects.toThrow('테스트 모드에서는 실제 조사대상자를 업로드할 수 없습니다.');

    expect(parseExcelRowsMock).not.toHaveBeenCalled();
  });

  it('최초 생성은 익명 테스트 응답을 지우고 테스트 컬럼과 같은 수신 이메일을 저장한다', async () => {
    h.responses.push(
      { id: 'anonymous-test', surveyId: SURVEY_ID, isTest: true, contactTargetId: null },
      { id: 'targeted-test', surveyId: SURVEY_ID, isTest: true, contactTargetId: 'old-target' },
      { id: 'anonymous-real', surveyId: SURVEY_ID, isTest: false, contactTargetId: null },
    );

    await expect(
      generateTestContacts({ surveyId: SURVEY_ID, count: 3, recipientEmail: 'qa@example.com' }),
    ).resolves.toEqual({ createdCount: 3 });

    expect(h.lockCount).toBe(1);
    expect(h.targets).toHaveLength(3);
    expect(h.targets.every((target) => target.isTest)).toBe(true);
    expect(h.targets.map((target) => target.groupValue)).toEqual(['서울', '부산', '대전']);
    expect(h.targets.map((target) => target.attrs['소속'])).toEqual([
      '테스트기업 01',
      '테스트기업 02',
      '테스트기업 03',
    ]);
    expect(h.targets.map((target) => target.attrs['test_region'])).toEqual([
      '서울',
      '부산',
      '대전',
    ]);
    expect(h.responses.map((response) => response.id)).toEqual(['targeted-test', 'anonymous-real']);
    const deleteQuery = dialect.sqlToQuery(h.responseDeleteWheres[0] as never);
    expect(deleteQuery.sql.replaceAll('"', '')).toContain(
      'survey_responses.contact_target_id is null',
    );
    expect(deleteQuery.params).toContain(SURVEY_ID);
    expect(deleteQuery.params).toContain(true);
    expect(h.survey.testContactColumns).not.toBeNull();
    expect(h.piiWrites.filter((value) => value.fieldType === 'email')).toHaveLength(3);
    expect(
      h.piiWrites
        .filter((value) => value.fieldType === 'email')
        .every((value) => value.plain === 'qa@example.com'),
    ).toBe(true);
  });

  it('자동 생성 재호출은 기존 테스트 대상자를 변경하지 않고 거부한다', async () => {
    await generateTestContacts({
      surveyId: SURVEY_ID,
      count: 1,
      recipientEmail: 'qa@example.com',
    });

    await expect(
      generateTestContacts({ surveyId: SURVEY_ID, count: 1, recipientEmail: 'qa@example.com' }),
    ).rejects.toThrow('TEST_TARGET_GENERATION_STALE');
    expect(h.targets).toHaveLength(1);
  });

  it('동시 자동 생성도 설문 잠금 뒤 재검증하여 20명을 넘지 않는다', async () => {
    const results = await Promise.allSettled([
      generateTestContacts({ surveyId: SURVEY_ID, count: 12, recipientEmail: 'qa@example.com' }),
      generateTestContacts({ surveyId: SURVEY_ID, count: 12, recipientEmail: 'qa@example.com' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(h.targets).toHaveLength(12);
    expect(h.lockCount).toBe(2);
  });
});

describe('수동 대상자 생성 스코프', () => {
  it('서버가 현재 실제 모드이면 isTest=false로 저장한다', async () => {
    h.survey.testModeEnabled = false;

    await addContactTarget({ surveyId: SURVEY_ID, attrs: { 소속: '실제 회사' } });

    expect(h.targets).toHaveLength(1);
    expect(h.targets[0]?.isTest).toBe(false);
    expect(dialect.sqlToQuery(h.countWheres[0] as never).params).toContain(false);
  });

  it('자동과 수동 합계가 20명이면 추가 수동 생성을 거부한다', async () => {
    await generateTestContacts({
      surveyId: SURVEY_ID,
      count: 19,
      recipientEmail: 'qa@example.com',
    });
    await addContactTarget({ surveyId: SURVEY_ID, attrs: { 소속: '수동 테스트기업' } });

    await expect(
      addContactTarget({ surveyId: SURVEY_ID, attrs: { 소속: '한도 초과' } }),
    ).rejects.toThrow('TEST_TARGET_LIMIT');
    expect(h.targets).toHaveLength(20);
  });

  it('19명에서 동시 수동 추가 요청도 하나만 저장한다', async () => {
    await generateTestContacts({
      surveyId: SURVEY_ID,
      count: 19,
      recipientEmail: 'qa@example.com',
    });

    const results = await Promise.allSettled([
      addContactTarget({ surveyId: SURVEY_ID, attrs: { 소속: '수동 A' } }),
      addContactTarget({ surveyId: SURVEY_ID, attrs: { 소속: '수동 B' } }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(h.targets).toHaveLength(20);
  });
});
