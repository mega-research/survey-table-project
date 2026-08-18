import 'server-only';

import { cache } from 'react';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';
import type { ProfileColumnScheme } from '@/db/schema/schema-types';

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
