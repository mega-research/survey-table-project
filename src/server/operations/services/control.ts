import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import 'server-only';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';
import { getSurveyAccessIdentifier } from '@/lib/survey-url';
import { readBrowserTestView } from '@/server/data-scope';

import { CLOSABLE_SURVEY_STATUSES, SurveyNotClosableError } from '../domain/survey-close';

export { disableTestWorkspace } from './test-workspace';

export interface SurveyControlState {
  isPaused: boolean;
  pausedMessage: string | null;
  /** 설문 종료 여부 (ADR-0030) — `surveys.status === 'closed'`. 중단과 독립이다. */
  isClosed: boolean;
  /** 설문의 테스트 환경(테스트 링크·테스트 대상자 링크가 산다) — 모든 사람에게 같다. */
  testModeEnabled: boolean;
  /**
   * 이 브라우저가 콘솔을 테스트 파티션으로 보기로 했는가(쿠키). 콘솔이 실제로 테스트 데이터를 보는 것은
   * testModeEnabled 와 둘 다 참일 때다 — 판정은 server/data-scope.
   */
  testViewInBrowser: boolean;
  testToken: string | null;
  accessIdentifier: string;
  testResponseCount: number;
  testTargetCount: number;
  firstTestInviteCode: string | null;
}

export async function getControlState(surveyId: string): Promise<SurveyControlState | null> {
  // mode와 두 count, 첫 invite를 한 SQL statement snapshot에서 읽어 대상자 생성/삭제나
  // 다른 관리자의 OFF가 query 사이에 끼어드는 혼합 상태를 반환하지 않는다.
  const testViewInBrowserPromise = readBrowserTestView(surveyId);
  const [row] = await db
    .select({
      isPaused: surveys.isPaused,
      pausedMessage: surveys.pausedMessage,
      status: surveys.status,
      testModeEnabled: surveys.testModeEnabled,
      testToken: surveys.testToken,
      id: surveys.id,
      slug: surveys.slug,
      privateToken: surveys.privateToken,
      isPublic: surveys.isPublic,
      testResponseCount: sql<number>`(
        SELECT count(*)::int
        FROM survey_responses AS test_response_scope
        WHERE test_response_scope.survey_id = surveys.id
          AND test_response_scope.is_test = true
          AND test_response_scope.deleted_at IS NULL
      )`.mapWith(Number),
      testTargetCount: sql<number>`(
        SELECT count(*)::int
        FROM contact_targets AS test_target_scope
        WHERE test_target_scope.survey_id = surveys.id
          AND test_target_scope.is_test = true
      )`.mapWith(Number),
      firstTestInviteCode: sql<string | null>`(
        SELECT first_test_target.invite_code
        FROM contact_targets AS first_test_target
        WHERE first_test_target.survey_id = surveys.id
          AND first_test_target.is_test = true
        ORDER BY first_test_target.resid ASC, first_test_target.id ASC
        LIMIT 1
      )`,
    })
    .from(surveys)
    .where(and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)))
    .limit(1);
  // 미저장(로컬 전용)/삭제 설문 — 편집 헤더의 테스트 모드 버튼이 마운트·10초 폴링마다
  // 호출하므로 throw 하면 500 이 반복 적재된다. 부재는 에러가 아니라 null (클라이언트는
  // OFF 폴백). testSample 의 동일 계열 수정(2026-08-20)과 같은 규약.
  if (!row) return null;
  return {
    isPaused: row.isPaused,
    pausedMessage: row.pausedMessage,
    isClosed: row.status === 'closed',
    testModeEnabled: row.testModeEnabled,
    testViewInBrowser: await testViewInBrowserPromise,
    testToken: row.testToken,
    accessIdentifier: getSurveyAccessIdentifier(row),
    testResponseCount: row.testResponseCount,
    testTargetCount: row.testTargetCount,
    firstTestInviteCode: row.firstTestInviteCode,
  };
}

export async function setPaused(input: {
  surveyId: string;
  isPaused: boolean;
  pausedMessage?: string | null;
}): Promise<{ isPaused: boolean; pausedMessage: string | null }> {
  const [updated] = await db
    .update(surveys)
    .set({
      isPaused: input.isPaused,
      // 중단 시에만 문구 갱신 — 재개 시 문구는 보존해 다음 중단 프리필로 쓴다
      ...(input.pausedMessage !== undefined ? { pausedMessage: input.pausedMessage } : {}),
      updatedAt: new Date(),
    })
    .where(eq(surveys.id, input.surveyId))
    .returning({ isPaused: surveys.isPaused, pausedMessage: surveys.pausedMessage });
  if (!updated) throw new Error('설문 중단 상태 저장에 실패했습니다.');
  return updated;
}

/**
 * 설문 종료·종료 취소 (ADR-0030).
 *
 * **조건부 UPDATE 한 번이다.** 읽고 나서 쓰면 그 사이에 끼어든 발행·삭제를 덮는다. WHERE 가
 * 「발행된 적 있는 설문」만 고르므로 초안은 0행이 되고, 그것이 곧 거부다 — 종료 취소가 초안을
 * 발행 상태로 올리는 길이 이 조건 하나로 닫힌다.
 *
 * 건드리는 것은 `status` 뿐이다. 중단(`isPaused`)·중단 문구·현재 버전은 종료와 독립이라,
 * 중단해 둔 설문을 종료했다 취소하면 중단 상태로 돌아온다. 링크 행도 건드리지 않는다 —
 * 외부 링크의 닫힘은 이 값에서 파생되므로 종료 취소가 같은 주소·같은 비밀번호를 되살린다.
 *
 * 같은 상태로의 요청은 멱등이다(종료된 설문을 다시 종료해도 성공).
 */
export async function setClosed(input: {
  surveyId: string;
  isClosed: boolean;
}): Promise<{ isClosed: boolean }> {
  const [updated] = await db
    .update(surveys)
    .set({ status: input.isClosed ? 'closed' : 'published', updatedAt: new Date() })
    .where(
      and(
        eq(surveys.id, input.surveyId),
        isNull(surveys.deletedAt),
        inArray(surveys.status, [...CLOSABLE_SURVEY_STATUSES]),
      ),
    )
    .returning({ status: surveys.status });
  // 관문이 존재를 이미 확인했으므로 0행은 초안이다(관문과 UPDATE 사이에 삭제된 경우도
  // 같은 사유로 접는다 — 종료할 수 없다는 답은 어느 쪽에도 참이다).
  if (!updated) throw new SurveyNotClosableError();
  return { isClosed: updated.status === 'closed' };
}

export async function setTestMode(input: {
  surveyId: string;
  enabled: boolean;
}): Promise<SurveyControlState> {
  if (!input.enabled) {
    throw new Error('테스트 모드 OFF는 disableTestWorkspace를 사용해야 합니다.');
  }
  const row = await db.query.surveys.findFirst({
    where: and(eq(surveys.id, input.surveyId), isNull(surveys.deletedAt)),
    columns: { id: true, slug: true, privateToken: true, isPublic: true, testToken: true },
  });
  if (!row) throw new Error('설문을 찾을 수 없습니다.');
  // 토큰은 최초 ON 때 한 번 생성 후 재사용 (rotate 없음 — 스펙 11절). 신규는 짧은 nanoid.
  const testToken = row.testToken ?? nanoid(8);
  const [updated] = await db
    .update(surveys)
    .set({ testModeEnabled: input.enabled, testToken, updatedAt: new Date() })
    .where(eq(surveys.id, input.surveyId))
    .returning({
      testModeEnabled: surveys.testModeEnabled,
      testToken: surveys.testToken,
    });
  if (!updated) throw new Error('테스트 모드 저장에 실패했습니다.');
  const state = await getControlState(input.surveyId);
  // 방금 UPDATE 가 성공한 설문 — 부재는 논리적으로 불가하므로 계약(비 null)을 유지한다.
  if (!state) throw new Error('설문을 찾을 수 없습니다.');
  return state;
}
