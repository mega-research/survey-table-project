/**
 * contacts.targets / contacts.columns procedure 실 DB 왕복 integration test
 *
 * 목적: procedure -> service -> 실 PostgreSQL 왕복(resid 자동발번 + attrs/scheme 저장)이
 * 실제로 돈다는 것을 CI에 고정. z.custom + 캐스팅 기반 거짓안전(타입만 통과)을 잡는다.
 *
 * 실행 조건: DATABASE_URL이 127.0.0.1 또는 localhost를 포함할 때만 동작.
 * prod URL 환경에서는 describe.skipIf로 전체 스킵 -> 일반 pnpm test에서 데이터 오염 없음.
 *
 * 선행 조건: 로컬 supabase 스택 + 19테이블 셋업 완료 (pnpm db:setup-test).
 *   단, db:setup-test는 drizzle-kit push 기반이라 supabase 마이그레이션의 커스텀
 *   SQL 함수(next_contact_resid)는 생성되지 않는다. 본 테스트는 beforeAll에서 해당
 *   함수를 idempotent CREATE OR REPLACE로 보장한 뒤 왕복을 검증한다.
 */

import { createRouterClient } from '@orpc/server';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { contactTargets as contactTargetsTable, surveys as surveysTable } from '@/db/schema';
import type { ContactColumnScheme } from '@/db/schema/schema-types';
import type { ORPCContext } from '@/server/context';

import { columns } from '@/features/contacts/server/procedures/columns';
import { targets } from '@/features/contacts/server/procedures/targets';

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

describe.skipIf(!isLocalDb)('contacts.targets/columns procedure round-trip (real local DB)', () => {
  const client = createRouterClient({ targets, columns }, { context: adminContext() });
  const createdSurveyIds: string[] = [];

  beforeAll(async () => {
    // drizzle-kit push 기반 로컬 DB에는 next_contact_resid 함수가 없으므로
    // supabase 마이그레이션과 동일한 정의를 idempotent하게 보장한다.
    await db.execute(sql`
      DROP FUNCTION IF EXISTS next_contact_resid(uuid);
      CREATE OR REPLACE FUNCTION next_contact_resid(
        p_survey_id uuid,
        p_is_test boolean DEFAULT false
      ) RETURNS integer AS $$
      DECLARE next_id integer;
      BEGIN
        PERFORM pg_advisory_xact_lock(
          hashtextextended(p_survey_id::text || ':' || p_is_test::text, 0)
        );
        SELECT COALESCE(MAX(resid), 0) + 1 INTO next_id
          FROM contact_targets
          WHERE survey_id = p_survey_id AND is_test = p_is_test;
        RETURN next_id;
      END;
      $$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public;
    `);
  });

  afterAll(async () => {
    // survey 삭제 시 contact_targets는 FK cascade로 함께 정리되지만 명시적으로도 비운다.
    for (const id of createdSurveyIds) {
      await db.delete(contactTargetsTable).where(eq(contactTargetsTable.surveyId, id));
      await db.delete(surveysTable).where(eq(surveysTable.id, id));
    }
  });

  it('add -> update -> remove 왕복: resid 자동발번 + attrs 저장/변경/삭제가 DB에 반영된다', async () => {
    // 1. survey 선행 insert (contact_targets.survey_id FK)
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '컨택-왕복-테스트-설문' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('survey 삽입 실패');
    createdSurveyIds.push(survey.id);

    // 2. add: resid가 next_contact_resid()로 자동 발번되고 attrs가 저장되는지 확인
    const added = await client.targets.add({
      surveyId: survey.id,
      attrs: { name: '홍길동', region: '서울' },
    });
    expect(typeof added.id).toBe('string');
    expect(added.resid).toBe(1); // 첫 행이므로 MAX(resid)=0 + 1

    const [afterAdd] = await db
      .select({ attrs: contactTargetsTable.attrs, resid: contactTargetsTable.resid })
      .from(contactTargetsTable)
      .where(eq(contactTargetsTable.id, added.id));
    expect(afterAdd?.resid).toBe(1);
    expect(afterAdd?.attrs).toEqual({ name: '홍길동', region: '서울' });

    // 3. update: attrs 변경이 DB에 반영되는지 확인
    const updateRes = await client.targets.update({
      id: added.id,
      surveyId: survey.id,
      attrs: { name: '홍길동', region: '부산' },
    });
    expect(updateRes).toEqual({ ok: true });

    const [afterUpdate] = await db
      .select({ attrs: contactTargetsTable.attrs })
      .from(contactTargetsTable)
      .where(eq(contactTargetsTable.id, added.id));
    expect(afterUpdate?.attrs).toEqual({ name: '홍길동', region: '부산' });

    // 4. remove: DB에서 행이 사라지는지 확인
    const removeRes = await client.targets.remove({ surveyId: survey.id, id: added.id });
    expect(removeRes).toEqual({ ok: true });

    const afterRemove = await db
      .select({ id: contactTargetsTable.id })
      .from(contactTargetsTable)
      .where(eq(contactTargetsTable.id, added.id));
    expect(afterRemove.length).toBe(0);
  });

  it('resid는 같은 설문 안에서 순차 발번된다', async () => {
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '컨택-resid-순차-테스트' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('survey 삽입 실패');
    createdSurveyIds.push(survey.id);

    const first = await client.targets.add({ surveyId: survey.id, attrs: { name: 'A' } });
    const second = await client.targets.add({ surveyId: survey.id, attrs: { name: 'B' } });
    expect(first.resid).toBe(1);
    expect(second.resid).toBe(2);
  });

  it('columns.update: resid 컬럼 hidden이면 거부, 정상 스킴은 surveys.contactColumns에 저장된다', async () => {
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '컨택-컬럼스킴-테스트' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('survey 삽입 실패');
    createdSurveyIds.push(survey.id);

    // resid hidden 가드: 거부되어야 함
    const badScheme: ContactColumnScheme = {
      version: 1,
      headerRow: 1,
      columns: [{ key: 'resid', label: '번호', source: 'system.resid', order: 1, hidden: true }],
    };
    await expect(
      client.columns.update({ surveyId: survey.id, scheme: badScheme }),
    ).rejects.toThrow();

    // 정상 스킴: 저장되어야 함
    const goodScheme: ContactColumnScheme = {
      version: 1,
      headerRow: 2,
      columns: [
        { key: 'resid', label: '번호', source: 'system.resid', order: 1 },
        { key: 'name', label: '이름', source: 'attrs.name', order: 2 },
      ],
    };
    const res = await client.columns.update({ surveyId: survey.id, scheme: goodScheme });
    expect(res).toEqual({ ok: true });

    const [afterUpdate] = await db
      .select({ contactColumns: surveysTable.contactColumns })
      .from(surveysTable)
      .where(eq(surveysTable.id, survey.id));
    expect(afterUpdate?.contactColumns).toEqual(goodScheme);
  });
});
