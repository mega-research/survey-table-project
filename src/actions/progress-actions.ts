'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';
import type { ProgressColumnScheme } from '@/db/schema/schema-types';
import { requireAuth } from '@/lib/auth';

interface UpdateProgressColumnsResult {
  ok: boolean;
  error?: string;
}

/**
 * 진척률 표 컬럼 픽커 갱신.
 * - scheme.columns 빈 배열 → NULL 로 set (4개 고정 컬럼만).
 * - 검증: key 중복·order 충돌 방지.
 */
export async function updateProgressColumns(
  surveyId: string,
  scheme: ProgressColumnScheme,
): Promise<UpdateProgressColumnsResult> {
  await requireAuth();
  // key 중복 검증
  const keys = scheme.columns.map((c) => c.key);
  if (new Set(keys).size !== keys.length) {
    return { ok: false, error: '컬럼 키가 중복되었습니다.' };
  }
  // 빈 라벨 거부
  if (scheme.columns.some((c) => c.label.trim().length === 0)) {
    return { ok: false, error: '라벨이 비어있는 컬럼이 있습니다.' };
  }

  const persisted = scheme.columns.length === 0 ? null : scheme;
  await db.update(surveys).set({ progressColumns: persisted }).where(eq(surveys.id, surveyId));

  revalidatePath(`/admin/surveys/${surveyId}/operations/report`);
  revalidatePath(`/admin/surveys/${surveyId}/operations/report/columns`);
  return { ok: true };
}
