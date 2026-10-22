import 'server-only';

import { cache } from 'react';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';
import { normalizePassParamNames } from '@/lib/survey/end-redirect';
import type { ProfileColumnScheme } from '@/shared/contracts/operations';

/**
 * surveys.profile_columns 캐시 (RSC pass 내 dedupe).
 * NULL 이면 null 반환 — 호출자가 hydrateProfileColumns 로 기본 스킴 생성.
 */
export const getProfileColumnScheme = cache(
  async (surveyId: string): Promise<ProfileColumnScheme | null> => {
    const [row] = await db
      .select({ scheme: surveys.profileColumns })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .limit(1);
    return row?.scheme ?? null;
  },
);

/**
 * 응답 내역 entry.* 열의 이름 — 종료 후 이동 주소 설정의 이어 넘길 값(passParams).
 * 설정이 없으면 빈 배열이라 열도 검색 후보도 생기지 않는다.
 */
export const getProfileEntryParamNames = cache(async (surveyId: string): Promise<string[]> => {
  const [row] = await db
    .select({ endRedirects: surveys.endRedirects })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);
  return normalizePassParamNames(row?.endRedirects?.passParams);
});
