import 'server-only';

import { and, asc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { surveyParticipants, surveys, surveyVersions } from '@/db/schema';
import { normalizeSurveyGuestTabs } from '@/shared/contracts/workspace';
import type { GuestSurveyCardRow, GuestSurveyLifecycle } from '@/shared/contracts/workspace-io';

/**
 * 게스트 홈이 보는 「부여된 설문」 목록 (.pen FLOW 5-2, 역할 모델 v2 티켓 22).
 *
 * read-model 인 이유는 두 도메인 테이블(workspace 의 부여 행 + survey-builder 의 설문·버전)을
 * **읽기만** 하기 때문이다. 도메인을 import 하지 않으므로 자기완결이다.
 *
 * 목록이 접근 판정을 **다시 하지 않는 대신 같은 조건을 건다**. 카드는 그 자리에서 열리는
 * 링크라, 코어가 거부할 설문이 목록에 서면 「눌러도 안 열리는 카드」가 된다 —
 * `resolveSurveyCapabilities` 의 게스트 분기가 막는 것 셋을 그대로 옮긴다:
 *  - `deleted_at IS NULL` (삭제된 설문은 없는 것)
 *  - `assignment_status = 'assigned'` (배치 대기는 아무도 못 연다, ADR-0006)
 *  - `kind = 'guest'` (참여자·실사 행으로는 게스트 자격이 서지 않는다)
 *
 * 공개 범위(visibility)는 **일부러 조건에 없다** — 게스트에게는 부여가 유일한 자격이고
 * invite_only 는 소유 팀 팀원에게만 숨기는 축이다(스펙 §3).
 */
export async function listGuestSurveys(userId: string): Promise<GuestSurveyCardRow[]> {
  const rows = await db
    .select({
      surveyId: surveys.id,
      title: surveys.title,
      endDate: surveys.endDate,
      status: surveys.status,
      isPaused: surveys.isPaused,
      currentVersionId: surveys.currentVersionId,
      publishedAt: surveyVersions.publishedAt,
      guestTabs: surveyParticipants.guestTabs,
      addedAt: surveyParticipants.createdAt,
    })
    .from(surveyParticipants)
    .innerJoin(surveys, eq(surveys.id, surveyParticipants.surveyId))
    // 현재 배포 버전의 발행 시각 = 기간의 시작. 미발행 설문은 null 로 남는다.
    .leftJoin(surveyVersions, eq(surveyVersions.id, surveys.currentVersionId))
    .where(
      and(
        eq(surveyParticipants.userId, userId),
        eq(surveyParticipants.kind, 'guest'),
        isNull(surveys.deletedAt),
        eq(surveys.assignmentStatus, 'assigned'),
      ),
    )
    // 부여된 순서 — 카드가 늘어도 자리가 흔들리지 않는다(최근 수정순은 매번 뒤집힌다).
    .orderBy(asc(surveyParticipants.createdAt));

  return rows.map((row) => ({
    surveyId: row.surveyId,
    title: row.title,
    publishedAt: row.publishedAt ?? null,
    endDate: row.endDate,
    lifecycle: resolveLifecycle(row),
    tabs: normalizeSurveyGuestTabs(row.guestTabs),
  }));
}

/**
 * 카드의 진행 상태 — 순서가 곧 뜻이다.
 *
 * 미발행이 먼저인 이유는 그 설문에 열 것이 없기 때문이다(프리뷰는 배포 스냅샷을 본다).
 * 종료가 일시중지보다 먼저인 것은 마감일이 지난 설문의 중단 여부가 응답자에게 의미가 없어서다.
 */
function resolveLifecycle(row: {
  status: string;
  currentVersionId: string | null;
  isPaused: boolean;
  endDate: Date | null;
}): GuestSurveyLifecycle {
  if (row.status !== 'published' || row.currentVersionId === null) return 'draft';
  if (row.endDate !== null && row.endDate.getTime() < Date.now()) return 'closed';
  if (row.isPaused) return 'paused';
  return 'running';
}
