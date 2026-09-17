import { eq } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveyVersions, surveys } from '@/db/schema';
import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';
import type { Question, SurveyLookup } from '@/types/survey';

/**
 * 버전 스냅샷 1행 조회. versionId 가 없거나 행이 없으면 null.
 *
 * 여러 도메인이 같은 한 줄을 각자 들고 있었고 캐스트만 네 가지였다. 스냅샷은 불변이라
 * 조회 조건에 상태/삭제 필터를 걸지 않는다 — 응답이 이미 그 버전에 묶여 있으면
 * prune 으로 snapshot 이 NULL 이 된 경우 외에는 항상 그 시점 구조를 돌려준다.
 */
export async function loadVersionSnapshot(
  versionId: string | null | undefined,
): Promise<SurveyVersionSnapshot | null> {
  if (!versionId) return null;

  const [row] = await db
    .select({ snapshot: surveyVersions.snapshot })
    .from(surveyVersions)
    .where(eq(surveyVersions.id, versionId))
    .limit(1);

  return (row?.snapshot ?? null) as SurveyVersionSnapshot | null;
}

/**
 * 설문의 현재 배포 버전 스냅샷. currentVersionId 가 없으면 두 번째 쿼리 없이 null.
 */
export async function loadCurrentVersionSnapshot(
  surveyId: string,
): Promise<SurveyVersionSnapshot | null> {
  const [row] = await db
    .select({ currentVersionId: surveys.currentVersionId })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);

  return loadVersionSnapshot(row?.currentVersionId);
}

/**
 * 스냅샷의 질문 목록. JSONB 스키마 드리프트 방어 — 배열이 아니면 순회에서 크래시하므로
 * 빈 배열로 접는다. "질문이 없다" 와 "구조가 깨졌다" 를 갈라야 하는 자리에서는
 * 이 함수 대신 호출측이 직접 Array.isArray 로 판정한다.
 */
export function snapshotQuestions(snapshot: SurveyVersionSnapshot | null): Question[] {
  return Array.isArray(snapshot?.questions) ? (snapshot.questions as unknown as Question[]) : [];
}

/** 스냅샷에 복사된 LUT 목록. 없거나 배열이 아니면 빈 배열. */
export function snapshotLookups(snapshot: SurveyVersionSnapshot | null): SurveyLookup[] {
  return Array.isArray(snapshot?.lookups) ? snapshot.lookups : [];
}
