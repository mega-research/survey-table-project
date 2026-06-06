/**
 * library 3슬라이스 실 DB 왕복 integration test
 *
 * - saved-cells: create -> list 왕복 + apply(usageCount 증가) 검증
 * - question-categories: create -> list 왕복 + 매퍼(icon nullable -> undefined) 검증
 * - saved-lookups: create -> list 왕복 + 매퍼(description nullable -> undefined, tags/columns/rows JSONB) 검증
 * - saved-lookups propagation: 보관함=SoT 전파 불변식 검증
 *   update → surveys.lookups 사본 name/columns/rows 갱신
 *   remove → surveys.lookups 사본 항목 제거
 *
 * 실행 조건: DATABASE_URL이 127.0.0.1 또는 localhost를 포함할 때만 동작.
 * prod URL 환경에서는 describe.skipIf로 전체 스킵 -> 일반 pnpm test에서 데이터 오염 없음.
 *
 * 선행 조건: 로컬 supabase 스택 + 19테이블 셋업 완료 (pnpm db:setup-test).
 */

import { createRouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

// saved-cells.service는 R2 관련 외부 호출이 없으므로 mock 불필요.
// saved-lookups.service도 외부 호출 없음 (propagation은 DB-only).
// question-categories.service도 외부 호출 없음.

// 단, server-only 마커가 있는 서비스가 vitest.config alias로 이미 stub 처리됨.

import { db } from '@/db';
import {
  questionCategories as questionCategoriesTable,
  savedCells as savedCellsTable,
  savedLookups as savedLookupsTable,
  surveys as surveysTable,
} from '@/db/schema/surveys';
import type { SurveyLookup } from '@/types/survey';
import type { ORPCContext } from '@/server/context';

import { savedCells } from '@/features/library/server/procedures/saved-cells';
import { questionCategories } from '@/features/library/server/procedures/question-categories';
import { savedLookups } from '@/features/library/server/procedures/saved-lookups';

// prod 방어선: DATABASE_URL이 로컬이 아니면 전체 suite 스킵
const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

function adminContext(): ORPCContext {
  return {
    db,
    supabase: {} as never,
    user: { id: 'test-admin', email: 'test@local' },
  };
}

// ========================
// saved-cells
// ========================

describe.skipIf(!isLocalDb)('saved-cells procedure round-trip (real local DB)', () => {
  const client = createRouterClient({ savedCells }, { context: adminContext() });
  const createdIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) {
      await db.delete(savedCellsTable).where(eq(savedCellsTable.id, id));
    }
  });

  it('create -> list 왕복: 저장된 셀이 조회되고 cellType이 올바르게 저장된다', async () => {
    // sanitizeCellForLibrary가 id/cellCode/imageUrl 등을 제거하고 나머지를 보존하므로
    // content를 가진 text 타입 셀을 사용한다.
    const inputCell = {
      id: 'rt-cell-src',
      type: 'text' as const,
      content: '왕복 테스트 셀 내용',
    };

    const saved = await client.savedCells.create({
      cell: inputCell as never,
      name: '왕복-셀-테스트',
    });
    createdIds.push(saved.id);

    // toDomainSavedCell 매퍼 검증: 모든 필드가 정상 매핑
    expect(saved.name).toBe('왕복-셀-테스트');
    expect(saved.cellType).toBe('text');
    expect(saved.usageCount).toBe(0);
    // sanitizeCellForLibrary가 id를 제거하므로 반환된 cell에 id가 없어야 한다
    expect((saved.cell as unknown as Record<string, unknown>)['id']).toBeUndefined();
    // content는 보존되어야 한다
    expect((saved.cell as unknown as Record<string, unknown>)['content']).toBe('왕복 테스트 셀 내용');

    // list에서 방금 생성한 row가 보이는지 확인
    const list = await client.savedCells.list();
    expect(list.some((c) => c.id === saved.id)).toBe(true);
  });

  it('apply: usageCount 증가 후 sanitize된 cell 데이터를 반환한다', async () => {
    const inputCell = {
      id: 'rt-cell-src2',
      type: 'input' as const,
      content: '',
      placeholder: 'apply 테스트 placeholder',
    };

    const saved = await client.savedCells.create({
      cell: inputCell as never,
      name: 'apply-셀-테스트',
    });
    createdIds.push(saved.id);

    const applied = await client.savedCells.apply({ id: saved.id });

    expect(applied).not.toBeNull();
    // apply는 셀 데이터(Partial<TableCell>)를 반환
    expect((applied as unknown as Record<string, unknown>)['type']).toBe('input');

    // usageCount가 DB에서 실제로 증가했는지 직접 확인
    const [row] = await db
      .select({ usageCount: savedCellsTable.usageCount })
      .from(savedCellsTable)
      .where(eq(savedCellsTable.id, saved.id));
    expect(row?.usageCount).toBe(1);
  });
});

// ========================
// question-categories
// ========================

describe.skipIf(!isLocalDb)('question-categories procedure round-trip (real local DB)', () => {
  const client = createRouterClient({ questionCategories }, { context: adminContext() });
  const createdIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) {
      await db.delete(questionCategoriesTable).where(eq(questionCategoriesTable.id, id));
    }
  });

  it('create -> list 왕복: 생성된 카테고리가 조회되고 기본 color가 적용된다', async () => {
    const created = await client.questionCategories.create({
      name: '왕복-카테고리-테스트',
    });
    createdIds.push(created.id);

    // color 미지정 시 service 기본값 적용 검증
    expect(created.name).toBe('왕복-카테고리-테스트');
    expect(created.color).toBeTruthy();
    // order는 자동 발번(기존 max + 1)
    expect(typeof created.order).toBe('number');
    // icon은 미지정 -> toDomainQuestionCategory에서 undefined (domain optional)
    expect(created.icon).toBeUndefined();

    // list에서 방금 생성한 row가 보이는지 확인
    const list = await client.questionCategories.list();
    expect(list.some((c) => c.id === created.id)).toBe(true);
  });

  it('create with color: 지정한 color가 그대로 저장된다', async () => {
    const created = await client.questionCategories.create({
      name: '왕복-색상-카테고리',
      color: 'bg-red-100 text-red-600',
    });
    createdIds.push(created.id);

    expect(created.color).toBe('bg-red-100 text-red-600');
  });

  it('icon이 있는 카테고리: toDomainQuestionCategory가 icon을 string으로 반환한다', async () => {
    // DB에는 icon 컬럼이 있으므로 initializeDefaults나 직접 삽입으로 icon이 있는 행 생성.
    // create procedure는 icon을 입력받지 않으므로, DB에 직접 삽입 후 list로 확인한다.
    const [inserted] = await db
      .insert(questionCategoriesTable)
      .values({ name: '아이콘-카테고리', color: 'bg-blue-100 text-blue-600', icon: 'Star', order: 999 })
      .returning();

    if (!inserted) throw new Error('직접 삽입 실패');
    createdIds.push(inserted.id);

    const list = await client.questionCategories.list();
    const found = list.find((c) => c.id === inserted.id);
    expect(found).toBeDefined();
    // icon이 있을 때 toDomainQuestionCategory가 string으로 반환하는지 검증
    expect(found?.icon).toBe('Star');
  });
});

// ========================
// saved-lookups
// ========================

describe.skipIf(!isLocalDb)('saved-lookups procedure round-trip (real local DB)', () => {
  const client = createRouterClient({ savedLookups }, { context: adminContext() });
  const createdIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) {
      // deleteSavedLookup은 surveys.lookups propagation을 포함한 트랜잭션이므로
      // 직접 DB delete로 cleanup (테스트 데이터는 surveys 사본 없음)
      await db.delete(savedLookupsTable).where(eq(savedLookupsTable.id, id));
    }
  });

  it('create -> list 왕복: 생성된 LUT가 조회되고 JSONB 필드가 올바르게 반환된다', async () => {
    const input = {
      name: '왕복-LUT-테스트',
      description: '왕복 테스트용 LUT',
      category: '테스트카테고리',
      tags: ['태그1', '태그2'],
      columns: ['지역', '인구수'],
      rows: [
        { 지역: '서울', 인구수: 9500000 },
        { 지역: '부산', 인구수: 3400000 },
      ],
    };

    const created = await client.savedLookups.create(input);
    createdIds.push(created.id);

    // toDomainSavedLookup 매퍼 검증
    expect(created.name).toBe('왕복-LUT-테스트');
    expect(created.description).toBe('왕복 테스트용 LUT');
    expect(created.category).toBe('테스트카테고리');
    expect(created.tags).toEqual(['태그1', '태그2']);
    expect(created.columns).toEqual(['지역', '인구수']);
    expect(created.rows).toEqual([
      { 지역: '서울', 인구수: 9500000 },
      { 지역: '부산', 인구수: 3400000 },
    ]);
    expect(created.usageCount).toBe(0);
    expect(created.isPreset).toBe(false);

    // list에서 방금 생성한 row가 보이는지 확인
    const list = await client.savedLookups.list();
    expect(list.some((l) => l.id === created.id)).toBe(true);
  });

  it('description 없이 create: toDomainSavedLookup이 description을 undefined로 반환한다', async () => {
    const input = {
      name: '왕복-설명없는-LUT',
      category: '테스트카테고리',
      tags: [],
      columns: ['코드'],
      rows: [{ 코드: '001' }],
    };

    const created = await client.savedLookups.create(input);
    createdIds.push(created.id);

    // description null -> undefined (domain optional, exactOptionalPropertyTypes 대응)
    expect(created.description).toBeUndefined();
    expect(created.tags).toEqual([]);
  });

  it('list with category filter: 해당 category 행만 반환된다', async () => {
    const input = {
      name: '왕복-필터-LUT',
      category: '유니크-필터-카테고리-왕복',
      tags: [],
      columns: ['항목'],
      rows: [],
    };

    const created = await client.savedLookups.create(input);
    createdIds.push(created.id);

    const filtered = await client.savedLookups.list({ category: '유니크-필터-카테고리-왕복' });
    expect(filtered.some((l) => l.id === created.id)).toBe(true);
    // 다른 카테고리 row는 포함되지 않아야 함
    expect(filtered.every((l) => l.category === '유니크-필터-카테고리-왕복')).toBe(true);
  });
});

// ========================
// saved-lookups propagation (보관함=SoT 전파 불변식)
// ========================
//
// updateSavedLookup / deleteSavedLookup 이 surveys.lookups JSONB 사본을 올바르게
// 동기화하는지 실 DB 왕복으로 검증한다.
// propagateSavedLookupUpdate / propagateSavedLookupDelete 는 action→service 이전 후에도
// SQL 이 byte-identical 로 보존됐으므로 이 테스트가 그 동작을 재확인한다.

describe.skipIf(!isLocalDb)('saved-lookups propagation 불변식 (real local DB)', () => {
  const client = createRouterClient({ savedLookups }, { context: adminContext() });

  // cleanup 대상: 테스트에서 생성한 saved_lookup id 와 survey id 를 별도 추적
  const createdLookupIds: string[] = [];
  const createdSurveyIds: string[] = [];

  afterAll(async () => {
    // survey 먼저 삭제 (cascade 무관하게 명시적 정리)
    for (const id of createdSurveyIds) {
      await db.delete(surveysTable).where(eq(surveysTable.id, id));
    }
    // saved_lookup 은 deleteSavedLookup 이 이미 호출됐을 수 있으므로 조용히 무시
    for (const id of createdLookupIds) {
      await db.delete(savedLookupsTable).where(eq(savedLookupsTable.id, id));
    }
  });

  it('update propagation: surveys.lookups 사본의 name/columns/rows 가 마스터와 동기화된다', async () => {
    // 1. 마스터 LUT 생성
    const master = await client.savedLookups.create({
      name: '전파-원본-LUT',
      category: '전파-테스트',
      tags: [],
      columns: ['지역', '코드'],
      rows: [{ 지역: '서울', 코드: '01' }],
    });
    createdLookupIds.push(master.id);

    // 2. 이 마스터의 사본을 lookups jsonb 에 포함하는 설문 1건 삽입
    const copyEntry: SurveyLookup = {
      id: nanoid(),
      name: master.name,
      sourceSavedLookupId: master.id,
      columns: master.columns,
      rows: master.rows,
    };

    const [insertedSurvey] = await db
      .insert(surveysTable)
      .values({
        title: '전파-테스트-설문',
        lookups: [copyEntry],
      })
      .returning();

    if (!insertedSurvey) throw new Error('survey 삽입 실패');
    createdSurveyIds.push(insertedSurvey.id);

    // 3. 마스터 LUT 수정 (name + columns + rows 모두 변경)
    const updated = await client.savedLookups.update({
      id: master.id,
      updates: {
        name: '전파-변경된-LUT',
        columns: ['지역', '코드', '인구'],
        rows: [
          { 지역: '서울', 코드: '01', 인구: 9500000 },
          { 지역: '부산', 코드: '02', 인구: 3400000 },
        ],
      },
    });
    expect(updated.name).toBe('전파-변경된-LUT');

    // 4. 설문 재조회 후 사본이 마스터와 동기화됐는지 검증
    const [surveyAfterUpdate] = await db
      .select({ lookups: surveysTable.lookups })
      .from(surveysTable)
      .where(eq(surveysTable.id, insertedSurvey.id));

    const copiedEntry = (surveyAfterUpdate?.lookups ?? []).find(
      (e) => e.sourceSavedLookupId === master.id,
    );

    expect(copiedEntry).toBeDefined();
    expect(copiedEntry?.name).toBe('전파-변경된-LUT');
    expect(copiedEntry?.columns).toEqual(['지역', '코드', '인구']);
    expect(copiedEntry?.rows).toEqual([
      { 지역: '서울', 코드: '01', 인구: 9500000 },
      { 지역: '부산', 코드: '02', 인구: 3400000 },
    ]);
  });

  it('remove propagation: surveys.lookups 에서 해당 사본 항목이 제거된다', async () => {
    // 1. 마스터 LUT 생성
    const master = await client.savedLookups.create({
      name: '삭제-전파-원본-LUT',
      category: '전파-테스트',
      tags: [],
      columns: ['항목'],
      rows: [{ 항목: 'A' }],
    });
    createdLookupIds.push(master.id);

    // 2. 이 마스터 사본 + 다른 사본(다른 sourceSavedLookupId) 두 개를 lookups 에 포함한 설문 삽입
    const copyToDelete: SurveyLookup = {
      id: nanoid(),
      name: master.name,
      sourceSavedLookupId: master.id,
      columns: master.columns,
      rows: master.rows,
    };
    const otherCopy: SurveyLookup = {
      id: nanoid(),
      name: '다른-LUT-사본',
      sourceSavedLookupId: 'other-master-id-not-exists',
      columns: ['기타'],
      rows: [],
    };

    const [insertedSurvey] = await db
      .insert(surveysTable)
      .values({
        title: '삭제-전파-테스트-설문',
        lookups: [copyToDelete, otherCopy],
      })
      .returning();

    if (!insertedSurvey) throw new Error('survey 삽입 실패');
    createdSurveyIds.push(insertedSurvey.id);

    // 3. 마스터 LUT 삭제 (remove procedure 호출)
    await client.savedLookups.remove({ id: master.id });
    // remove 후에는 savedLookups cleanup 불필요 (이미 삭제됨)
    const idx = createdLookupIds.indexOf(master.id);
    if (idx !== -1) createdLookupIds.splice(idx, 1);

    // 4. 설문 재조회 후 삭제된 사본은 없고 나머지 사본은 유지됐는지 검증
    const [surveyAfterDelete] = await db
      .select({ lookups: surveysTable.lookups })
      .from(surveysTable)
      .where(eq(surveysTable.id, insertedSurvey.id));

    const remainingLookups = surveyAfterDelete?.lookups ?? [];

    // 삭제된 마스터의 사본은 제거됐어야 함
    expect(
      remainingLookups.some((e) => e.sourceSavedLookupId === master.id),
    ).toBe(false);

    // 다른 사본은 그대로 유지됐어야 함
    expect(
      remainingLookups.some((e) => e.sourceSavedLookupId === 'other-master-id-not-exists'),
    ).toBe(true);
  });
});
