import { describe, expect, it, vi, beforeEach } from 'vitest';

// ========================
// 모듈 모킹
// ========================
//
// lookup-actions 는 다음에 의존한다:
// - @/db 의 drizzle client (db.query.*.findFirst/findMany, db.insert, db.update, db.delete, db.transaction)
// - @/lib/auth 의 requireAuth
// - next/cache 의 revalidatePath
//
// vi.mock 는 hoist 되므로 mock 안에서 참조하는 state 는 vi.hoisted 로 끌어올린다.
// in-memory map 으로 CRUD 흐름을 통합 검증한다.

type SavedLookupRow = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tags: string[];
  keyColumns: string[];
  valueColumn: string;
  rows: Array<Record<string, string | number>>;
  usageCount: number;
  isPreset: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type SurveyLookupRow = {
  id: string;
  name: string;
  sourceSavedLookupId?: string;
  keyColumns: string[];
  valueColumn: string;
  rows: Array<Record<string, string | number>>;
};

type SurveyRow = {
  id: string;
  title: string;
  slug: string;
  lookups: SurveyLookupRow[];
};

const h = vi.hoisted(() => {
  const savedLookupStore = new Map<string, SavedLookupRow>();
  const surveyStore = new Map<string, SurveyRow>();
  const queryState: { lastTable: 'savedLookups' | 'surveys' | null } = {
    lastTable: null,
  };
  const counter = { nano: 0 };
  return { savedLookupStore, surveyStore, queryState, counter };
});

// drizzle 의 schema reference 와 비교하기 위해 mock 모듈을 제공
vi.mock('@/db/schema', () => ({
  savedLookups: { __table: 'savedLookups' },
  surveys: { __table: 'surveys' },
}));

// eq() 가 호출되면 { table, value } 형태로 capture 한다
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (col: { __table?: string } | unknown, value: unknown) => ({
      __op: 'eq',
      __table: (col as { __table?: string })?.__table,
      value,
    }),
    sql: (() => {
      const fn = (..._args: unknown[]) => ({ __sql: true });
      return fn as unknown as typeof actual.sql;
    })(),
  };
});

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({ id: 'user-test' })),
}));

vi.mock('nanoid', () => ({
  nanoid: () => `nano-${++h.counter.nano}`,
}));

// =====================
// drizzle db mock
// =====================

vi.mock('@/db', () => {
  const insertChain = {
    values: vi.fn((vals: Record<string, unknown>) => {
      if (h.queryState.lastTable === 'savedLookups') {
        const id = `sl-${h.savedLookupStore.size + 1}`;
        const now = new Date();
        const row: SavedLookupRow = {
          id,
          name: vals.name as string,
          description: (vals.description as string | undefined) ?? null,
          category: vals.category as string,
          tags: (vals.tags as string[]) ?? [],
          keyColumns: vals.keyColumns as string[],
          valueColumn: vals.valueColumn as string,
          rows: vals.rows as Array<Record<string, string | number>>,
          usageCount: 0,
          isPreset: false,
          createdAt: now,
          updatedAt: now,
        };
        h.savedLookupStore.set(id, row);
        return {
          returning: vi.fn(async () => [row]),
        };
      }
      return { returning: vi.fn(async () => []) };
    }),
  };

  const updateChain = {
    set: vi.fn((patch: Record<string, unknown>) => {
      return {
        where: vi.fn((cond: { value: string }) => {
          if (h.queryState.lastTable === 'savedLookups') {
            const existing = h.savedLookupStore.get(cond.value);
            if (existing) {
              const updated = {
                ...existing,
                ...patch,
                updatedAt: new Date(),
              } as SavedLookupRow;
              // usageCount sql increment 처리
              if (
                patch.usageCount &&
                typeof patch.usageCount === 'object' &&
                (patch.usageCount as { __sql?: boolean }).__sql
              ) {
                updated.usageCount = existing.usageCount + 1;
              }
              h.savedLookupStore.set(cond.value, updated);
            }
            return {
              returning: vi.fn(async () =>
                h.savedLookupStore.get(cond.value)
                  ? [h.savedLookupStore.get(cond.value)!]
                  : [],
              ),
            };
          }
          if (h.queryState.lastTable === 'surveys') {
            const existing = h.surveyStore.get(cond.value);
            if (existing) {
              const updated = { ...existing, ...patch } as SurveyRow;
              h.surveyStore.set(cond.value, updated);
            }
            return { returning: vi.fn(async () => []) };
          }
          return { returning: vi.fn(async () => []) };
        }),
      };
    }),
  };

  const deleteChain = {
    where: vi.fn((cond: { value: string }) => {
      if (h.queryState.lastTable === 'savedLookups') {
        h.savedLookupStore.delete(cond.value);
      } else if (h.queryState.lastTable === 'surveys') {
        h.surveyStore.delete(cond.value);
      }
      return Promise.resolve();
    }),
  };

  const dbObj = {
    query: {
      savedLookups: {
        findFirst: vi.fn(async (args: { where: { value: string } }) => {
          return h.savedLookupStore.get(args.where.value);
        }),
        findMany: vi.fn(async (args?: { where?: { value: string } }) => {
          const all = Array.from(h.savedLookupStore.values());
          if (!args?.where) return all;
          return all.filter((r) => r.category === args.where!.value);
        }),
      },
      surveys: {
        findFirst: vi.fn(
          async (args: {
            where: { value: string };
            columns?: { lookups?: boolean };
          }) => {
            const row = h.surveyStore.get(args.where.value);
            if (!row) return undefined;
            if (args.columns?.lookups) {
              return { lookups: row.lookups };
            }
            return row;
          },
        ),
      },
    },
    insert: vi.fn((table: { __table: 'savedLookups' | 'surveys' }) => {
      h.queryState.lastTable = table.__table;
      return insertChain;
    }),
    update: vi.fn((table: { __table: 'savedLookups' | 'surveys' }) => {
      h.queryState.lastTable = table.__table;
      return updateChain;
    }),
    delete: vi.fn((table: { __table: 'savedLookups' | 'surveys' }) => {
      h.queryState.lastTable = table.__table;
      return deleteChain;
    }),
    transaction: vi.fn(
      async (fn: (tx: typeof dbObj) => Promise<unknown>) => fn(dbObj),
    ),
  };

  return { db: dbObj };
});

// =====================
// 테스트
// =====================

import {
  createSavedLookupAction,
  listSavedLookupsAction,
  copySavedLookupToSurveyAction,
  upsertSurveyLookupAction,
  deleteSurveyLookupAction,
  deleteSavedLookupAction,
} from '@/actions/lookup-actions';

const TEST_SURVEY_ID = '00000000-0000-4000-8000-000000000001';

describe('lookup-actions integration', () => {
  beforeEach(() => {
    h.savedLookupStore.clear();
    h.surveyStore.clear();
    h.counter.nano = 0;
    h.queryState.lastTable = null;
    // 시작 fixture: 빈 lookups 가진 survey 한 건
    h.surveyStore.set(TEST_SURVEY_ID, {
      id: TEST_SURVEY_ID,
      title: 'lookup test survey',
      slug: 'lookup-test',
      lookups: [],
    });
  });

  it('createSavedLookupAction → listSavedLookupsAction 으로 조회', async () => {
    const created = await createSavedLookupAction({
      name: 'avg-airfare-2026',
      category: 'finance',
      tags: ['항공'],
      keyColumns: ['대륙'],
      valueColumn: '2026년도_적용액',
      rows: [
        { 대륙: '유럽', '2026년도_적용액': 2470000 },
        { 대륙: '아시아', '2026년도_적용액': 800000 },
      ],
    });

    expect(created.id).toBeDefined();
    expect(created.name).toBe('avg-airfare-2026');

    const list = await listSavedLookupsAction({ category: 'finance' });
    expect(list.find((l) => l.id === created.id)).toBeDefined();

    // 다른 category 검색은 결과 없음
    const otherList = await listSavedLookupsAction({ category: 'demographics' });
    expect(otherList.find((l) => l.id === created.id)).toBeUndefined();
  });

  it('copySavedLookupToSurveyAction → surveys.lookups 에 사본 추가 + usageCount 증가', async () => {
    const created = await createSavedLookupAction({
      name: 'lut-1',
      category: 'finance',
      tags: [],
      keyColumns: ['대륙'],
      valueColumn: 'value',
      rows: [{ 대륙: '유럽', value: 1 }],
    });

    const copied = await copySavedLookupToSurveyAction(TEST_SURVEY_ID, created.id);

    expect(copied.sourceSavedLookupId).toBe(created.id);
    expect(copied.id).not.toBe(created.id);
    expect(copied.rows).toEqual(created.rows);

    // survey 의 lookups 에 1건 추가됨
    const survey = h.surveyStore.get(TEST_SURVEY_ID)!;
    expect(survey.lookups).toHaveLength(1);
    expect(survey.lookups[0].sourceSavedLookupId).toBe(created.id);

    // saved_lookups 의 usageCount +1
    const saved = h.savedLookupStore.get(created.id)!;
    expect(saved.usageCount).toBe(1);
  });

  it('upsertSurveyLookupAction → 행 수정', async () => {
    const created = await createSavedLookupAction({
      name: 'lut-1',
      category: 'finance',
      tags: [],
      keyColumns: ['대륙'],
      valueColumn: 'value',
      rows: [{ 대륙: '유럽', value: 1 }],
    });
    await copySavedLookupToSurveyAction(TEST_SURVEY_ID, created.id);

    const survey = h.surveyStore.get(TEST_SURVEY_ID)!;
    const existing = survey.lookups[0];

    const updated = await upsertSurveyLookupAction(TEST_SURVEY_ID, {
      ...existing,
      rows: [...existing.rows, { 대륙: '북미', value: 2 }],
    });
    expect(updated.rows).toHaveLength(2);

    const after = h.surveyStore.get(TEST_SURVEY_ID)!;
    expect(after.lookups).toHaveLength(1);
    expect(after.lookups[0].rows).toHaveLength(2);
  });

  it('deleteSurveyLookupAction → 사본 제거', async () => {
    const created = await createSavedLookupAction({
      name: 'lut-1',
      category: 'finance',
      tags: [],
      keyColumns: ['대륙'],
      valueColumn: 'value',
      rows: [{ 대륙: '유럽', value: 1 }],
    });
    await copySavedLookupToSurveyAction(TEST_SURVEY_ID, created.id);

    const survey = h.surveyStore.get(TEST_SURVEY_ID)!;
    const surveyLookupId = survey.lookups[0].id;

    await deleteSurveyLookupAction(TEST_SURVEY_ID, surveyLookupId);

    const after = h.surveyStore.get(TEST_SURVEY_ID)!;
    expect(after.lookups).toHaveLength(0);
  });

  it('deleteSavedLookupAction → 보관함 삭제', async () => {
    const created = await createSavedLookupAction({
      name: 'lut-1',
      category: 'finance',
      tags: [],
      keyColumns: ['대륙'],
      valueColumn: 'value',
      rows: [{ 대륙: '유럽', value: 1 }],
    });

    await deleteSavedLookupAction(created.id);

    const remaining = await listSavedLookupsAction({ category: 'finance' });
    expect(remaining.find((l) => l.id === created.id)).toBeUndefined();
    expect(h.savedLookupStore.get(created.id)).toBeUndefined();
  });
});
