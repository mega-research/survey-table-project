import { and, eq, isNull } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';

export interface SurveyControlFlags {
  isPaused: boolean;
  pausedMessage: string | null;
  testModeEnabled: boolean;
  testToken: string | null;
  currentVersionId: string | null;
}

/** 운영 제어 플래그 조회 — 스냅샷 밖 라이브 컬럼이므로 항상 surveys 행에서 읽는다. */
export async function getSurveyControlFlags(surveyId: string): Promise<SurveyControlFlags | null> {
  const row = await db.query.surveys.findFirst({
    where: and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)),
    columns: {
      isPaused: true,
      pausedMessage: true,
      testModeEnabled: true,
      testToken: true,
      currentVersionId: true,
    },
  });
  return row ?? null;
}

/** 테스트 링크 토큰 검증(순수) — 모드 ON + 토큰 일치일 때만 유효. */
export function isValidTestToken(
  flags: Pick<SurveyControlFlags, 'testModeEnabled' | 'testToken'>,
  token: string | null | undefined,
): boolean {
  return !!token && flags.testModeEnabled && flags.testToken === token;
}
