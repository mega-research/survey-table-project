import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';
import type { QuotaConfig } from '@/db/schema/schema-types';

/** 설문의 쿼터 플랜 조회. 미설정이면 null. */
export async function getQuotaConfig(surveyId: string): Promise<QuotaConfig | null> {
  const row = await db.query.surveys.findFirst({
    where: eq(surveys.id, surveyId),
    columns: { quotaConfig: true },
  });
  return row?.quotaConfig ?? null;
}

/** 설문의 쿼터 플랜 저장(덮어쓰기). 없는 설문이면 throw. */
export async function saveQuotaConfig(
  surveyId: string,
  config: QuotaConfig,
): Promise<QuotaConfig> {
  const [updated] = await db
    .update(surveys)
    .set({ quotaConfig: config, updatedAt: new Date() })
    .where(eq(surveys.id, surveyId))
    .returning({ quotaConfig: surveys.quotaConfig });

  if (!updated) throw new Error('쿼터 저장에 실패했습니다.');
  return updated.quotaConfig ?? config;
}
