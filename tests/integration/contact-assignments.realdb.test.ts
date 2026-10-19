/**
 * 컨택원 배정 — 실 DB 왕복 (CONTEXT.md 「컨택원 배정」).
 *
 * 컨택원은 이름 붙은 배정 묶음이고 실데이터·테스트 데이터에 따로 있다. 한 조사 대상은 지금
 * 컨택원 하나에만 속한다. 이 파일은 바깥에서 보이는 결과 — 어떤 대상이 어느 컨택원에 남는가 —
 * 만 단언한다.
 *
 * 실행: pnpm test:integration (로컬 supabase 54322). 일반 pnpm test 에서는 스킵된다.
 */
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import { contactAssignments, contactTargets, surveys } from '@/db/schema';
import {
  createAssignment,
  DuplicateAssignmentNameError,
  listAssignmentOptions,
  setTargetAssignment,
} from '@/server/contacts/services/contact-assignments';
import { buildColumnCandidates, listContactsForSurvey } from '@/server/read-models/contacts';
import {
  parseClausesFromUrl,
  parseHeaderFiltersFromUrl,
} from '@/server/read-models/contacts-filters';
import { FILTER_NONE_VALUE, HEADER_FILTER_VALUE_SEPARATOR } from '@/lib/operations/filter-shared';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

// 이 브라우저의 「테스트 데이터 보기」 쿠키 — 켜고 끄며 파티션을 오간다 (server/data-scope).
const cookieState = vi.hoisted(() => ({ testView: false }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieState.testView && name.startsWith('ops-test-view-') ? { name, value: '1' } : undefined,
  }),
}));

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
const run = process.env['RUN_REALDB'] === '1' && isLocalDb ? describe : describe.skip;

const BASE_SCHEME: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
    { key: '기업명', label: '기업명', source: 'attrs.기업명', order: 2 },
    { key: 'web', label: 'web', source: 'system.web', order: 3 },
  ],
};

const createdSurveyIds: string[] = [];

async function seedSurvey(opts: { testMode?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await db.insert(surveys).values({
    id,
    title: '컨택원 배정 실DB',
    testModeEnabled: opts.testMode ?? false,
    contactColumns: BASE_SCHEME,
    testContactColumns: BASE_SCHEME,
  });
  createdSurveyIds.push(id);
  return id;
}

async function seedTargets(surveyId: string, count: number, isTest = false): Promise<string[]> {
  const rows = Array.from({ length: count }, (_, i) => ({
    surveyId,
    resid: i + 1,
    isTest,
    inviteCode: `ca${randomUUID().slice(0, 10)}`,
    attrs: { 기업명: `기업${i + 1}` },
  }));
  const inserted = await db
    .insert(contactTargets)
    .values(rows)
    .returning({ id: contactTargets.id });
  return inserted.map((r) => r.id);
}

async function assignmentOf(targetId: string): Promise<string | null> {
  const [row] = await db
    .select({ a: contactTargets.assignmentId })
    .from(contactTargets)
    .where(eq(contactTargets.id, targetId));
  return row?.a ?? null;
}

/** 테스트 파티션으로 본다 — 전역 테스트 모드 ∧ 이 브라우저 쿠키. */
function viewTest(on: boolean) {
  cookieState.testView = on;
}

run('컨택원 배정 (real local DB)', () => {
  beforeEach(() => viewTest(false));

  afterAll(async () => {
    if (createdSurveyIds.length === 0) return;
    // 설문 삭제가 컨택원·조사 대상을 cascade 로 함께 지운다.
    await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
  });

  it('컨택원을 이름으로 만들고, 같은 파티션의 같은 이름은 거부한다 — 파티션이 다르면 허용', async () => {
    const surveyId = await seedSurvey({ testMode: true });
    const first = await createAssignment({ surveyId, name: '10차' });
    const second = await createAssignment({ surveyId, name: '11차' });
    expect(second.order).toBeGreaterThan(first.order);

    await expect(createAssignment({ surveyId, name: '10차' })).rejects.toBeInstanceOf(
      DuplicateAssignmentNameError,
    );

    viewTest(true);
    const testOwner = await createAssignment({ surveyId, name: '10차' });
    expect(testOwner.id).not.toBe(first.id);

    expect((await listAssignmentOptions(surveyId, 'real')).map((o) => o.name)).toEqual([
      '10차',
      '11차',
    ]);
    expect((await listAssignmentOptions(surveyId, 'test')).map((o) => o.name)).toEqual(['10차']);
  });

  it('한 명을 배정하고 배정 없음으로 풀며, 목록 행에 이름이 실린다', async () => {
    const surveyId = await seedSurvey();
    const [t1, t2] = await seedTargets(surveyId, 2);
    const owner = await createAssignment({ surveyId, name: '외주 A팀' });

    await setTargetAssignment({ surveyId, contactTargetId: t1!, assignmentId: owner.id });
    expect(await assignmentOf(t1!)).toBe(owner.id);

    const listed = await listContactsForSurvey({
      surveyId,
      scope: 'real',
      clauses: [],
      page: 1,
      pageSize: 10,
      sort: 'resid',
      dir: 'asc',
    });
    expect(listed.rows.map((r) => r.assignment?.name ?? null)).toEqual(['외주 A팀', null]);

    // 게스트 목록은 컨택원을 싣지 않는다.
    const guestListed = await listContactsForSurvey({
      surveyId,
      scope: 'real',
      clauses: [],
      page: 1,
      pageSize: 10,
      sort: 'resid',
      dir: 'asc',
      includeAssignment: false,
    });
    expect(guestListed.rows.every((r) => r.assignment === null)).toBe(true);

    await setTargetAssignment({ surveyId, contactTargetId: t1!, assignmentId: null });
    expect(await assignmentOf(t1!)).toBeNull();
    expect(await assignmentOf(t2!)).toBeNull();
  });

  it('테스트 대상은 실 컨택원에, 실 대상은 테스트 컨택원에 배정되지 않는다', async () => {
    const surveyId = await seedSurvey({ testMode: true });
    const [realTarget] = await seedTargets(surveyId, 1, false);
    const [testTarget] = await seedTargets(surveyId, 1, true);
    const realOwner = await createAssignment({ surveyId, name: '실 컨택원' });
    viewTest(true);
    const testOwner = await createAssignment({ surveyId, name: '테스트 컨택원' });

    // 테스트 파티션 세션: 테스트 대상 + 실 컨택원 → 거부
    await expect(
      setTargetAssignment({ surveyId, contactTargetId: testTarget!, assignmentId: realOwner.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // 테스트 파티션 세션: 실 대상 → 거부
    await expect(
      setTargetAssignment({ surveyId, contactTargetId: realTarget!, assignmentId: testOwner.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    viewTest(false);
    // 실 파티션 세션: 실 대상 + 테스트 컨택원 → 거부
    await expect(
      setTargetAssignment({ surveyId, contactTargetId: realTarget!, assignmentId: testOwner.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await assignmentOf(realTarget!)).toBeNull();
    expect(await assignmentOf(testTarget!)).toBeNull();
  });

  it('스킴에 「컨택원」 열이 없는 옛 설문은 처음 만들 때 그 파티션 스킴 끝에 열이 붙는다', async () => {
    const surveyId = await seedSurvey();
    await createAssignment({ surveyId, name: '10차' });
    await createAssignment({ surveyId, name: '11차' });

    const [row] = await db
      .select({ real: surveys.contactColumns, test: surveys.testContactColumns })
      .from(surveys)
      .where(eq(surveys.id, surveyId));
    const realColumns = row?.real?.columns ?? [];
    expect(realColumns.at(-1)).toMatchObject({ source: 'system.contact_owner', label: '컨택원' });
    // 두 번째 컨택원이 열을 또 붙이지 않는다.
    expect(realColumns.filter((c) => c.source === 'system.contact_owner')).toHaveLength(1);
    // 다른 파티션 스킴은 건드리지 않는다.
    expect(row?.test?.columns.some((c) => c.source === 'system.contact_owner')).toBe(false);
  });

  it('컨택원 행이 지워지면 배정된 대상은 배정 없음이 된다', async () => {
    const surveyId = await seedSurvey();
    const [t1] = await seedTargets(surveyId, 1);
    const owner = await createAssignment({ surveyId, name: '12차' });
    await setTargetAssignment({ surveyId, contactTargetId: t1!, assignmentId: owner.id });

    await db.delete(contactAssignments).where(eq(contactAssignments.id, owner.id));
    expect(await assignmentOf(t1!)).toBeNull();
  });

  it('「현재 컨택원」 조건과 「컨택원」 열 정렬이 실제 행에서 맞다', async () => {
    const surveyId = await seedSurvey();
    const [t1, t2, t3] = await seedTargets(surveyId, 4);
    const tenth = await createAssignment({ surveyId, name: '10차' });
    const eleventh = await createAssignment({ surveyId, name: '11차' });
    await setTargetAssignment({ surveyId, contactTargetId: t1!, assignmentId: eleventh.id });
    await setTargetAssignment({ surveyId, contactTargetId: t2!, assignmentId: tenth.id });
    await setTargetAssignment({ surveyId, contactTargetId: t3!, assignmentId: eleventh.id });
    // t4 는 배정 없음

    const [row] = await db
      .select({ scheme: surveys.contactColumns })
      .from(surveys)
      .where(eq(surveys.id, surveyId));
    const candidates = buildColumnCandidates(row!.scheme, { includeContactOwner: true });
    const assignmentIds = new Set([tenth.id, eleventh.id]);
    const residsOf = async (clauses: Parameters<typeof listContactsForSurvey>[0]['clauses']) =>
      (
        await listContactsForSurvey({
          surveyId,
          scope: 'real',
          clauses,
          page: 1,
          pageSize: 50,
          sort: 'resid',
          dir: 'asc',
        })
      ).rows.map((r) => r.resid);

    // 검색바: 11차
    expect(
      await residsOf(
        parseClausesFromUrl(['system.contact_owner'], [eleventh.id], [''], candidates, [], {
          assignmentIds,
        }),
      ),
    ).toEqual([1, 3]);
    // 헤더: 10차 + 배정 없음 (= 「11차만 빼고 나머지」)
    expect(
      await residsOf(
        parseHeaderFiltersFromUrl(
          ['system.contact_owner'],
          ['in'],
          [[tenth.id, FILTER_NONE_VALUE].join(HEADER_FILTER_VALUE_SEPARATOR)],
          candidates,
          [],
          { assignmentIds },
        ),
      ),
    ).toEqual([2, 4]);

    // 정렬: 컨택원 순서(10차 → 11차) → 배정 없음 끝 — 내림차순이어도 배정 없음은 끝
    const sorted = async (dir: 'asc' | 'desc') =>
      (
        await listContactsForSurvey({
          surveyId,
          scope: 'real',
          clauses: [],
          page: 1,
          pageSize: 50,
          sort: 'owner',
          dir,
        })
      ).rows.map((r) => r.resid);
    expect(await sorted('asc')).toEqual([2, 1, 3, 4]);
    expect(await sorted('desc')).toEqual([1, 3, 2, 4]);
  });
});
