/**
 * 게스트 담당 범위 — 실 DB (`.scratch/guest-target-share/PRD.md`).
 *
 * 한 설문을 외주 업체 둘(프롬·프라임)이 나눠 뛸 때, 각 게스트 계정이 **자기 명단 값의 조사 대상과 그 대상의
 * 응답·회차만** 보고 건드리는지 본다. 목은 WHERE 를 모르므로 범위 경계는 실DB 로만 증명한다.
 * 주체가 바깥에서 보는 결과만 단언한다 — 술어의 SQL 문자열은 보지 않는다.
 *
 * 범위 등재(`guest-grants` 의 GUEST_TARGET_SHARES)가 코드에 박힌 실제 (계정, 설문) 쌍이라, 그 설문 id 로
 * 시드한다. 같은 id 의 설문이 이미 있는 DB(운영 데이터를 덤프한 로컬 DB 등)에서는 남의 데이터를 건드리지
 * 않도록 시작 전에 멈춘다 — `pnpm db:isolated <이름>` 으로 만든 전용 DB 에서 돌릴 것.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<전용 DB> pnpm exec vitest run <이 파일>. 일반 pnpm test 에서는 스킵된다.
 */
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  contactAttempts,
  contactTargets,
  surveyResponses,
  surveyVersions,
  surveys,
} from '@/db/schema';
import { addAttempt, deleteAttempt, updateAttempt } from '@/server/contacts/services/contact-attempts';
import {
  countNonNumericAttrValues,
  listContactAttrValues,
} from '@/server/contacts/services/contact-attr-values';
import { addContactTarget, updateContactTarget } from '@/server/contacts/services/contact-targets';
import { loadPreviewContactSeed } from '@/server/contacts/services/preview-contact';
import {
  FIELDWORK_SHARE_ALL,
  type FieldworkShare,
  resolveGuestShare,
} from '@/server/fieldwork-share-scope';
import { sendSingleCampaign } from '@/server/mail/services/single-send';
import {
  aggregateDaily,
  aggregateDailyAvailableDates,
} from '@/server/operations/services/aggregate-daily';
import { aggregateStatus } from '@/server/operations/services/aggregate-status';
import { getDailyStats } from '@/server/operations/services/daily-stats';
import { getDropFunnel } from '@/server/operations/services/drop-funnel';
import { getPageDwell } from '@/server/operations/services/page-dwell';
import { listResponsesForProfiles } from '@/server/operations/services/profiles';
import {
  countContactTargets,
  getProgressRows,
  getProgressTotals,
} from '@/server/operations/services/report-progress';
import { getResponseTime } from '@/server/operations/services/response-time';
import {
  loadContactFilterContext,
  resolveContactFilter,
} from '@/server/read-models/contact-filter-resolution';
import { getContactSampleById } from '@/server/read-models/contact-sample';
import { getContactDetailById, listContactsForSurvey } from '@/server/read-models/contacts';
import { getResponseById } from '@/server/read-models/responses';
import { saveAdminEdit } from '@/server/survey-response/services/response-edit';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

// 요청 밖이라 쿠키가 없다 — 콘솔은 실데이터 파티션을 본다(server/data-scope).
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

// guest-grants.ts 의 GUEST_TARGET_SHARES 에 박힌 실제 쌍
const FROM2 = 'ddcdc638-3cc2-4a84-acd9-204b66b57e28';
const PRIME2 = '882ddaa3-f52b-4c7b-8837-0dcffc44575d';
const SURVEY_ID = '1b88ae5a-257a-40ad-80a4-a6a698fde05a';
const SHARE_KEY = '실사업체';

const SCHEME: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
    { key: '기업체명', label: '기업체명', source: 'attrs.기업체명', order: 2 },
    { key: SHARE_KEY, label: SHARE_KEY, source: `attrs.${SHARE_KEY}`, order: 3 },
  ],
};

/** 시스템ID → 범위 값. 6번은 어느 업체에도 속하지 않는다(관리자만 본다). */
const OWNER_BY_RESID: Record<number, string | null> = {
  1: '프롬',
  2: '프롬',
  3: '프롬',
  4: '프라임',
  5: '프라임',
  6: null,
};

const editor = { id: null, email: 'vendor@local' };

run('게스트 담당 범위 (real DB)', () => {
  const targetIdByResid = new Map<number, string>();
  /** 응답 id — 프롬 대상(1번)의 완료, 프라임 대상(4번)의 완료, 대상 없는 공개 응답 */
  const responses = { from: '', prime: '', open: '' };
  let versionId = '';
  let fromShare: FieldworkShare;
  let primeShare: FieldworkShare;
  const prevEnv = {
    grants: process.env['GUEST_SURVEY_GRANTS'],
    admins: process.env['ADMIN_USER_IDS'],
  };

  const targetId = (resid: number) => {
    const id = targetIdByResid.get(resid);
    if (!id) throw new Error(`시드에 없는 대상: ${resid}`);
    return id;
  };

  beforeAll(async () => {
    const [existing] = await db.select({ id: surveys.id }).from(surveys).where(eq(surveys.id, SURVEY_ID));
    if (existing) {
      throw new Error(
        `설문 ${SURVEY_ID} 이 이미 있는 DB 입니다 — 남의 데이터를 건드리지 않도록 멈춥니다. pnpm db:isolated 로 만든 전용 DB 에서 돌리세요.`,
      );
    }
    process.env['ADMIN_USER_IDS'] = 'admin-1';
    process.env['GUEST_SURVEY_GRANTS'] = `${FROM2}:${SURVEY_ID},${PRIME2}:${SURVEY_ID}`;
    fromShare = resolveGuestShare(FROM2, SURVEY_ID);
    primeShare = resolveGuestShare(PRIME2, SURVEY_ID);

    await db.insert(surveys).values({
      id: SURVEY_ID,
      title: '담당 범위 실DB',
      status: 'published',
      contactColumns: SCHEME,
      testContactColumns: SCHEME,
    });
    const [version] = await db
      .insert(surveyVersions)
      .values({
        surveyId: SURVEY_ID,
        versionNumber: 1,
        status: 'published',
        snapshot: {
          settings: {
            isPublic: true,
            allowMultipleResponses: false,
            showProgressBar: true,
            shuffleQuestions: false,
            requireLogin: false,
            thankYouMessage: '',
          },
          questions: [{ id: 'q1', type: 'text', title: '문1', required: false, order: 0 }],
        } as never,
        publishedAt: new Date(),
      })
      .returning();
    if (!version) throw new Error('버전 시드 실패');
    versionId = version.id;
    await db.update(surveys).set({ currentVersionId: versionId }).where(eq(surveys.id, SURVEY_ID));

    for (const [residText, owner] of Object.entries(OWNER_BY_RESID)) {
      const resid = Number(residText);
      const id = randomUUID();
      targetIdByResid.set(resid, id);
      await db.insert(contactTargets).values({
        id,
        surveyId: SURVEY_ID,
        resid,
        isTest: false,
        attrs: { 기업체명: `기업${resid}`, ...(owner ? { [SHARE_KEY]: owner } : {}) },
        inviteCode: randomUUID(),
      });
    }

    const seedResponse = async (contactTargetId: string | null) => {
      const [row] = await db
        .insert(surveyResponses)
        .values({
          surveyId: SURVEY_ID,
          versionId,
          sessionId: `seed-${randomUUID()}`,
          status: 'completed',
          isCompleted: true,
          completedAt: new Date(),
          contactTargetId,
          questionResponses: { q1: '답' },
        })
        .returning();
      if (!row) throw new Error('응답 시드 실패');
      return row.id;
    };
    responses.from = await seedResponse(targetId(1));
    responses.prime = await seedResponse(targetId(4));
    responses.open = await seedResponse(null);
  });

  afterAll(async () => {
    await db.delete(surveyResponses).where(eq(surveyResponses.surveyId, SURVEY_ID));
    await db.update(surveys).set({ currentVersionId: null }).where(eq(surveys.id, SURVEY_ID));
    await db.delete(surveyVersions).where(eq(surveyVersions.surveyId, SURVEY_ID));
    await db.delete(surveys).where(eq(surveys.id, SURVEY_ID));
    if (prevEnv.grants === undefined) delete process.env['GUEST_SURVEY_GRANTS'];
    else process.env['GUEST_SURVEY_GRANTS'] = prevEnv.grants;
    if (prevEnv.admins === undefined) delete process.env['ADMIN_USER_IDS'];
    else process.env['ADMIN_USER_IDS'] = prevEnv.admins;
  });

  async function listResids(share: FieldworkShare, isGuest: boolean) {
    const ctx = await loadContactFilterContext(SURVEY_ID, 'real', {
      isGuest,
      surface: 'contacts',
      share,
    });
    const filter = await resolveContactFilter(ctx, {}, { mode: 'read' });
    const { rows, total } = await listContactsForSurvey({
      surveyId: SURVEY_ID,
      scope: 'real',
      filter,
      page: 1,
      pageSize: 50,
      sort: 'resid',
      dir: 'asc',
      includeAssignment: !isGuest,
    });
    return { resids: rows.map((r) => r.resid), total };
  }

  it('해석 — 두 계정은 서로 다른 범위, 관리자는 전체다', () => {
    expect(fromShare).toMatchObject({ kind: 'targets', value: '프롬' });
    expect(primeShare).toMatchObject({ kind: 'targets', value: '프라임' });
    expect(resolveGuestShare('admin-1', SURVEY_ID)).toEqual(FIELDWORK_SHARE_ALL);
  });

  it('조사 대상 목록 — 자기 범위의 대상만, 값이 빈 대상은 관리자만 본다', async () => {
    expect(await listResids(fromShare, true)).toEqual({ resids: [1, 2, 3], total: 3 });
    expect(await listResids(primeShare, true)).toEqual({ resids: [4, 5], total: 2 });
    expect(await listResids(FIELDWORK_SHARE_ALL, false)).toEqual({
      resids: [1, 2, 3, 4, 5, 6],
      total: 6,
    });
  });

  it('사용자가 고른 조건으로 범위를 벗어날 수 없다 — 남의 범위 값을 조건으로 넣어도 0건이다', async () => {
    const ctx = await loadContactFilterContext(SURVEY_ID, 'real', {
      isGuest: true,
      surface: 'contacts',
      share: fromShare,
    });
    const filter = await resolveContactFilter(
      ctx,
      { clauses: [{ source: `attrs.${SHARE_KEY}`, value: '프라임', op: null }] },
      { mode: 'read' },
    );
    const { rows, total } = await listContactsForSurvey({
      surveyId: SURVEY_ID,
      scope: 'real',
      filter,
      page: 1,
      pageSize: 50,
      sort: 'resid',
      dir: 'asc',
      includeAssignment: false,
    });
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it('필터 값 목록 — 자기 범위 대상의 값만 담는다', async () => {
    const values = async (share: FieldworkShare, attrsKey: string) =>
      (await listContactAttrValues({ surveyId: SURVEY_ID, attrsKey, scope: 'real', share })).values;
    expect(await values(fromShare, '기업체명')).toEqual(['기업1', '기업2', '기업3']);
    expect(await values(primeShare, '기업체명')).toEqual(['기업4', '기업5']);
    // 범위 열 자체의 값 목록에도 남의 업체 이름이 없다
    expect(await values(fromShare, SHARE_KEY)).toEqual(['프롬']);
    expect((await values(FIELDWORK_SHARE_ALL, SHARE_KEY)).sort()).toEqual(['프라임', '프롬']);
    expect(
      await countNonNumericAttrValues({
        surveyId: SURVEY_ID,
        attrsKey: '기업체명',
        scope: 'real',
        share: primeShare,
      }),
    ).toBe(2);
  });

  it('단건 상세·메일 표본 — 범위 밖 대상은 없는 대상과 같다', async () => {
    expect(await getContactDetailById(targetId(4), SURVEY_ID, 'real', fromShare)).toBeNull();
    expect(await getContactDetailById(targetId(6), SURVEY_ID, 'real', fromShare)).toBeNull();
    expect(
      (await getContactDetailById(targetId(1), SURVEY_ID, 'real', fromShare))?.contact.resid,
    ).toBe(1);
    expect(
      (await getContactDetailById(targetId(4), SURVEY_ID, 'real', FIELDWORK_SHARE_ALL))?.contact
        .resid,
    ).toBe(4);

    expect(await getContactSampleById(SURVEY_ID, targetId(4), 'real', fromShare)).toBeNull();
    expect((await getContactSampleById(SURVEY_ID, targetId(4), 'real', primeShare))?.resid).toBe(4);
  });

  it('회차 — 범위 밖 대상에는 추가·수정·삭제가 NOT_FOUND 이고 아무것도 쓰이지 않는다', async () => {
    const outside = targetId(4);
    await expect(
      addAttempt(
        { contactTargetId: outside, surveyId: SURVEY_ID, resultCode: '3.비수신' },
        true,
        editor,
        fromShare,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await db.select().from(contactAttempts).where(eq(contactAttempts.contactTargetId, outside)),
    ).toEqual([]);

    // 프라임이 자기 대상에 남긴 회차를 프롬이 고치거나 지우지 못한다
    const own = await addAttempt(
      { contactTargetId: outside, surveyId: SURVEY_ID, resultCode: '3.비수신' },
      true,
      editor,
      primeShare,
    );
    await expect(
      updateAttempt(
        { id: own.id, contactTargetId: outside, surveyId: SURVEY_ID, resultCode: '6.거절' },
        true,
        editor,
        fromShare,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      deleteAttempt({ id: own.id, contactTargetId: outside, surveyId: SURVEY_ID }, true, editor, fromShare),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [kept] = await db.select().from(contactAttempts).where(eq(contactAttempts.id, own.id));
    expect(kept?.resultCode).toBe('3.비수신');
  });

  it('대상 수정 — 범위 밖은 NOT_FOUND, 자기 대상의 범위 열은 다른 값으로 보내도 그대로다', async () => {
    await expect(
      updateContactTarget(
        { id: targetId(5), surveyId: SURVEY_ID, attrs: { 기업체명: '가로챔', [SHARE_KEY]: '프롬' } },
        true,
        editor,
        fromShare,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [untouched] = await db
      .select({ attrs: contactTargets.attrs })
      .from(contactTargets)
      .where(eq(contactTargets.id, targetId(5)));
    expect(untouched?.attrs).toEqual({ 기업체명: '기업5', [SHARE_KEY]: '프라임' });

    // 자기 대상을 남의 범위로 넘기려 해도(또는 범위 열을 비워도) 자기 범위에 남는다
    await updateContactTarget(
      { id: targetId(2), surveyId: SURVEY_ID, attrs: { 기업체명: '기업2', [SHARE_KEY]: '프라임' } },
      true,
      editor,
      fromShare,
    );
    await updateContactTarget(
      { id: targetId(3), surveyId: SURVEY_ID, attrs: { 기업체명: '기업3' } },
      true,
      editor,
      fromShare,
    );
    expect(await listResids(fromShare, true)).toEqual({ resids: [1, 2, 3], total: 3 });
    expect(await listResids(primeShare, true)).toEqual({ resids: [4, 5], total: 2 });

    // 관리자는 범위 열을 바꿔 대상을 옮길 수 있다 — 다음 조회부터 반영된다
    await updateContactTarget(
      { id: targetId(6), surveyId: SURVEY_ID, attrs: { 기업체명: '기업6', [SHARE_KEY]: '프라임' } },
      false,
      editor,
      FIELDWORK_SHARE_ALL,
    );
    expect((await listResids(primeShare, true)).resids).toEqual([4, 5, 6]);
    await updateContactTarget(
      { id: targetId(6), surveyId: SURVEY_ID, attrs: { 기업체명: '기업6' } },
      false,
      editor,
      FIELDWORK_SHARE_ALL,
    );
    expect((await listResids(primeShare, true)).resids).toEqual([4, 5]);
  });

  it('대상 추가 — 범위 게스트가 만든 대상에는 자기 범위 값이 찍힌다', async () => {
    const created = await addContactTarget(
      { surveyId: SURVEY_ID, attrs: { 기업체명: '새 기업', [SHARE_KEY]: '프라임' } },
      true,
      fromShare,
    );
    const [row] = await db
      .select({ attrs: contactTargets.attrs })
      .from(contactTargets)
      .where(eq(contactTargets.id, created.id));
    expect(row?.attrs[SHARE_KEY]).toBe('프롬');
    expect((await listResids(primeShare, true)).resids).toEqual([4, 5]);
    // 뒤 테스트의 숫자가 흔들리지 않게 지운다
    await db.delete(contactTargets).where(eq(contactTargets.id, created.id));
  });

  it('단건 메일 — 범위 밖 대상은 NOT_FOUND (템플릿을 읽기 전에 막힌다)', async () => {
    await expect(
      sendSingleCampaign(
        { surveyId: SURVEY_ID, contactTargetId: targetId(4), mailTemplateId: randomUUID() },
        FROM2,
        true,
        fromShare,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: '조사 대상을 찾을 수 없습니다.' });
  });

  it('응답 내역 — 자기 범위 대상의 응답만, 대상 없는 응답은 관리자만 본다', async () => {
    const list = (share: FieldworkShare) =>
      listResponsesForProfiles({
        surveyId: SURVEY_ID,
        scope: 'real',
        share,
        page: 1,
        pageSize: 20,
        status: 'all',
        sort: 'idx',
        dir: 'desc',
        view: 'active',
        clauses: [],
      });
    const from = await list(fromShare);
    expect(from.total).toBe(1);
    expect(from.rows.map((r) => r.id)).toEqual([responses.from]);
    // 순번은 범위 안에서 다시 매긴다 — 남의 응답 수가 순번으로 드러나지 않는다
    expect(from.rows.map((r) => Number(r.idx))).toEqual([1]);
    const prime = await list(primeShare);
    expect(prime.rows.map((r) => r.id)).toEqual([responses.prime]);
    expect((await list(FIELDWORK_SHARE_ALL)).total).toBe(3);
  });

  it('응답 단건·수정 저장 — 범위 밖 응답과 대상 없는 응답은 없는 응답과 같다', async () => {
    const read = (id: string, share: FieldworkShare) =>
      getResponseById(id, { surveyId: SURVEY_ID, share });
    expect(await read(responses.prime, fromShare)).toBeUndefined();
    expect(await read(responses.open, fromShare)).toBeUndefined();
    expect((await read(responses.from, fromShare))?.id).toBe(responses.from);
    expect((await read(responses.open, FIELDWORK_SHARE_ALL))?.id).toBe(responses.open);

    for (const outside of [responses.prime, responses.open]) {
      await expect(
        saveAdminEdit(
          { surveyId: SURVEY_ID, responseId: outside, versionId, questionResponses: { q1: '덮어씀' } },
          { id: null, email: 'vendor@local' },
          true,
          fromShare,
        ),
      ).rejects.toMatchObject({ reason: 'response_not_found' });
    }
    const [untouched] = await db
      .select({ questionResponses: surveyResponses.questionResponses })
      .from(surveyResponses)
      .where(and(eq(surveyResponses.id, responses.prime), eq(surveyResponses.surveyId, SURVEY_ID)));
    expect(untouched?.questionResponses).toEqual({ q1: '답' });

    await saveAdminEdit(
      { surveyId: SURVEY_ID, responseId: responses.from, versionId, questionResponses: { q1: '고침' } },
      { id: null, email: 'vendor@local' },
      true,
      fromShare,
    );
    expect((await read(responses.from, fromShare))?.questionResponses).toEqual({ q1: '고침' });
  });

  it('응답 현황 — 응답 수·일자별·날짜 목록·부속 집계가 자기 범위 기준이다', async () => {
    expect((await aggregateStatus(SURVEY_ID, 'real', fromShare)).completed).toBe(1);
    expect((await aggregateStatus(SURVEY_ID, 'real', primeShare)).completed).toBe(1);
    expect((await aggregateStatus(SURVEY_ID, 'real', FIELDWORK_SHARE_ALL)).completed).toBe(3);

    const dayTotal = async (share: FieldworkShare) =>
      (await aggregateDaily({ surveyId: SURVEY_ID, scope: 'real', share, mode: 'day' })).reduce(
        (sum, bucket) => sum + bucket.count,
        0,
      );
    expect(await dayTotal(fromShare)).toBe(1);
    expect(await dayTotal(FIELDWORK_SHARE_ALL)).toBe(3);
    expect(await aggregateDailyAvailableDates(SURVEY_ID, 'real', fromShare)).toHaveLength(1);

    // 범위로 걸러도 깨지지 않는다(날 SQL 에 술어를 끼운 자리)
    await expect(getDailyStats(SURVEY_ID, 'real', fromShare)).resolves.toBeDefined();
    await expect(getResponseTime(SURVEY_ID, 'real', fromShare)).resolves.toBeDefined();
    await expect(getDropFunnel(SURVEY_ID, 'real', fromShare)).resolves.toBeDefined();
    await expect(getPageDwell(SURVEY_ID, 'real', fromShare)).resolves.toBeDefined();
  });

  it('진척 보고 — 분모·완료·행이 자기 범위 대상만 센다', async () => {
    expect(await countContactTargets(SURVEY_ID, 'real', fromShare)).toBe(3);
    expect(await countContactTargets(SURVEY_ID, 'real', primeShare)).toBe(2);
    expect(await countContactTargets(SURVEY_ID, 'real', FIELDWORK_SHARE_ALL)).toBe(6);

    const totals = await getProgressTotals(SURVEY_ID, 'real', fromShare, null);
    expect(totals).toMatchObject({ listTotal: 3, completedTotal: 1 });
    expect(await getProgressTotals(SURVEY_ID, 'real', FIELDWORK_SHARE_ALL, null)).toMatchObject({
      listTotal: 6,
      completedTotal: 2,
    });

    const rows = await getProgressRows({
      surveyId: SURVEY_ID,
      scope: 'real',
      share: primeShare,
      condition: null,
      page: 1,
      size: 20,
      sort: 'responseRate',
      dir: 'desc',
      metaKeys: [],
    });
    expect(rows.reduce((sum, r) => sum + r.listCount, 0)).toBe(2);
  });

  it('설문 보기의 명단 씨앗 — 자기 범위 안의 첫 대상이다', async () => {
    const seed = (share: FieldworkShare) =>
      loadPreviewContactSeed({ surveyId: SURVEY_ID, isTest: false, structure: {}, share });
    expect((await seed(primeShare))?.resid).toBe(4);
    expect((await seed(fromShare))?.resid).toBe(1);
    expect((await seed(FIELDWORK_SHARE_ALL))?.resid).toBe(1);
  });

  it('grant 밖 설문을 묻는 게스트는 0명이다 — 넓어지지 않는다', async () => {
    const none = resolveGuestShare(FROM2, randomUUID());
    expect(none).toEqual({ kind: 'none' });
    expect(await countContactTargets(SURVEY_ID, 'real', none)).toBe(0);
    expect((await listResids(none, true)).total).toBe(0);
  });
});
