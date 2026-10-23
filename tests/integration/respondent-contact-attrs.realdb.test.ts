/**
 * 응답 화면이 보는 명단 값 — 단건(`loadRespondentContactAttrs`)과 일괄(`loadRespondentContactAttrsMany`)이
 * 같은 값을 내는지 실DB 왕복으로 대조한다.
 *
 * 응답 확정은 단건으로, Raw 내보내기 마지막 그물은 일괄로 읽는다. 둘이 서식·실패 처리·키 우선순위 중
 * 하나라도 다르면 같은 표시 조건이 두 경로에서 다르게 풀린다.
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요)
 */
import { inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { contactPii, contactTargets, surveys } from '@/db/schema';
import { buildPiiRows, type PiiInput } from '@/lib/crypto/contact-pii-repo';
import {
  loadRespondentContactAttrs,
  loadRespondentContactAttrsMany,
} from '@/server/read-models/respondent-contact-attrs';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];
let resid = 0;

async function newSurvey(): Promise<string> {
  const [survey] = await db.insert(surveys).values({ title: '명단 값 대조' }).returning();
  if (!survey) throw new Error('설문 시드 실패');
  createdSurveyIds.push(survey.id);
  return survey.id;
}

async function seedTarget(
  surveyId: string,
  attrs: Record<string, string>,
  pii: PiiInput[],
  options: { brokenColumns?: string[] } = {},
): Promise<string> {
  const id = randomUUID();
  resid += 1;
  await db.insert(contactTargets).values({ id, surveyId, resid, inviteCode: randomUUID(), attrs });
  const rows = buildPiiRows(id, pii).map((row) =>
    options.brokenColumns?.includes(row.columnKey) ? { ...row, cipher: 'broken' } : row,
  );
  if (rows.length > 0) await db.insert(contactPii).values(rows);
  return id;
}

describe.skipIf(!isLocalDb)('응답 화면 명단 값 단건·일괄 대조', () => {
  afterAll(async () => {
    if (createdSurveyIds.length === 0) return;
    await db.delete(contactTargets).where(inArray(contactTargets.surveyId, createdSurveyIds));
    await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
  });

  it('일괄판은 대상마다 단건판과 같은 명단 값을 낸다', async () => {
    const surveyId = await newSurvey();
    const ids = [
      // 사업자번호는 하이픈 서식, 이름은 그대로
      await seedTarget(surveyId, { 기업명: '가나' }, [
        { columnKey: '사업자등록번호', fieldType: 'biz_number', plain: '1234567890' },
        { columnKey: '대표자명', fieldType: 'name', plain: '홍길동' },
      ]),
      // attrs 에 같은 키가 있으면 attrs 가 이긴다
      await seedTarget(surveyId, { 대표자명: '명단 값' }, [
        { columnKey: '대표자명', fieldType: 'name', plain: '개인정보 값' },
      ]),
      // 복호화에 실패한 열은 빠지고 나머지는 남는다
      await seedTarget(
        surveyId,
        {},
        [
          { columnKey: '사업자등록번호', fieldType: 'biz_number', plain: '1234567890' },
          { columnKey: '대표자명', fieldType: 'name', plain: '홍길동' },
        ],
        { brokenColumns: ['사업자등록번호'] },
      ),
      // 개인정보 행이 없는 대상
      await seedTarget(surveyId, { 지역: '서울' }, []),
    ];

    const many = await loadRespondentContactAttrsMany(ids);

    expect(Object.fromEntries(many)).toEqual({
      [ids[0]!]: { 기업명: '가나', 사업자등록번호: '123-45-67890', 대표자명: '홍길동' },
      [ids[1]!]: { 대표자명: '명단 값' },
      [ids[2]!]: { 대표자명: '홍길동' },
      [ids[3]!]: { 지역: '서울' },
    });
    for (const id of ids) {
      expect(many.get(id)).toEqual(await loadRespondentContactAttrs(id));
    }
  });

  it('없는 대상은 결과에 넣지 않고 빈 입력은 쿼리 없이 빈 결과다', async () => {
    const missing = randomUUID();
    expect((await loadRespondentContactAttrsMany([missing])).has(missing)).toBe(false);
    expect((await loadRespondentContactAttrsMany([])).size).toBe(0);
  });
});
