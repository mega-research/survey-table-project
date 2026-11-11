/**
 * 조사 대상 기본 정렬 열 — 실 DB 왕복 (CONTEXT.md 「기본 정렬 열」).
 *
 * 컬럼 설정에서 한 열을 기본 정렬로 지정하면 조사 대상을 늘어놓는 표들이 그 열의 숫자 오름차순으로
 * 열린다. 글자로 올라온 숫자(앞뒤 공백 포함)는 숫자순, 숫자가 아닌 값은 그 뒤, 빈 값은 맨 뒤,
 * 값이 같으면 시스템ID 순이다. 지정이 없으면 표마다 종전 순서 그대로다.
 *
 * 실행: pnpm test:integration (로컬 supabase 54322). 일반 pnpm test 에서는 스킵된다.
 */
import { inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import { contactPii, contactTargets, surveys } from '@/db/schema';
import { resolveContactListSort, resolveDefaultSortKey } from '@/lib/contacts/default-sort';
import { buildPiiRows } from '@/lib/crypto/contact-pii-repo';
import { listAssignmentMatches } from '@/server/contacts/services/contact-assignment-apply';
import {
  listUnsubscribedContacts,
  previewCampaignCandidates,
} from '@/server/mail/services/campaigns-read';
import { listContactsForSurvey } from '@/server/read-models/contacts';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

import { resolvedFilterForTest } from '../helpers/resolved-contact-filter';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/auth/guest-viewer', () => ({ isGuestViewer: () => Promise.resolve(false) }));

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
const run = process.env['RUN_REALDB'] === '1' && isLocalDb ? describe : describe.skip;

function schemeOf(defaultSort: boolean): ContactColumnScheme {
  return {
    version: 1,
    headerRow: 1,
    columns: [
      { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
      {
        key: 'ID',
        label: 'ID',
        source: 'attrs.ID',
        order: 2,
        ...(defaultSort ? { defaultSort: true as const } : {}),
      },
      { key: 'web', label: 'web', source: 'system.web', order: 3 },
    ],
  };
}

// 시스템ID 1..8 의 자체 ID — 순서가 뒤섞여 있고, 끝 공백·글자 ID·빈 값·같은 값이 섞여 있다.
const OWN_IDS: Array<string | null> = ['10', '2 ', '100', 'A-3', null, ' 1', '2', '11'];
// 기대 순서(시스템ID): ' 1'(6) → '2 '(2) → '2'(7) → '10'(1) → '11'(8) → '100'(3) → 'A-3'(4) → 빈 값(5)
const EXPECTED_RESIDS = [6, 2, 7, 1, 8, 3, 4, 5];

const createdSurveyIds: string[] = [];

async function seed(
  defaultSort: boolean,
  opts: { unsubscribed?: boolean } = {},
): Promise<{ surveyId: string; scheme: ContactColumnScheme }> {
  const surveyId = randomUUID();
  const scheme = schemeOf(defaultSort);
  await db.insert(surveys).values({
    id: surveyId,
    title: '기본 정렬 열 실DB',
    contactColumns: scheme,
    testContactColumns: scheme,
  });
  createdSurveyIds.push(surveyId);
  const inserted = await db
    .insert(contactTargets)
    .values(
      OWN_IDS.map((own, i) => ({
        surveyId,
        resid: i + 1,
        isTest: false,
        inviteCode: `ds${randomUUID().slice(0, 10)}`,
        attrs: (own === null ? {} : { ID: own }) as Record<string, string>,
        // 수신거부 명단의 종전 순서(최근 수신거부 먼저)가 시스템ID 역순이 되도록 뒤로 갈수록 최근.
        unsubscribedAt: opts.unsubscribed ? new Date(Date.UTC(2026, 10, 1, 0, i)) : null,
      })),
    )
    .returning({ id: contactTargets.id });
  await db.insert(contactPii).values(
    inserted.flatMap((row, i) =>
      buildPiiRows(row.id, [
        { columnKey: 'email', fieldType: 'email', plain: `own${i + 1}@example.com` },
      ]),
    ),
  );
  return { surveyId, scheme };
}

run('조사 대상 기본 정렬 열 (실 DB)', () => {
  afterAll(async () => {
    if (createdSurveyIds.length === 0) return;
    await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
  });

  it('지정한 열의 숫자 오름차순으로 네 표가 같은 차례를 낸다', async () => {
    const { surveyId, scheme } = await seed(true);
    const filter = resolvedFilterForTest();

    const list = await listContactsForSurvey({
      surveyId,
      scope: 'real',
      filter,
      page: 1,
      pageSize: 20,
      sort: resolveContactListSort(undefined, scheme),
      dir: 'asc',
    });
    expect(list.rows.map((r) => r.resid)).toEqual(EXPECTED_RESIDS);

    const matches = await listAssignmentMatches({ surveyId, clauses: [], page: 1 }, 'real');
    expect(matches.rows.map((r) => r.resid)).toEqual(EXPECTED_RESIDS);

    const candidates = await previewCampaignCandidates({
      surveyId,
      scope: 'real',
      filter,
      unrespondedOnly: false,
      sort: resolveDefaultSortKey(scheme),
      dir: 'asc',
    });
    expect(candidates.rows.map((r) => r.resid)).toEqual(EXPECTED_RESIDS);
    const reversed = await previewCampaignCandidates({
      surveyId,
      scope: 'real',
      filter,
      unrespondedOnly: false,
      sort: resolveDefaultSortKey(scheme),
      dir: 'desc',
    });
    // 내림차순 — 숫자 큰 것부터, 숫자가 아닌 값·빈 값은 방향과 무관하게 뒤. 같은 값(2)끼리는 시스템ID 순.
    expect(reversed.rows.map((r) => r.resid)).toEqual([3, 8, 1, 2, 7, 6, 4, 5]);

    // 수신거부 대상은 수신자 후보에서 빠지므로 수신거부 명단은 따로 심은 설문으로 본다.
    const unsubSeed = await seed(true, { unsubscribed: true });
    const unsub = await listUnsubscribedContacts({
      surveyId: unsubSeed.surveyId,
      scope: 'real',
      defaultSort: resolveDefaultSortKey(unsubSeed.scheme),
    });
    // 값이 같은 둘(시스템ID 2·7)은 이 표의 원래 순서 — 최근 수신거부(7) 먼저.
    expect(unsub.rows.map((r) => r.resid)).toEqual([6, 7, 2, 1, 8, 3, 4, 5]);
  });

  it('지정이 없으면 표마다 종전 순서 그대로다', async () => {
    const { surveyId, scheme } = await seed(false, { unsubscribed: true });
    const filter = resolvedFilterForTest();
    const residOrder = OWN_IDS.map((_, i) => i + 1);

    const list = await listContactsForSurvey({
      surveyId,
      scope: 'real',
      filter,
      page: 1,
      pageSize: 20,
      sort: resolveContactListSort(undefined, scheme),
      dir: 'asc',
    });
    expect(list.rows.map((r) => r.resid)).toEqual(residOrder);

    const matches = await listAssignmentMatches({ surveyId, clauses: [], page: 1 }, 'real');
    expect(matches.rows.map((r) => r.resid)).toEqual(residOrder);

    const unsub = await listUnsubscribedContacts({
      surveyId,
      scope: 'real',
      defaultSort: resolveDefaultSortKey(scheme),
    });
    // 최근 수신거부 먼저 — 시스템ID 역순으로 심었다.
    expect(unsub.rows.map((r) => r.resid)).toEqual([...residOrder].reverse());
  });
});
