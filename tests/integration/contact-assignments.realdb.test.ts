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
  previewAssignment,
} from '@/server/contacts/services/contact-assignment-apply';
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
});
