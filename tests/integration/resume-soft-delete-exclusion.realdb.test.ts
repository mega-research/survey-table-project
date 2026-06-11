/**
 * resumeOrCreateResponse 의 soft-delete 제외 회귀 테스트 (실 DB 왕복)
 *
 * 회귀 대상: M23 (2026-06-09 코드리뷰)
 * resumeOrCreateResponse 의 컨택 기반 / sessionId 기반 조회가 deletedAt IS NULL 가드를
 * 빠뜨려, 관리자가 soft-delete 한 진행중(in_progress)/drop 응답이 재진입 시 되살아나던 버그.
 * findActiveResponseByContact 는 isNull(deletedAt) 으로 삭제 행을 건너뛰므로 두 경로가
 * 불일치(한쪽은 새 응답 생성, 한쪽은 삭제 행 부활)를 일으켰다.
 *
 * 검증:
 * - 컨택 경로: soft-delete 된 in_progress 행은 resume 되지 않고 null 반환.
 * - sessionId 경로: soft-delete 된 drop 행은 resume 되지 않고 null 반환.
 *
 * 실행 조건: DATABASE_URL 이 127.0.0.1/localhost 일 때만 동작. prod URL 환경에서는 전체 스킵.
 *
 * findContactByInviteToken 은 PG SECURITY DEFINER 함수에 의존하므로 mock 으로 valid 고정.
 * 실제 검증 대상인 db.select WHERE 절은 실 DB 로 돈다.
 */

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindContactByInviteToken } = vi.hoisted(() => ({
  mockFindContactByInviteToken: vi.fn(),
}));

vi.mock('@/lib/duplicate-detection/invite-lookup', () => ({
  findContactByInviteToken: mockFindContactByInviteToken,
}));

import { db } from '@/db';
import {
  contactTargets as contactTargetsTable,
  surveyResponses as surveyResponsesTable,
  surveys as surveysTable,
} from '@/db/schema';

import { resumeOrCreateResponse } from '@/features/survey-response/server/services/lifecycle.service';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

describe.skipIf(!isLocalDb)('resumeOrCreateResponse soft-delete 제외 (real local DB)', () => {
  const createdSurveyIds: string[] = [];

  beforeEach(() => vi.clearAllMocks());

  afterAll(async () => {
    for (const id of createdSurveyIds) {
      // survey 삭제 시 contact_targets/survey_responses 는 FK cascade 로 정리된다.
      await db.delete(surveysTable).where(eq(surveysTable.id, id));
    }
  });

  it('컨택 경로: soft-delete 된 in_progress 응답은 resume 하지 않고 null 반환', async () => {
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: 'resume-soft-delete-컨택-테스트' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('survey 삽입 실패');
    createdSurveyIds.push(survey.id);

    const [contact] = await db
      .insert(contactTargetsTable)
      .values({ surveyId: survey.id, resid: 1 })
      .returning({ id: contactTargetsTable.id });
    if (!contact) throw new Error('contact_target 삽입 실패');

    // soft-delete 된 in_progress 응답 (isCompleted=false, deletedAt 설정)
    await db.insert(surveyResponsesTable).values({
      surveyId: survey.id,
      sessionId: 'soft-deleted-contact-session',
      contactTargetId: contact.id,
      questionResponses: {},
      isCompleted: false,
      status: 'in_progress',
      deletedAt: new Date(),
    });

    // findContactByInviteToken 이 valid 컨택을 반환하도록 고정
    mockFindContactByInviteToken.mockResolvedValue({
      kind: 'valid',
      contactTargetId: contact.id,
      respondedAt: null,
    });

    const result = await resumeOrCreateResponse({
      surveyId: survey.id,
      sessionId: 'new-entry-session',
      inviteToken: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });

    // 삭제 행을 되살리지 않고 새 응답 흐름(null)으로 빠져야 한다.
    expect(result).toBeNull();
  });

  it('sessionId 경로: soft-delete 된 drop 응답은 resume 하지 않고 null 반환', async () => {
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: 'resume-soft-delete-session-테스트' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('survey 삽입 실패');
    createdSurveyIds.push(survey.id);

    const sessionId = 'soft-deleted-session-only';

    // soft-delete 된 drop 응답
    await db.insert(surveyResponsesTable).values({
      surveyId: survey.id,
      sessionId,
      questionResponses: {},
      isCompleted: false,
      status: 'drop',
      deletedAt: new Date(),
    });

    // inviteToken 없이 sessionId 경로로 진입
    const result = await resumeOrCreateResponse({
      surveyId: survey.id,
      sessionId,
    });

    expect(result).toBeNull();

    // 삭제 행이 drop->in_progress 로 부활하지 않았는지 직접 확인 (부작용 없음)
    const [row] = await db
      .select({ status: surveyResponsesTable.status })
      .from(surveyResponsesTable)
      .where(
        and(
          eq(surveyResponsesTable.surveyId, survey.id),
          eq(surveyResponsesTable.sessionId, sessionId),
        ),
      )
      .limit(1);
    expect(row?.status).toBe('drop');
  });
});
