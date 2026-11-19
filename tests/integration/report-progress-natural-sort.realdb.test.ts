/**
 * 진척 보고의 명단 값 정렬 — 실DB 왕복 계약 테스트.
 *
 * 계약: 표시 열(그룹 대표값)과 명단 열 분류 기준으로 정렬하면 조사 대상 목록과 같은 자연 정렬이다 —
 * 글자로 올라온 숫자는 숫자순(1, 2, 10), 숫자가 아닌 값은 그 뒤에 글자순. 글자순만 쓰면 1, 10, 2 가 된다
 * (2026-11-19 전시회ID 정렬 신고). 정렬은 SQL 의 ORDER BY 라 모킹으로는 검증되지 않는다.
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요)
 */
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { contactTargets, surveys } from '@/db/schema';
import { getProgressRows } from '@/server/operations/services/report-progress';
import { listContactsForSurvey } from '@/server/read-models/contacts';

import { resolvedFilterForTest } from '../helpers/resolved-contact-filter';
import { FIELDWORK_SHARE_ALL } from '@/server/fieldwork-share-scope';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];

/** 전시회마다 조사 대상 한 명 — 전시회ID 는 엑셀에서 글자로 올라온 값(끝 공백이 붙은 것도 있다). */
const EXHIBITIONS: Array<{ name: string; id: string }> = [
  { name: '가전', id: '10' },
  { name: '나전', id: '2 ' },
  { name: '다전', id: '1' },
  { name: '라전', id: '11' },
  { name: '마전', id: 'A-3' },
];

async function seedSurvey(): Promise<string> {
  const [row] = await db
    .insert(surveys)
    .values({ title: '진척 보고 자연 정렬 테스트', status: 'published' })
    .returning({ id: surveys.id });
  if (!row) throw new Error('설문 시드 실패');
  createdSurveyIds.push(row.id);
  await db.insert(contactTargets).values(
    EXHIBITIONS.map((e, i) => ({
      surveyId: row.id,
      resid: i + 1,
      isTest: false,
      inviteCode: `ns-${row.id.slice(0, 8)}-${i + 1}`,
      attrs: { 전시회명: e.name, 전시회ID: e.id },
      // 그룹도 명단에서 온 글자 값 — 숫자로 된 그룹명을 쓰는 설문이 있다
      groupValue: e.id.trim(),
    })),
  );
  return row.id;
}

afterAll(async () => {
  if (createdSurveyIds.length > 0) {
    await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
  }
});

describe.skipIf(!isLocalDb)('getProgressRows — 명단 값 자연 정렬', () => {
  it('표시 열 정렬은 숫자를 숫자순으로, 숫자가 아닌 값은 그 뒤에 세운다', async () => {
    const surveyId = await seedSurvey();
    const base = {
      surveyId,
      scope: 'real' as const,
      condition: null,
      page: 1,
      size: 20,
      metaKeys: ['전시회ID'],
      groupByKeys: [{ kind: 'attrs' as const, key: '전시회명' }],
    };

    const asc = await getProgressRows({ share: FIELDWORK_SHARE_ALL, ...base, sort: 'meta:전시회ID', dir: 'asc' });
    expect(asc.map((r) => r.groupLabel)).toEqual(['다전', '나전', '가전', '라전', '마전']);

    // 내림차순도 숫자 무리가 숫자순으로 뒤집히고, 숫자가 아닌 값은 여전히 뒤다(NULLS LAST)
    const desc = await getProgressRows({ share: FIELDWORK_SHARE_ALL, ...base, sort: 'meta:전시회ID', dir: 'desc' });
    expect(desc.map((r) => r.groupLabel)).toEqual(['라전', '가전', '나전', '다전', '마전']);
  });

  it('응답률이 같은 그룹끼리도 분류 기준 값의 자연 정렬 순서로 선다', async () => {
    const surveyId = await seedSurvey();
    // 완료가 없어 응답률이 전부 0 — 동률 꼬리(분류 기준 값)만으로 순서가 정해진다
    const rows = await getProgressRows({ share: FIELDWORK_SHARE_ALL,
      surveyId,
      scope: 'real',
      condition: null,
      page: 1,
      size: 20,
      sort: 'responseRate',
      dir: 'desc',
      metaKeys: [],
      groupByKeys: [{ kind: 'attrs', key: '전시회ID' }],
    });
    expect(rows.map((r) => r.groupValues[0]?.trim())).toEqual(['1', '2', '10', '11', 'A-3']);
  });

  it('명단 열 분류 기준의 정렬도 같은 자연 정렬이다', async () => {
    const surveyId = await seedSurvey();
    const rows = await getProgressRows({ share: FIELDWORK_SHARE_ALL,
      surveyId,
      scope: 'real',
      condition: null,
      page: 1,
      size: 20,
      sort: 'group:전시회ID',
      dir: 'asc',
      metaKeys: [],
      groupByKeys: [{ kind: 'attrs', key: '전시회ID' }],
    });
    expect(rows.map((r) => r.groupValues[0]?.trim())).toEqual(['1', '2', '10', '11', 'A-3']);
  });
});

describe.skipIf(!isLocalDb)('listContactsForSurvey — 그룹 정렬', () => {
  it('숫자로 된 그룹명은 숫자순으로, 숫자가 아닌 그룹명은 그 뒤에 선다', async () => {
    const surveyId = await seedSurvey();
    const { rows } = await listContactsForSurvey({
      surveyId,
      scope: 'real',
      page: 1,
      pageSize: 20,
      filter: resolvedFilterForTest(),
      sort: 'group',
      dir: 'asc',
    });
    expect(rows.map((r) => r.groupValue)).toEqual(['1', '2', '10', '11', 'A-3']);
  });
});
