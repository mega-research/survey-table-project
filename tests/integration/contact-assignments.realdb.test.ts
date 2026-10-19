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

import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import { contactAssignments, contactTargets, surveyResponses, surveys } from '@/db/schema';
import {
  createAssignment,
  DuplicateAssignmentNameError,
  listAssignmentOptions,
  listAssignmentsWithStats,
  removeAssignment,
  renameAssignment,
  reorderAssignments,
  setTargetAssignment,
} from '@/server/contacts/services/contact-assignments';
import {
  applyAssignment,
  assignFromList,
  listAssignmentMatches,
  previewAssignFromList,
  previewAssignment,
} from '@/server/contacts/services/contact-assignment-apply';
import { createContactIdList } from '@/server/contacts/services/contact-id-lists';
import { getProgressRows, getProgressTotals } from '@/server/operations/services/report-progress';
import { disableTestWorkspace } from '@/server/operations/services/test-workspace';
import { ingestContactUpload } from '@/server/contacts/services/contact-uploads';
import { countAssignedTargets } from '@/server/contacts/services/contact-assignments';
import ExcelJS from 'exceljs';
import { listAssignmentFacets } from '@/server/contacts/services/contact-assignment-facets';
import { buildColumnCandidates, listContactsForSurvey } from '@/server/read-models/contacts';
import {
  parseClausesFromUrl,
  parseHeaderFiltersFromUrl,
} from '@/server/read-models/contacts-filters';
import {
  encodeMultiClauseValue,
  formatIdListToken,
  FILTER_NONE_VALUE,
  FILTER_NOT_NONE_VALUE,
  HEADER_FILTER_VALUE_SEPARATOR,
} from '@/lib/operations/filter-shared';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

// 이 브라우저의 「테스트 데이터 보기」 쿠키 — 켜고 끄며 파티션을 오간다 (server/data-scope).
const cookieState = vi.hoisted(() => ({ testView: false }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieState.testView && name.startsWith('ops-test-view-') ? { name, value: '1' } : undefined,
  }),
}));

// ingestContactUpload → loadOperationsDataScope → isGuestViewer 는 요청 세션을 fail-closed 로
// 요구한다. 실DB 테스트에는 요청 스코프가 없어 어드민(게스트 아님)으로 고정한다.
vi.mock('@/lib/auth/guest-viewer', () => ({ isGuestViewer: () => Promise.resolve(false) }));

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

  it('관리 목록 인원은 조사 대상 목록 응답 상태와 같은 식이고 배정 없음 줄이 있다', async () => {
    const surveyId = await seedSurvey();
    const [t1, t2, t3, t4] = await seedTargets(surveyId, 5);
    const owner = await createAssignment({ surveyId, name: '10차' });
    for (const t of [t1, t2, t3]) {
      await setTargetAssignment({ surveyId, contactTargetId: t!, assignmentId: owner.id });
    }
    await db.insert(surveyResponses).values([
      { surveyId, contactTargetId: t1!, questionResponses: {}, status: 'completed', isCompleted: true },
      { surveyId, contactTargetId: t2!, questionResponses: {}, status: 'in_progress' },
      { surveyId, contactTargetId: t4!, questionResponses: {}, status: 'completed', isCompleted: true },
    ]);

    const data = await listAssignmentsWithStats(surveyId, 'real');
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]?.stats).toEqual({ assigned: 3, completed: 1, inProgress: 1, notStarted: 1 });
    expect(data.unassigned).toEqual({ assigned: 2, completed: 1, inProgress: 0, notStarted: 1 });
    expect(data.total).toBe(5);

    // 같은 숫자를 조사 대상 목록 web 필터로도 얻는다.
    const [row] = await db
      .select({ scheme: surveys.contactColumns })
      .from(surveys)
      .where(eq(surveys.id, surveyId));
    const candidates = buildColumnCandidates(row!.scheme, { includeContactOwner: true });
    const completedOfOwner = await listContactsForSurvey({
      surveyId,
      scope: 'real',
      clauses: [
        ...parseClausesFromUrl(['system.contact_owner'], [owner.id], [''], candidates, [], {
          assignmentIds: new Set([owner.id]),
        }),
        ...parseClausesFromUrl(['system.web'], ['completed'], ['AND'], candidates, []).map((c) => ({
          ...c,
          op: 'AND' as const,
        })),
      ],
      page: 1,
      pageSize: 50,
      sort: 'resid',
      dir: 'asc',
    });
    expect(completedOfOwner.total).toBe(1);
  });

  it('지우면 배정된 대상이 배정 없음이 되고 풀린 인원을 돌려준다', async () => {
    const surveyId = await seedSurvey();
    const [t1, t2] = await seedTargets(surveyId, 2);
    const owner = await createAssignment({ surveyId, name: '삭제할 차수' });
    await setTargetAssignment({ surveyId, contactTargetId: t1!, assignmentId: owner.id });
    await setTargetAssignment({ surveyId, contactTargetId: t2!, assignmentId: owner.id });

    expect(await removeAssignment({ surveyId, id: owner.id })).toEqual({ unassigned: 2 });
    expect(await assignmentOf(t1!)).toBeNull();
    expect(await assignmentOf(t2!)).toBeNull();
    expect(await listAssignmentOptions(surveyId, 'real')).toEqual([]);
  });

  it('순서를 바꾸고, 목록이 바뀐 뒤의 순서 요청은 거부한다 — 이름 바꾸기는 중복을 거부한다', async () => {
    const surveyId = await seedSurvey();
    const a = await createAssignment({ surveyId, name: 'A' });
    const b = await createAssignment({ surveyId, name: 'B' });
    const c = await createAssignment({ surveyId, name: 'C' });

    await reorderAssignments({ surveyId, ids: [c.id, a.id, b.id] });
    expect((await listAssignmentOptions(surveyId, 'real')).map((o) => o.name)).toEqual([
      'C',
      'A',
      'B',
    ]);

    await expect(reorderAssignments({ surveyId, ids: [a.id, b.id] })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    await renameAssignment({ surveyId, id: a.id, name: 'A2' });
    await expect(renameAssignment({ surveyId, id: b.id, name: 'C' })).rejects.toBeInstanceOf(
      DuplicateAssignmentNameError,
    );
    expect((await listAssignmentOptions(surveyId, 'real')).map((o) => o.name)).toEqual([
      'C',
      'A2',
      'B',
    ]);
  });

  describe('교체 적용', () => {
    it('조건 결과 = 이 컨택원 배정 — 다른 컨택원에서 옮겨 오고, 조건 밖은 배정 없음', async () => {
      const surveyId = await seedSurvey();
      const ids = await seedTargets(surveyId, 10);
      const tenth = await createAssignment({ surveyId, name: '10차' });
      const eleventh = await createAssignment({ surveyId, name: '11차' });
      // 10차: 1, 9 / 11차: 2
      await setTargetAssignment({ surveyId, contactTargetId: ids[0]!, assignmentId: tenth.id });
      await setTargetAssignment({ surveyId, contactTargetId: ids[8]!, assignmentId: tenth.id });
      await setTargetAssignment({ surveyId, contactTargetId: ids[1]!, assignmentId: eleventh.id });

      // 1-6 중 짝수 → 2, 4, 6
      const clauses = [
        { source: 'system.resid', value: '1-6', op: '' as const },
        { source: 'system.resid', value: '짝수', op: 'AND' as const },
      ];
      const preview = await previewAssignment(
        { surveyId, assignmentId: tenth.id, clauses },
        'real',
      );
      expect(preview).toEqual({
        matched: 3,
        current: 2,
        incoming: 2,
        fromOthers: [{ id: eleventh.id, name: '11차', count: 1 }],
        leaving: 2,
      });

      const applied = await applyAssignment({ surveyId, assignmentId: tenth.id, clauses });
      expect(applied).toEqual(preview);

      const owners = await Promise.all(ids.map((id) => assignmentOf(id)));
      expect(owners).toEqual([
        null, // 1 — 조건 밖이라 풀림
        tenth.id, // 2 — 11차에서 옮겨 옴
        null,
        tenth.id, // 4
        null,
        tenth.id, // 6
        null,
        null,
        null, // 9 — 조건 밖이라 풀림
        null,
      ]);

      const [saved] = await db
        .select({ c: contactAssignments.lastClauses, at: contactAssignments.lastAppliedAt })
        .from(contactAssignments)
        .where(eq(contactAssignments.id, tenth.id));
      expect(saved?.c).toEqual(clauses);
      expect(saved?.at).toBeInstanceOf(Date);
    });

    it('미리보기 뒤 명단이 바뀌면 적용 시점 결과로 반영된다 — 결과 0명도 적용된다', async () => {
      const surveyId = await seedSurvey();
      const ids = await seedTargets(surveyId, 3);
      const owner = await createAssignment({ surveyId, name: '10차' });
      await setTargetAssignment({ surveyId, contactTargetId: ids[2]!, assignmentId: owner.id });
      const clauses = [{ source: 'attrs.기업명', value: '기업1', op: '' as const }];

      const preview = await previewAssignment({ surveyId, assignmentId: owner.id, clauses }, 'real');
      expect(preview.matched).toBe(1);
      // 미리보기 뒤 대상 1의 기업명이 바뀌었다 → 적용 시점에는 0명
      await db
        .update(contactTargets)
        .set({ attrs: { 기업명: '바뀐기업' } })
        .where(eq(contactTargets.id, ids[0]!));
      const applied = await applyAssignment({ surveyId, assignmentId: owner.id, clauses });
      expect(applied).toMatchObject({ matched: 0, current: 1, leaving: 1 });
      expect(await Promise.all(ids.map((id) => assignmentOf(id)))).toEqual([null, null, null]);
    });

    it('명단 열 「— 제외하고 보기」(값 있는 대상 전부)·「— 인 것만 보기」로 배정한다', async () => {
      const surveyId = await seedSurvey();
      const ids = await seedTargets(surveyId, 4);
      // 기업명: 기업1, (빈 값), 기업3, (키 없음)
      await db.update(contactTargets).set({ attrs: { 기업명: '' } }).where(eq(contactTargets.id, ids[1]!));
      await db.update(contactTargets).set({ attrs: {} }).where(eq(contactTargets.id, ids[3]!));
      const owner = await createAssignment({ surveyId, name: '10차' });

      const withValue = await applyAssignment({
        surveyId,
        assignmentId: owner.id,
        clauses: [
          { source: 'attrs.기업명', value: encodeMultiClauseValue([FILTER_NOT_NONE_VALUE]), op: '' },
        ],
      });
      expect(withValue.matched).toBe(2);
      expect(await Promise.all(ids.map((id) => assignmentOf(id)))).toEqual([
        owner.id,
        null,
        owner.id,
        null,
      ]);

      const empty = await previewAssignment(
        {
          surveyId,
          assignmentId: owner.id,
          clauses: [
            { source: 'attrs.기업명', value: encodeMultiClauseValue([FILTER_NONE_VALUE]), op: '' },
          ],
        },
        'real',
      );
      expect(empty.matched).toBe(2);
    });

    it('해석이 안 되는 조건·모르는 저장 목록은 거부한다 — 조건이 넓어지지 않는다', async () => {
      const surveyId = await seedSurvey();
      const ids = await seedTargets(surveyId, 2);
      const owner = await createAssignment({ surveyId, name: '10차' });
      await setTargetAssignment({ surveyId, contactTargetId: ids[0]!, assignmentId: owner.id });

      await expect(
        applyAssignment({
          surveyId,
          assignmentId: owner.id,
          clauses: [{ source: 'attrs.없는열', value: 'x', op: '' }],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        applyAssignment({
          surveyId,
          assignmentId: owner.id,
          clauses: [
            { source: 'system.resid', value: `list:${randomUUID()}:3000`, op: '' },
          ],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await assignmentOf(ids[0]!)).toBe(owner.id);
    });

    it('테스트 파티션 컨택원은 실데이터 세션에서 적용되지 않고 대상도 파티션 안에서만 고른다', async () => {
      const surveyId = await seedSurvey({ testMode: true });
      const [realT] = await seedTargets(surveyId, 1, false);
      const [testT] = await seedTargets(surveyId, 1, true);
      viewTest(true);
      const testOwner = await createAssignment({ surveyId, name: '테스트 10차' });
      const clauses = [{ source: 'system.resid', value: '1', op: '' as const }];

      viewTest(false);
      await expect(
        applyAssignment({ surveyId, assignmentId: testOwner.id, clauses }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      viewTest(true);
      const applied = await applyAssignment({ surveyId, assignmentId: testOwner.id, clauses });
      expect(applied.matched).toBe(1);
      expect(await assignmentOf(testT!)).toBe(testOwner.id);
      expect(await assignmentOf(realT!)).toBeNull();
    });

    it('「현재 컨택원」·「배정 없음」 조건 — 옮겨 온 대상이 같은 적용 안에서 다시 풀리지 않는다', async () => {
      const surveyId = await seedSurvey();
      const ids = await seedTargets(surveyId, 4);
      const a = await createAssignment({ surveyId, name: 'A' });
      const b = await createAssignment({ surveyId, name: 'B' });
      // 1 → B, 2 → B, 3 → A, 4 → 없음
      await setTargetAssignment({ surveyId, contactTargetId: ids[0]!, assignmentId: b.id });
      await setTargetAssignment({ surveyId, contactTargetId: ids[1]!, assignmentId: b.id });
      await setTargetAssignment({ surveyId, contactTargetId: ids[2]!, assignmentId: a.id });

      // A 를 「지금 B 인 대상」으로 교체 → 1, 2 가 A, 3 은 빠짐
      const fromB = await applyAssignment({
        surveyId,
        assignmentId: a.id,
        clauses: [{ source: 'system.contact_owner', value: b.id, op: '' }],
      });
      expect(fromB).toMatchObject({ matched: 2, current: 1, leaving: 1 });
      expect(await Promise.all(ids.map((id) => assignmentOf(id)))).toEqual([a.id, a.id, null, null]);

      // A 를 「지금 배정 없음」으로 교체 → 3, 4 가 A, 지금 A 인 1, 2 는 빠진다(다시 돌아오지 않는다)
      const fromNone = await applyAssignment({
        surveyId,
        assignmentId: a.id,
        clauses: [{ source: 'system.contact_owner', value: FILTER_NONE_VALUE, op: '' }],
      });
      expect(fromNone).toMatchObject({ matched: 2, current: 2, incoming: 2, leaving: 2 });
      expect(await Promise.all(ids.map((id) => assignmentOf(id)))).toEqual([null, null, a.id, a.id]);
    });

    it('데드락으로 취소되면 자동으로 다시 실행해 성공한다 — 나중에 끝난 쪽이 이긴다', async () => {
      const surveyId = await seedSurvey();
      const [t1, t2] = await seedTargets(surveyId, 2);
      const owner = await createAssignment({ surveyId, name: '10차' });
      const clauses = [{ source: 'system.resid', value: '1-2', op: '' as const }];

      // 다른 작업 T 가 대상 2 를 먼저 잠근다.
      let releaseT!: () => void;
      const tHoldsT2 = new Promise<void>((resolve) => {
        releaseT = resolve;
      });
      let tLocked!: () => void;
      const tReady = new Promise<void>((resolve) => {
        tLocked = resolve;
      });
      const other = db.transaction(async (tx) => {
        // 데드락 판정은 먼저 기다리기 시작한 교체 적용 쪽에서 나게 한다(이쪽은 늦게 판정).
        await tx.execute(sql`SET LOCAL deadlock_timeout = '10s'`);
        await tx.execute(sql`SELECT id FROM contact_targets WHERE id = ${t2!} FOR UPDATE`);
        tLocked();
        await tHoldsT2;
        // 교체 적용이 대상 1 을 쥔 채 대상 2 를 기다리는 동안, T 가 대상 1 을 바꾸려 한다 → 교착.
        await tx.execute(sql`UPDATE contact_targets SET memo = 'T' WHERE id = ${t1!}`);
      });
      await tReady;

      const applying = applyAssignment({ surveyId, assignmentId: owner.id, clauses });
      // 교체 적용이 행 잠금을 기다리기 시작할 때까지 본다.
      for (let i = 0; i < 100; i++) {
        const waiting = await db.execute(sql`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query ILIKE 'update "contact_targets"%'
        `);
        if (Number((waiting as unknown as Array<{ n: number }>)[0]?.n ?? 0) > 0) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      releaseT();

      await other;
      const applied = await applying;
      expect(applied.matched).toBe(2);
      expect(await assignmentOf(t1!)).toBe(owner.id);
      expect(await assignmentOf(t2!)).toBe(owner.id);
      const [memo] = await db
        .select({ memo: contactTargets.memo })
        .from(contactTargets)
        .where(eq(contactTargets.id, t1!));
      expect(memo?.memo).toBe('T');
    }, 30_000);

    it('다른 컨택원 둘이 겹치는 대상에 동시에 여러 번 적용해도 전부 성공하고 남는 배정은 둘 중 하나다', async () => {
      const surveyId = await seedSurvey();
      const ids = await seedTargets(surveyId, 40);
      const a = await createAssignment({ surveyId, name: 'A' });
      const b = await createAssignment({ surveyId, name: 'B' });
      const odd = [{ source: 'system.resid', value: '1-30', op: '' as const }];
      const even = [{ source: 'system.resid', value: '11-40', op: '' as const }];

      const runs = Array.from({ length: 8 }, (_, i) =>
        i % 2 === 0
          ? applyAssignment({ surveyId, assignmentId: a.id, clauses: odd })
          : applyAssignment({ surveyId, assignmentId: b.id, clauses: even }),
      );
      const settled = await Promise.allSettled(runs);
      expect(settled.filter((r) => r.status === 'rejected')).toEqual([]);

      const owners = await Promise.all(ids.map((id) => assignmentOf(id)));
      // 1-10 은 A 만, 31-40 은 B 만 조건이고, 겹치는 11-30 은 둘 중 하나다.
      expect(owners.slice(0, 10).every((o) => o === a.id)).toBe(true);
      expect(owners.slice(30).every((o) => o === b.id)).toBe(true);
      expect(owners.slice(10, 30).every((o) => o === a.id || o === b.id)).toBe(true);
    }, 30_000);

    it('같은 컨택원 동시 적용은 직렬화되어 한쪽 결과로 깔끔히 정리된다', async () => {
      const surveyId = await seedSurvey();
      const ids = await seedTargets(surveyId, 20);
      const owner = await createAssignment({ surveyId, name: '10차' });
      const odd = [{ source: 'system.resid', value: '홀수', op: '' as const }];
      const even = [{ source: 'system.resid', value: '짝수', op: '' as const }];

      await Promise.all([
        applyAssignment({ surveyId, assignmentId: owner.id, clauses: odd }),
        applyAssignment({ surveyId, assignmentId: owner.id, clauses: even }),
      ]);

      const owners = await Promise.all(ids.map((id) => assignmentOf(id)));
      const assigned = owners.map((o, i) => (o === owner.id ? i + 1 : null)).filter((n) => n != null);
      const allOdd = assigned.every((n) => n! % 2 === 1);
      const allEven = assigned.every((n) => n! % 2 === 0);
      expect(assigned).toHaveLength(10);
      expect(allOdd || allEven).toBe(true);
    });
  });

  describe('수정 화면 오른쪽 패널', () => {
    it('값 목록 인원은 명단 전체 기준이고, 체크한 값들(여러 값) 조건이 같은 인원을 낸다', async () => {
      const surveyId = await seedSurvey();
      const ids = await seedTargets(surveyId, 5);
      // 기업명: 기업1..기업5 → 일부를 같은 값으로
      await db
        .update(contactTargets)
        .set({ attrs: { 기업명: 'A' } })
        .where(inArray(contactTargets.id, [ids[0]!, ids[1]!]));
      await db
        .update(contactTargets)
        .set({ attrs: { 기업명: '' } })
        .where(eq(contactTargets.id, ids[4]!));
      const owner = await createAssignment({ surveyId, name: '10차' });

      const facets = await listAssignmentFacets(surveyId, 'real', 'attrs.기업명');
      expect(facets).toEqual({
        kind: 'values',
        // 헤더 필터 값 목록과 같은 정렬(ko 자연 정렬 — 한글이 먼저).
        values: [
          { value: '기업3', label: '기업3', count: 1 },
          { value: '기업4', label: '기업4', count: 1 },
          { value: 'A', label: 'A', count: 2 },
          { value: FILTER_NONE_VALUE, label: '— (없음)', count: 1 },
        ],
        total: 5,
      });

      const clauses = [
        { source: 'attrs.기업명', value: encodeMultiClauseValue(['A', FILTER_NONE_VALUE]), op: '' as const },
      ];
      const preview = await previewAssignment({ surveyId, assignmentId: owner.id, clauses }, 'real');
      expect(preview.matched).toBe(3);
      const page = await listAssignmentMatches({ surveyId, clauses, page: 1 }, 'real');
      expect(page.total).toBe(3);
      expect(page.rows.map((r) => r.resid)).toEqual([1, 2, 5]);

      const ownerFacets = await listAssignmentFacets(surveyId, 'real', 'system.contact_owner');
      expect(ownerFacets).toMatchObject({
        kind: 'values',
        values: [
          { value: owner.id, label: '10차', count: 0 },
          { value: FILTER_NONE_VALUE, count: 5 },
        ],
      });
      expect(await listAssignmentFacets(surveyId, 'real', 'system.resid')).toEqual({ kind: 'many' });
    });
  });

  describe('목록에서 배정', () => {
    const emptyFilter = { col: [], q: [], op: [], hcol: [], hm: [], hv: [] };

    it('얹기 — 결과 대상만 옮기고 그 컨택원의 기존 배정은 남는다', async () => {
      const surveyId = await seedSurvey();
      const ids = await seedTargets(surveyId, 6);
      const tenth = await createAssignment({ surveyId, name: '10차' });
      const eleventh = await createAssignment({ surveyId, name: '11차' });
      await setTargetAssignment({ surveyId, contactTargetId: ids[5]!, assignmentId: eleventh.id }); // 6 → 11차 (조건 밖)
      await setTargetAssignment({ surveyId, contactTargetId: ids[0]!, assignmentId: tenth.id }); // 1 → 10차

      const filter = { ...emptyFilter, col: ['system.resid'], q: ['1-3'], op: [''] };
      const preview = await previewAssignFromList(
        { surveyId, assignmentId: eleventh.id, filter },
        'real',
      );
      expect(preview).toEqual({
        matched: 3,
        targetCurrent: 1,
        groups: [
          { id: tenth.id, name: '10차', count: 1 },
          { id: null, name: null, count: 2 },
        ],
      });

      const applied = await assignFromList({ surveyId, assignmentId: eleventh.id, filter });
      expect(applied).toEqual(preview);
      expect(await Promise.all(ids.map((id) => assignmentOf(id)))).toEqual([
        eleventh.id,
        eleventh.id,
        eleventh.id,
        null,
        null,
        eleventh.id, // 기존 배정 유지
      ]);
    });

    it('풀기 — 검색 결과의 배정이 없어진다 (열 머리 필터 조건)', async () => {
      const surveyId = await seedSurvey();
      const ids = await seedTargets(surveyId, 3);
      const tenth = await createAssignment({ surveyId, name: '10차' });
      const eleventh = await createAssignment({ surveyId, name: '11차' });
      await setTargetAssignment({ surveyId, contactTargetId: ids[0]!, assignmentId: tenth.id });
      await setTargetAssignment({ surveyId, contactTargetId: ids[1]!, assignmentId: tenth.id });
      await setTargetAssignment({ surveyId, contactTargetId: ids[2]!, assignmentId: eleventh.id });
      const filter = {
        ...emptyFilter,
        hcol: ['system.contact_owner'],
        hm: ['in'],
        hv: [tenth.id],
      };
      const applied = await assignFromList({ surveyId, assignmentId: null, filter });
      expect(applied.groups).toEqual([{ id: tenth.id, name: '10차', count: 2 }]);
      expect(await Promise.all(ids.map((id) => assignmentOf(id)))).toEqual([
        null,
        null,
        eleventh.id,
      ]);
    });

    it('목록이 쓸 수 없는 열 머리 필터가 섞이면 전체로 넓히지 않고 거부한다', async () => {
      const surveyId = await seedSurvey();
      const ids = await seedTargets(surveyId, 2);
      const tenth = await createAssignment({ surveyId, name: '10차' });
      await setTargetAssignment({ surveyId, contactTargetId: ids[0]!, assignmentId: tenth.id });
      const filter = { ...emptyFilter, hcol: ['system.resid'], hm: ['text'], hv: ['1'] };
      await expect(assignFromList({ surveyId, assignmentId: null, filter })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect(await assignmentOf(ids[0]!)).toBe(tenth.id);
    });

    it('미리보기 뒤 조건의 컨택원이 지워지면 전체로 넓히지 않고 거부한다', async () => {
      const surveyId = await seedSurvey();
      const ids = await seedTargets(surveyId, 3);
      const a = await createAssignment({ surveyId, name: 'A' });
      const b = await createAssignment({ surveyId, name: 'B' });
      await setTargetAssignment({ surveyId, contactTargetId: ids[0]!, assignmentId: b.id });
      await setTargetAssignment({ surveyId, contactTargetId: ids[1]!, assignmentId: a.id });
      const filter = { ...emptyFilter, hcol: ['system.contact_owner'], hm: ['in'], hv: [b.id] };

      expect(
        (await previewAssignFromList({ surveyId, assignmentId: a.id, filter }, 'real')).matched,
      ).toBe(1);
      await removeAssignment({ surveyId, id: b.id });

      await expect(assignFromList({ surveyId, assignmentId: a.id, filter })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      await expect(assignFromList({ surveyId, assignmentId: null, filter })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      await expect(
        assignFromList({
          surveyId,
          assignmentId: a.id,
          filter: { ...emptyFilter, col: ['system.contact_owner'], q: [b.id], op: [''] },
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      // 아무것도 바뀌지 않았다 (1 은 B 삭제로 배정 없음, 2 는 A 그대로, 3 은 없음).
      expect(await Promise.all(ids.map((id) => assignmentOf(id)))).toEqual([null, a.id, null]);
    });

    it('저장 ID 목록 토큰 조건에서도 동작하고 파티션을 넘지 않는다', async () => {
      const surveyId = await seedSurvey({ testMode: true });
      const ids = await seedTargets(surveyId, 4);
      const [testTarget] = await seedTargets(surveyId, 1, true);
      const owner = await createAssignment({ surveyId, name: '10차' });
      const list = await createContactIdList({ surveyId, ids: [2, 4], createdBy: null });
      const filter = {
        ...emptyFilter,
        col: ['system.resid'],
        q: [formatIdListToken(list.id, list.count)],
        op: [''],
      };
      const applied = await assignFromList({ surveyId, assignmentId: owner.id, filter });
      expect(applied.matched).toBe(2);
      expect(await Promise.all(ids.map((id) => assignmentOf(id)))).toEqual([
        null,
        owner.id,
        null,
        owner.id,
      ]);
      // 테스트 파티션 대상(resid 1)은 실 컨택원 조건에 걸리지 않는다.
      expect(await assignmentOf(testTarget!)).toBeNull();

      viewTest(true);
      await expect(
        assignFromList({ surveyId, assignmentId: owner.id, filter: emptyFilter }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('진척 보고 「컨택원」 기준', () => {
    const OWNER = { kind: 'system', key: 'contact_owner' } as const;

    it('컨택원별 줄(순서대로) + 배정 없음 한 줄, 다른 기준과 섞이고 합계가 맞다', async () => {
      const surveyId = await seedSurvey();
      const ids = await seedTargets(surveyId, 5);
      const tenth = await createAssignment({ surveyId, name: '10차' });
      const eleventh = await createAssignment({ surveyId, name: '11차' });
      await reorderAssignments({ surveyId, ids: [eleventh.id, tenth.id] }); // 11차가 먼저
      await setTargetAssignment({ surveyId, contactTargetId: ids[0]!, assignmentId: tenth.id });
      await setTargetAssignment({ surveyId, contactTargetId: ids[1]!, assignmentId: tenth.id });
      await setTargetAssignment({ surveyId, contactTargetId: ids[2]!, assignmentId: eleventh.id });
      // 4, 5 는 배정 없음. 대상 1 은 응답 완료.
      await db.insert(surveyResponses).values({
        surveyId,
        contactTargetId: ids[0]!,
        questionResponses: {},
        status: 'completed',
        isCompleted: true,
      });
      await db
        .update(contactTargets)
        .set({ attrs: { 기업명: '갑' } })
        .where(inArray(contactTargets.id, [ids[0]!, ids[3]!]));

      const base = {
        surveyId,
        scope: 'real' as const,
        condition: null,
        page: 1,
        size: 20,
        metaKeys: [],
      };
      const byOwner = await getProgressRows({
        ...base,
        sort: `group:system:contact_owner`,
        dir: 'asc',
        groupByKeys: [OWNER],
      });
      expect(byOwner.map((r) => [r.groupLabel, r.groupValues, r.listCount, r.completedCount])).toEqual([
        ['11차', ['11차'], 1, 0],
        ['10차', ['10차'], 2, 1],
        ['(배정 없음)', [null], 2, 0],
      ]);

      const totals = await getProgressTotals(surveyId, 'real', null, [OWNER]);
      expect(totals).toMatchObject({ groupCount: 3, listTotal: 5, completedTotal: 1 });

      const mixed = await getProgressRows({
        ...base,
        sort: 'groupLabel',
        dir: 'asc',
        groupByKeys: [{ kind: 'attrs', key: '기업명' }, OWNER],
      });
      const combo = new Map(mixed.map((r) => [r.groupLabel, r.listCount]));
      expect(combo.get('갑 / 10차')).toBe(1);
      expect(combo.get('갑 / (배정 없음)')).toBe(1);
      expect(combo.get('기업2 / 10차')).toBe(1);
      expect(combo.get('기업3 / 11차')).toBe(1);
      expect(combo.get('기업5 / (배정 없음)')).toBe(1);
      expect((await getProgressTotals(surveyId, 'real', null, [{ kind: 'attrs', key: '기업명' }, OWNER])).groupCount).toBe(5);
    });
  });

  describe('명단 업로드 · 테스트 모드 끄기', () => {
    async function xlsx(rows: string[][]): Promise<File> {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      ws.addRow(['idx', '회사']);
      for (const r of rows) ws.addRow(r);
      return new File([await wb.xlsx.writeBuffer()], 'roster.xlsx');
    }
    const mapping = (mode: 'replace' | 'merge') => ({
      systemFields: {},
      selectedAttrsKeys: ['idx', '회사'],
      headerRow: 1,
      sheetName: 'Sheet1',
      mode,
      ...(mode === 'merge' ? { mergeKeys: ['idx'], unmatchedPolicy: 'skip' as const } : {}),
    });

    async function seedUploaded(): Promise<{ surveyId: string; ownerId: string }> {
      const surveyId = randomUUID();
      await db.insert(surveys).values({ id: surveyId, title: '업로드 배정 실DB' });
      createdSurveyIds.push(surveyId);
      await ingestContactUpload({
        surveyId,
        file: await xlsx([
          ['1', 'A'],
          ['2', 'B'],
        ]),
        mapping: mapping('replace'),
      });
      const owner = await createAssignment({ surveyId, name: '10차' });
      const targets = await db
        .select({ id: contactTargets.id })
        .from(contactTargets)
        .where(eq(contactTargets.surveyId, surveyId));
      for (const t of targets) {
        await setTargetAssignment({ surveyId, contactTargetId: t.id, assignmentId: owner.id });
      }
      expect(await countAssignedTargets(surveyId, 'real')).toBe(2);
      return { surveyId, ownerId: owner.id };
    }

    it('교체 업로드 후 배정은 풀리고 컨택원은 남는다', async () => {
      const { surveyId, ownerId } = await seedUploaded();
      await ingestContactUpload({
        surveyId,
        file: await xlsx([
          ['1', 'A'],
          ['3', 'C'],
        ]),
        mapping: mapping('replace'),
      });
      expect(await countAssignedTargets(surveyId, 'real')).toBe(0);
      expect((await listAssignmentOptions(surveyId, 'real')).map((o) => o.id)).toEqual([ownerId]);
    });

    it('병합 업로드 후 배정은 그대로다', async () => {
      const { surveyId, ownerId } = await seedUploaded();
      await ingestContactUpload({
        surveyId,
        file: await xlsx([['1', 'A2']]),
        mapping: mapping('merge'),
      });
      const rows = await db
        .select({ a: contactTargets.assignmentId })
        .from(contactTargets)
        .where(eq(contactTargets.surveyId, surveyId));
      expect(rows.map((r) => r.a)).toEqual([ownerId, ownerId]);
    });

    it('테스트 모드를 지우며 끄면 테스트 컨택원이 없어지고 실 컨택원은 그대로다', async () => {
      const surveyId = await seedSurvey({ testMode: true });
      const real = await createAssignment({ surveyId, name: '실 10차' });
      viewTest(true);
      await createAssignment({ surveyId, name: '테스트 10차' });

      await disableTestWorkspace({ surveyId, disposition: 'delete' });
      expect(await listAssignmentOptions(surveyId, 'test')).toEqual([]);
      expect((await listAssignmentOptions(surveyId, 'real')).map((o) => o.id)).toEqual([real.id]);
    });
  });
});
