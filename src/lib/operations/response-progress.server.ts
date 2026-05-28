import 'server-only';
import { cache } from 'react';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveyVersions } from '@/db/schema';
import type { SurveyVersionSnapshot } from '@/db/schema/schema-types';

/**
 * 특정 version 의 snapshot 에서 question position map 과 총 질문 수를 얻는다.
 *
 * - RSC pass / server action 한 번 안에서 dedupe (react cache).
 * - versionId 가 NULL 이거나 행이 없으면 빈 map + total 0 반환.
 */
export const getProgressSnapshot = cache(
  async (
    versionId: string | null,
  ): Promise<{ positionMap: Map<string, number>; totalQuestions: number }> => {
    if (!versionId) return { positionMap: new Map(), totalQuestions: 0 };

    const [row] = await db
      .select({ snapshot: surveyVersions.snapshot })
      .from(surveyVersions)
      .where(eq(surveyVersions.id, versionId))
      .limit(1);

    const snapshot = (row?.snapshot ?? null) as SurveyVersionSnapshot | null;
    const questions = snapshot?.questions ?? [];
    const positionMap = new Map<string, number>();
    questions.forEach((q, i) => positionMap.set(q.id, i + 1));
    return { positionMap, totalQuestions: questions.length };
  },
);
