import 'server-only';

import { and, asc, eq, isNull, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { surveyParticipants, surveys, surveyVersions } from '@/db/schema';
import {
  normalizeSurveyStatus,
  type SurveyStatus,
} from '@/shared/contracts/survey-builder-io';
import { normalizeSurveyGuestTabs } from '@/shared/contracts/workspace';
import type {
  ClientSurveyHeaderRow,
  GuestSurveyCardRow,
  GuestSurveyLifecycle,
} from '@/shared/contracts/workspace-io';

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
  return selectGuestSurveys(userId);
}

/**
 * 부여 설문 **한 건** — 열람 화면의 서브헤더가 쓴다.
 *
 * 목록과 같은 조회·같은 매핑을 지나는 것이 요점이다. 설문 행을 따로 읽으면 「홈에는
 * 종료인데 열람 화면에는 진행중」 같은 어긋남이 생긴다 — 상태 판정의 정본이 둘이 된다.
 * 부여가 없거나 위 조건에 걸리면 null 이고, 호출부가 존재를 알리지 않는다.
 */
export async function getGuestSurveyCard(
  userId: string,
  surveyId: string,
): Promise<GuestSurveyCardRow | null> {
  const [row] = await selectGuestSurveys(userId, eq(surveys.id, surveyId));
  return row ?? null;
}

/**
 * 열람 화면 머리 — **설문 id 만으로** 읽는다 (ADR-0029).
 *
 * 클라이언트 링크 입구가 쓴다. 링크 주체에게는 계정이 없어 위의 「이 사람에게 부여된 설문」으로
 * 물을 수 없다 — 누가 볼 수 있는가는 관문(링크 세션 + capability)이 이미 답했고, 이 조회는 그
 * 뒤에 불린다. 그래서 부여 행을 지나지 않는다.
 *
 * 닫는 조건은 관문과 같다(삭제 · 배치 대기). 관문을 지난 직후 그 사이에 설문이 닫혔다면
 * null 이고, 호출부가 존재를 알리지 않는다.
 *
 * 진행 상태는 계정 쪽 카드와 **같은 판정 함수**를 쓴다 — 두 입구의 화면 머리가 다른 말을
 * 하지 않게 한다. 탭은 싣지 않는다: 계정은 참여 행에서, 링크는 링크 행에서 오므로 이 조회의
 * 관심사가 아니다.
 */
export async function getClientSurveyHeader(
  surveyId: string,
): Promise<ClientSurveyHeaderRow | null> {
  const [row] = await db
    .select({
      surveyId: surveys.id,
      title: surveys.title,
      endDate: surveys.endDate,
      status: surveys.status,
      isPaused: surveys.isPaused,
      currentVersionId: surveys.currentVersionId,
      publishedAt: surveyVersions.publishedAt,
    })
    .from(surveys)
    .leftJoin(surveyVersions, eq(surveyVersions.id, surveys.currentVersionId))
    .where(
      and(
        eq(surveys.id, surveyId),
        isNull(surveys.deletedAt),
        eq(surveys.assignmentStatus, 'assigned'),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    surveyId: row.surveyId,
    title: row.title,
    publishedAt: row.publishedAt ?? null,
    endDate: row.endDate,
    lifecycle: resolveGuestSurveyLifecycle(
      { ...row, status: normalizeSurveyStatus(row.status) },
      Date.now(),
    ),
  };
}

async function selectGuestSurveys(
  userId: string,
  extra?: SQL,
): Promise<GuestSurveyCardRow[]> {
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
        extra,
      ),
    )
    // 부여된 순서 — 카드가 늘어도 자리가 흔들리지 않는다(최근 수정순은 매번 뒤집힌다).
    .orderBy(asc(surveyParticipants.createdAt));

  return rows.map((row) => ({
    surveyId: row.surveyId,
    title: row.title,
    publishedAt: row.publishedAt ?? null,
    endDate: row.endDate,
    lifecycle: resolveGuestSurveyLifecycle(
      { ...row, status: normalizeSurveyStatus(row.status) },
      Date.now(),
    ),
    tabs: normalizeSurveyGuestTabs(row.guestTabs),
  }));
}

/**
 * 카드의 진행 상태 — 순서가 곧 뜻이다.
 *
 * `status` 는 어휘 타입으로 받는다. `surveys.status` 는 `$type<>` 없는 text 컬럼이라 조회
 * 결과가 string 이고, 그대로 비교하면 오타가 컴파일을 통과한다 — 호출부가
 * `normalizeSurveyStatus` 로 접어서 넘긴다(로더 정규화 관례).
 *
 * 미발행이 먼저인 이유는 그 설문에 열 것이 없기 때문이다(프리뷰는 배포 스냅샷을 본다).
 * **「발행된 적 있는가」는 배포 버전의 유무로 묻는다** — 설문 종료(ADR-0030)가 생긴 뒤로
 * `status` 는 published 가 아니어도 발행된 설문일 수 있다. 예전처럼 「published 가 아니면
 * 미발행」으로 두면 종료한 설문이 클라이언트에게 「미발행」으로 보인다.
 * 종료가 일시중지보다 먼저인 것은 끝난 조사의 중단 여부가 보는 사람에게 의미가 없어서다 —
 * 종료 스위치로 끝냈든 마감일이 지났든 같다.
 */
export function resolveGuestSurveyLifecycle(
  row: {
    status: SurveyStatus;
    currentVersionId: string | null;
    isPaused: boolean;
    endDate: Date | null;
  },
  now: number,
): GuestSurveyLifecycle {
  if (row.status === 'draft' || row.currentVersionId === null) return 'draft';
  if (row.status === 'closed') return 'closed';
  if (row.endDate !== null && row.endDate.getTime() < now) return 'closed';
  if (row.isPaused) return 'paused';
  return 'running';
}
