/**
 * resolveInviteCode 실 DB 왕복 integration test.
 * inviteCode -> (accessIdentifier, inviteToken) 역참조가 실제 PostgreSQL 에서 도는지 고정.
 * 실행 조건: DATABASE_URL 이 로컬(127.0.0.1/localhost)일 때만. prod URL 에서는 전체 skip.
 * 선행: pnpm db:setup-test (로컬 supabase + 스키마 push).
 */
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { contactTargets, surveys } from '@/db/schema';
import { resolveInviteCode } from '@/features/contacts/server/services/contact-invite.service';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

describe.skipIf(!isLocalDb)('resolveInviteCode round-trip (real local DB)', () => {
  const createdSurveyIds: string[] = [];

  afterAll(async () => {
    for (const id of createdSurveyIds) {
      await db.delete(contactTargets).where(eq(contactTargets.surveyId, id));
      await db.delete(surveys).where(eq(surveys.id, id));
    }
  });

  it('비공개 설문: privateToken accessIdentifier + inviteToken 을 반환한다', async () => {
    const inviteCode = randomUUID();
    const [survey] = await db
      .insert(surveys)
      .values({ title: '초대코드-역참조-테스트', isPublic: false, privateToken: '11111111-1111-1111-1111-111111111111' })
      .returning({ id: surveys.id });
    if (!survey) throw new Error('survey 삽입 실패');
    createdSurveyIds.push(survey.id);

    await db.insert(contactTargets).values({
      surveyId: survey.id,
      resid: 1,
      inviteToken: '22222222-2222-2222-2222-222222222222',
      inviteCode,
    });

    const resolved = await resolveInviteCode(inviteCode);
    expect(resolved).toEqual({
      accessIdentifier: '11111111-1111-1111-1111-111111111111',
      inviteToken: '22222222-2222-2222-2222-222222222222',
    });
  });

  it('미존재 코드는 null 을 반환한다', async () => {
    expect(await resolveInviteCode('nonexistent')).toBeNull();
  });

  it('빈 코드는 DB 조회 없이 null 을 반환한다', async () => {
    expect(await resolveInviteCode('')).toBeNull();
  });
});
