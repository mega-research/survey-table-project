import { and, eq, isNull } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveyVersions, surveys } from '@/db/schema';

import { completeResponseDenial, newResponseDenial } from '../domain/acceptance';
import type { BlockReason } from '../domain/duplicate';
import { toGateBlockReason } from '../domain/gate-block-reason';

/**
 * 응답 수용 게이트 — 지금 이 설문이 신규 응답을 받을 수 있는지, 진행 중 응답을 완료로
 * 확정할 수 있는지 판정하고 그 판정에 필요한 행을 읽는다.
 *
 * 판정 규칙 자체는 domain/acceptance 가 소유하고 여기는 조회 + 에러 타입 변환만 한다.
 * response.service 에서 갈라져 나왔다 — 그쪽으로 되돌아가는 import 가 없어야 한다(순환 금지).
 */

/** 가용성 게이트 입력 — 이미 조회된 설문 행의 부분집합. */
export type SurveyGateRow = {
  status: string;
  endDate: Date | null;
  maxResponses: number | null;
  isPublic: boolean;
  requireInviteToken: boolean;
  // #24 버전 무결성: 클라 제공 versionId 의 "현재 활성" 판정에 사용.
  currentVersionId: string | null;
  // 설문 중단·테스트 모드 (isValidTestToken 판정 + paused 게이트에 사용).
  isPaused: boolean;
  testModeEnabled: boolean;
  testToken: string | null;
};

/** 가용성 게이트 입력 — 응답 시점 활성 버전(없으면 null). */
export type VersionGateRow = { status: string } | null;

/**
 * 가용성 게이트 위반을 응답자 화면이 이해하는 blocked 결과로 접는다.
 *
 * 미배포·마감 설문에 들어온 응답자에게 500 대신 안내 화면을 보여주기 위한 것이다. 500 이면
 * 클라이언트가 차단을 인지하지 못해 답을 고를 때마다 무의미한 INSERT 를 다시 쏜다.
 * 가용성과 무관한 사유(변조 가드 등)는 null 을 돌려받아 그대로 throw 된다.
 */
export function toGateBlockedResult(err: unknown): { kind: 'blocked'; reason: BlockReason } | null {
  if (!(err instanceof SurveyNotAcceptingResponsesError)) return null;
  const reason = toGateBlockReason(err.reason);
  return reason ? { kind: 'blocked', reason } : null;
}

/** 응답 가용성 게이트 위반 시 던지는 에러. pub 엔드포인트라 호출자에 사유를 세분 노출하지 않는다. */
export class SurveyNotAcceptingResponsesError extends Error {
  /** 거부 사유. 메시지 문자열 파싱 없이 호출측이 분기할 수 있게 필드로 노출한다. */
  readonly reason: string;

  constructor(reason: string) {
    super(`응답을 받을 수 없는 설문입니다. (${reason})`);
    this.name = 'SurveyNotAcceptingResponsesError';
    this.reason = reason;
  }
}

/**
 * 설문이 지금 **신규 응답**을 받을 수 있는 상태인지 검증한다. 위반 시 throw.
 *
 * 검사 항목·판정 순서·isTest 면제 규칙은 domain/acceptance 의 newResponseDenial 이 소유한다
 * (그 파일의 CHECK_ORDER / CHECKS_FOR / PREDICATES 참조). 여기 남는 책임은 사유를 이 서비스의
 * 에러 타입으로 바꾸는 것뿐이다 — 호출부 3곳(startResponse / createResponseWithFirstAnswer /
 * createBlankResponse)의 시그니처를 유지하기 위한 얇은 어댑터다.
 */
export function assertSurveyAcceptingResponses(
  survey: SurveyGateRow,
  version: VersionGateRow,
  opts: { contactTargetId: string | null; completedCount?: number | null; isTest: boolean },
): void {
  const denial = newResponseDenial(survey, version, opts);
  if (denial) {
    throw new SurveyNotAcceptingResponsesError(denial);
  }
}

/**
 * 진행 중인 응답을 **완료로 확정**할 수 있는지 검증한다. 위반 시 throw.
 *
 * 신규 진입과 정책이 갈린다 — 마감(endDate)은 새 응답 접수를 닫는 것이지 이미 진행 중인
 * 응답을 몰수하는 것이 아니라서, 완료 게이트는 마감을 보지 않는다. 정원·중단·미배포·초대는
 * 그대로 차단한다. 검사 집합은 domain/acceptance 의 CHECKS_FOR.completeResponse 가 소유한다.
 * 던지는 에러 타입은 신규 게이트와 동일해 toGateBlockReason / rpc-error-policy 계약이 불변이다.
 */
export function assertResponseCompletable(
  survey: SurveyGateRow,
  version: VersionGateRow,
  opts: { contactTargetId: string | null; completedCount: number; isTest: boolean },
): void {
  const denial = completeResponseDenial(survey, version, opts);
  if (denial) {
    throw new SurveyNotAcceptingResponsesError(denial);
  }
}

/** 가용성 게이트용 설문 행 조회. 없으면 throw. */
export async function loadSurveyGateRow(surveyId: string): Promise<SurveyGateRow> {
  const row = await db.query.surveys.findFirst({
    where: and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)),
    columns: {
      status: true,
      endDate: true,
      maxResponses: true,
      isPublic: true,
      requireInviteToken: true,
      currentVersionId: true,
      isPaused: true,
      testModeEnabled: true,
      testToken: true,
    },
  });
  if (!row) {
    throw new SurveyNotAcceptingResponsesError('survey_not_found');
  }
  return row;
}

/** 활성 버전 행 조회. versionId 없으면 null. */
export async function loadVersionGateRow(versionId: string | null | undefined): Promise<VersionGateRow> {
  if (!versionId) return null;
  const row = await db.query.surveyVersions.findFirst({
    where: and(eq(surveyVersions.id, versionId), isNull(surveyVersions.deletedAt)),
    columns: { status: true },
  });
  return row ?? null;
}

/**
 * #24 버전 무결성 가드 — 클라 제공 versionId 의 소속/유효성 검증 + 무중단 갈아타기(티켓 04).
 *
 * 응답 행 생성 시점(startResponse/create*)에 클라이언트가 보내는 versionId 는 신뢰할 수 없다.
 * - versionId 가 null/undefined 면 레거시/버전 미연결 경로 — 검증 skip,
 *   effectiveVersionId=null 반환(기존 동작 보존).
 * - versionId 가 있으면 그 행이 반드시 동일 surveyId 에 속해야 한다. 미존재/타 설문 소속은
 *   version_mismatch 로 거부한다 — 타 설문 versionId 주입으로 응답이 엉뚱한 스냅샷에
 *   바인딩되는 것을 차단한다(불변).
 * - 같은 설문 소속이 확인된 구버전(비published 비활성 — 배포 전에 열어둔 탭)은 거부하지 않고
 *   현재 버전(currentVersionId)으로 재핀한다. 재핀 목적지가 없으면(currentVersionId=null)
 *   기존대로 version_not_active 거부.
 *
 * 재핀 시 version gate row 는 현재 버전 행으로 다시 조회하지 않는다 — 설문이 published 면
 * assertSurveyAcceptingResponses 의 status 검사(surveyPublished)로 통과하고, 설문 자체가
 * 비활성이면 어차피 거부되어야 하므로 구버전 행의 status 를 그대로 넘긴다.
 *
 * @returns version — assertSurveyAcceptingResponses 의 VersionGateRow 입력.
 *          effectiveVersionId — 이후 행 INSERT / 첫 답변 멤버십 검증이 써야 하는 versionId.
 */
export async function loadValidatedVersionGateRow(
  surveyId: string,
  versionId: string | null | undefined,
  currentVersionId: string | null,
): Promise<{ version: VersionGateRow; effectiveVersionId: string | null }> {
  if (!versionId) return { version: null, effectiveVersionId: null };
  const row = await db.query.surveyVersions.findFirst({
    where: and(eq(surveyVersions.id, versionId), isNull(surveyVersions.deletedAt)),
    columns: { surveyId: true, status: true },
  });
  // 미존재 또는 타 설문 소속이면 거부.
  if (!row || row.surveyId !== surveyId) {
    throw new SurveyNotAcceptingResponsesError('version_mismatch');
  }
  // 유효성: published 이거나 설문의 현재 활성 버전(currentVersionId)이면 그대로 사용.
  const isPublished = row.status === 'published';
  const isCurrent = currentVersionId != null && currentVersionId === versionId;
  if (!isPublished && !isCurrent) {
    // 무중단 갈아타기: 소속이 확인된 구버전이면 현재 버전으로 재핀. 목적지가 없으면 기존 거부.
    if (currentVersionId == null) {
      throw new SurveyNotAcceptingResponsesError('version_not_active');
    }
    return { version: { status: row.status }, effectiveVersionId: currentVersionId };
  }
  return { version: { status: row.status }, effectiveVersionId: versionId };
}
