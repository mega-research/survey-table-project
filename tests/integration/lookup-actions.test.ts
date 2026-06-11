import { describe, expect, it, vi, beforeEach } from 'vitest';

// ========================
// 모듈 모킹
// ========================
//
// lookup-actions (survey 연관 함수만 남음):
//   copySavedLookupToSurvey / upsertSurveyLookup / deleteSurveyLookup
//
// 보관함 CRUD 함수(listSavedLookupsAction, createSavedLookupAction, updateSavedLookupAction,
// deleteSavedLookupAction)는 oRPC savedLookups procedure 로 이관됨.
// 해당 procedure 의 테스트는 src/features/library/server/procedures/saved-lookups.test.ts 에 있음.
//
// vi.mock 는 hoist 되므로 mock 안에서 참조하는 state 는 vi.hoisted 로 끌어올린다.

type SavedLookupRow = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tags: string[];
  columns: string[];
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
  columns: string[];
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
  // surveys row 를 FOR UPDATE 로 잠근 횟수 (lost update 방지 회귀 검증용)
  const lock = { surveyForUpdateCount: 0 };
  return { savedLookupStore, surveyStore, queryState, counter, lock };
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
    // sql tagged template 을 strings + values 로 보존 → db.execute mock 이 패턴 식별 가능
    sql: (() => {
      const fn = (strings: TemplateStringsArray | unknown, ...values: unknown[]) => {
        if (Array.isArray(strings)) {
          return {
            __sql: true,
            strings: Array.from(strings as readonly string[]),
            values,
          };
        }
        return { __sql: true, strings: [], values: [] };
      };
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
          name: vals['name'] as string,
          description: (vals['description'] as string | undefined) ?? null,
          category: vals['category'] as string,
          tags: (vals['tags'] as string[]) ?? [],
          columns: vals['columns'] as string[],
          rows: vals['rows'] as Array<Record<string, string | number>>,
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
                patch['usageCount'] &&
                typeof patch['usageCount'] === 'object' &&
                (patch['usageCount'] as { __sql?: boolean }).__sql
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

  // select({...}).from(surveys).where(eq).for('update') 체인 mock.
  // survey-lookups.service 가 FOR UPDATE row 잠금으로 read-modify-write 를 직렬화하도록 바뀌면서
  // findFirst 대신 select 체인을 사용한다. lookups 컬럼만 projection 한다.
  const selectChain = {
    from: vi.fn((table: { __table: 'savedLookups' | 'surveys' }) => {
      h.queryState.lastTable = table.__table;
      return {
        where: vi.fn((cond: { value: string }) => {
          const resolve = () => {
            if (h.queryState.lastTable === 'surveys') {
              const row = h.surveyStore.get(cond.value);
              return row ? [{ lookups: row.lookups }] : [];
            }
            return [];
          };
          // .for('update') 가 호출되면 row 잠금으로 간주 (회귀 검증 카운터 증가).
          // thenable 도 제공해 .for() 없이 await 해도 동작하도록 한다.
          const result = {
            for: vi.fn(async (mode: string) => {
              if (mode === 'update' && h.queryState.lastTable === 'surveys') {
                h.lock.surveyForUpdateCount += 1;
              }
              return resolve();
            }),
            then: (
              onFulfilled: (rows: Array<{ lookups: SurveyLookupRow[] }>) => unknown,
            ) => Promise.resolve(resolve()).then(onFulfilled),
          };
          return result;
        }),
      };
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
    select: vi.fn(() => selectChain),
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
    execute: vi.fn(async () => []),
  };

  return { db: dbObj };
});

// =====================
// 테스트
// =====================

import {
  copySavedLookupToSurvey,
  upsertSurveyLookup,
  deleteSurveyLookup,
} from '@/features/survey-builder/server/services/survey-lookups.service';

const TEST_SURVEY_ID = '00000000-0000-4000-8000-000000000001';

/** 테스트용 보관함 항목 직접 fixture 등록 헬퍼. */
function seedSavedLookup(partial: Partial<SavedLookupRow> & { id: string; name: string }) {
  const now = new Date();
  const row: SavedLookupRow = {
    description: null,
    category: 'finance',
    tags: [],
    columns: ['col'],
    rows: [{ col: 'v' }],
    usageCount: 0,
    isPreset: false,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
  h.savedLookupStore.set(row.id, row);
  return row;
}

describe('lookup-actions integration', () => {
  beforeEach(() => {
    h.savedLookupStore.clear();
    h.surveyStore.clear();
    h.counter.nano = 0;
    h.queryState.lastTable = null;
    h.lock.surveyForUpdateCount = 0;
    // 시작 fixture: 빈 lookups 가진 survey 한 건
    h.surveyStore.set(TEST_SURVEY_ID, {
      id: TEST_SURVEY_ID,
      title: 'lookup test survey',
      slug: 'lookup-test',
      lookups: [],
    });
  });

  it('copySavedLookupToSurvey → surveys.lookups 에 사본 추가 + usageCount 증가', async () => {
    const saved = seedSavedLookup({
      id: 'sl-1',
      name: 'lut-1',
      columns: ['대륙', 'value'],
      rows: [{ 대륙: '유럽', value: 1 }],
    });

    const copied = await copySavedLookupToSurvey(TEST_SURVEY_ID, saved.id);

    expect(copied.sourceSavedLookupId).toBe(saved.id);
    expect(copied.id).not.toBe(saved.id);
    expect(copied.rows).toEqual(saved.rows);

    // survey 의 lookups 에 1건 추가됨
    const survey = h.surveyStore.get(TEST_SURVEY_ID)!;
    expect(survey.lookups).toHaveLength(1);
    const surveyLookup0 = survey.lookups[0];
    if (!surveyLookup0) throw new Error('survey.lookups[0] 없음');
    expect(surveyLookup0.sourceSavedLookupId).toBe(saved.id);

    // saved_lookups 의 usageCount +1
    const savedAfter = h.savedLookupStore.get(saved.id)!;
    expect(savedAfter.usageCount).toBe(1);
  });

  it('upsertSurveyLookup → 행 수정', async () => {
    const saved = seedSavedLookup({
      id: 'sl-1',
      name: 'lut-1',
      columns: ['대륙', 'value'],
      rows: [{ 대륙: '유럽', value: 1 }],
    });
    await copySavedLookupToSurvey(TEST_SURVEY_ID, saved.id);

    const survey = h.surveyStore.get(TEST_SURVEY_ID)!;
    const existing = survey.lookups[0];
    if (!existing) throw new Error('survey.lookups[0] 없음');

    const updated = await upsertSurveyLookup(TEST_SURVEY_ID, {
      id: existing.id,
      name: existing.name,
      ...(existing.sourceSavedLookupId !== undefined && { sourceSavedLookupId: existing.sourceSavedLookupId }),
      columns: existing.columns,
      rows: [...existing.rows, { 대륙: '북미', value: 2 }],
    });
    expect(updated.rows).toHaveLength(2);

    const after = h.surveyStore.get(TEST_SURVEY_ID)!;
    expect(after.lookups).toHaveLength(1);
    const afterLookup0 = after.lookups[0];
    if (!afterLookup0) throw new Error('after.lookups[0] 없음');
    expect(afterLookup0.rows).toHaveLength(2);
  });

  it('deleteSurveyLookup → 사본 제거', async () => {
    const saved = seedSavedLookup({
      id: 'sl-1',
      name: 'lut-1',
      columns: ['대륙', 'value'],
      rows: [{ 대륙: '유럽', value: 1 }],
    });
    await copySavedLookupToSurvey(TEST_SURVEY_ID, saved.id);

    const survey = h.surveyStore.get(TEST_SURVEY_ID)!;
    const deleteLookup0 = survey.lookups[0];
    if (!deleteLookup0) throw new Error('survey.lookups[0] 없음');
    const surveyLookupId = deleteLookup0.id;

    await deleteSurveyLookup(TEST_SURVEY_ID, surveyLookupId);

    const after = h.surveyStore.get(TEST_SURVEY_ID)!;
    expect(after.lookups).toHaveLength(0);
  });

  it('copySavedLookupToSurvey: 같은 sourceSavedLookupId 중복 추가 시 갱신만 (usageCount 증가 없음)', async () => {
    const saved = seedSavedLookup({
      id: 'sl-1',
      name: 'lut-1',
      columns: ['대륙', 'value'],
      rows: [{ 대륙: '유럽', value: 1 }],
    });
    await copySavedLookupToSurvey(TEST_SURVEY_ID, saved.id);

    // 보관함 데이터 직접 갱신 후 두 번째 copy → 사본 갱신만, 신규 추가 안 됨
    h.savedLookupStore.set(saved.id, {
      ...h.savedLookupStore.get(saved.id)!,
      rows: [
        { 대륙: '유럽', value: 1 },
        { 대륙: '북미', value: 2 },
      ],
    });
    await copySavedLookupToSurvey(TEST_SURVEY_ID, saved.id);

    const survey = h.surveyStore.get(TEST_SURVEY_ID)!;
    // 사본은 여전히 1건
    expect(survey.lookups).toHaveLength(1);
    // rows 는 최신 보관함 데이터로 갱신
    const dedupeCheck0 = survey.lookups[0];
    if (!dedupeCheck0) throw new Error('survey.lookups[0] 없음');
    expect(dedupeCheck0.rows).toHaveLength(2);
    // usageCount 는 최초 1회만 증가
    expect(h.savedLookupStore.get(saved.id)!.usageCount).toBe(1);
  });

  // ========================
  // 회귀: surveys.lookups read-modify-write 직렬화 (lost update 방지)
  // ========================
  //
  // 세 함수 모두 surveys row 를 FOR UPDATE 로 잠근 뒤 읽고 써야 한다.
  // 잠금 없이 findFirst → update 로 돌아가면 동시 호출 시 마지막 writer 가
  // 다른 쪽 변경을 덮어써(lost update) 추가/삭제한 LUT 가 조용히 사라진다.
  describe('FOR UPDATE row 잠금으로 동시성 lost update 방지', () => {
    it('copySavedLookupToSurvey 는 surveys row 를 FOR UPDATE 로 잠근다', async () => {
      const saved = seedSavedLookup({ id: 'sl-1', name: 'lut-1' });
      await copySavedLookupToSurvey(TEST_SURVEY_ID, saved.id);
      expect(h.lock.surveyForUpdateCount).toBe(1);
    });

    it('upsertSurveyLookup 는 surveys row 를 FOR UPDATE 로 잠근다', async () => {
      await upsertSurveyLookup(TEST_SURVEY_ID, {
        id: 'lk-1',
        name: 'manual',
        columns: ['col'],
        rows: [{ col: 'v' }],
      });
      expect(h.lock.surveyForUpdateCount).toBe(1);
    });

    it('deleteSurveyLookup 는 surveys row 를 FOR UPDATE 로 잠근다', async () => {
      await deleteSurveyLookup(TEST_SURVEY_ID, 'nonexistent');
      expect(h.lock.surveyForUpdateCount).toBe(1);
    });

    it('순차 add A → delete B 가 서로 덮어쓰지 않는다 (잠금 직렬화 결과 일관성)', async () => {
      // 시작 상태: lookup B 한 건이 이미 있는 survey
      h.surveyStore.set(TEST_SURVEY_ID, {
        id: TEST_SURVEY_ID,
        title: 'lookup test survey',
        slug: 'lookup-test',
        lookups: [
          { id: 'lk-B', name: 'B', columns: ['col'], rows: [{ col: 'b' }] },
        ],
      });
      const savedA = seedSavedLookup({ id: 'sl-A', name: 'A' });

      // A 추가 후 B 삭제 — 잠금 직렬화 시 두 변경이 모두 반영되어야 한다.
      const copiedA = await copySavedLookupToSurvey(TEST_SURVEY_ID, savedA.id);
      await deleteSurveyLookup(TEST_SURVEY_ID, 'lk-B');

      const survey = h.surveyStore.get(TEST_SURVEY_ID)!;
      // B 는 제거, A 만 남아야 한다 (lost update 가 있으면 둘 중 하나가 사라짐)
      expect(survey.lookups).toHaveLength(1);
      expect(survey.lookups[0]?.id).toBe(copiedA.id);
      expect(survey.lookups.find((l) => l.id === 'lk-B')).toBeUndefined();
      // copy(1) + delete(1) = 2 회 잠금
      expect(h.lock.surveyForUpdateCount).toBe(2);
    });
  });
});
