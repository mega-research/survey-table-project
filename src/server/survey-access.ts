import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema';
import type { UserType } from '@/shared/contracts/auth';
import {
  surveyCapabilityValues,
  type SurveyAssignmentStatus,
  type SurveyCapability,
  type SurveyVisibility,
} from '@/shared/contracts/workspace';

import { getActiveTeamMemberships } from './read-models/team-memberships';

/**
 * 설문 접근 판정 — 이 파일이 유일한 정본이다 (역할 모델 v2 티켓 07, 스펙 §8).
 *
 * data-scope.ts 의 형제로 코어 계층에 둔다. "어느 파티션을 보는가" 를 그쪽이 정하듯
 * "무엇을 할 수 있는가" 는 여기가 정한다 — 도메인마다 각자 판정하면 매트릭스가 여러 벌이 된다.
 *
 * 판정은 순수 함수(resolveSurveyCapabilities)가 하고, DB 조회는 로더(loadSurveyAccess)가
 * 한다. 관문(assertSurveyCapability)은 둘을 잇는 얇은 층이다.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 주체·대상 모양
// ─────────────────────────────────────────────────────────────────────────────

export interface SurveyAccessSubject {
  userId: string;
  isSuperadmin: boolean;
  userType: UserType;
  /** **active 팀**의 멤버십 teamId — archived 팀 멤버십은 소속이 아니다(ADR-0011). */
  activeTeamIds: readonly string[];
  /** 위 중 role='leader' 인 teamId. */
  leaderTeamIds: readonly string[];
}

export interface SurveyAccessTarget {
  teamId: string | null;
  visibility: SurveyVisibility;
  /** 2단계 배포 중이라 nullable — 백필 전 행이 소유자 없이 존재할 수 있다. */
  ownerUserId: string | null;
  assignmentStatus: SurveyAssignmentStatus;
}

/**
 * 설문 단위 초대 — survey_participants 는 티켓 18 이 만든다.
 *
 * 지금 이 자리를 비워두지 않는 이유는 판정 순서가 초대 유무에 달려 있기 때문이다. 나중에
 * 인자를 끼워 넣으면 그때 모든 호출부의 순서가 바뀐다.
 */
export interface SurveyParticipation {
  kind: 'member' | 'guest' | 'fieldwork';
}

// ─────────────────────────────────────────────────────────────────────────────
// 역할 프리셋 — 스펙 §8 표의 열
// ─────────────────────────────────────────────────────────────────────────────

const ALL_CAPABILITIES: readonly SurveyCapability[] = surveyCapabilityValues;

/**
 * 전권 — 슈퍼어드민·소유자·소유 팀 팀장이 나눠 갖는 같은 집합이다(스펙 §8 의 세 열이 동일).
 *
 * 이름을 셋으로 나누지 않는 이유는 값이 하나라서다 — 사본이 셋이면 한 열만 고쳐지고 나머지가
 * 조용히 어긋난다. 세 주체를 가르는 것은 집합이 아니라 **판정 순서**이고, 그 순서는 아래
 * resolveSurveyCapabilities 가 갖는다. v2 델타는 여기 있다: v1 은 팀장을 invite_only 에서
 * 막았지만, 팀장이 자기 팀 설문을 관리하지 못하면 승계·해산·재배치가 소유자 부재로 잠긴다.
 */
const FULL_CAPS: readonly SurveyCapability[] = ALL_CAPABILITIES;

/**
 * 참여자 — 삭제까지 받는 신뢰 수준이라 운영 깊이(응답 상세·컨택·메일·export)를 함께 준다
 * (스펙 §4 ⚠️가정, §11-1). 빠지는 것은 설문 자체의 처분권이다: 발행·공유 관리·소유권 이전,
 * 그리고 팀 소유 구조인 설문 그룹.
 */
const PARTICIPANT_CAPS: readonly SurveyCapability[] = [
  'survey.view',
  'survey.edit',
  'survey.delete',
  'survey.invite',
  'operations.view',
  'responses.view',
  'contacts.view',
  'contacts.manage',
  'contacts.writeAttempts',
  'mail.view',
  'mail.send',
  'analytics.view',
  'export.download',
];

/**
 * 팀 공개 설문의 팀원 — 만들고 고치고 현황·분석을 보되 응답자 개인 데이터(응답 상세·컨택
 * 원본·메일·export)에는 닿지 않는다. 설문 그룹은 팀 공용 구조라 팀원도 정리할 수 있다.
 */
const TEAM_MEMBER_CAPS: readonly SurveyCapability[] = [
  'survey.view',
  'survey.edit',
  'survey.invite',
  'operations.view',
  'analytics.view',
  'surveyGroup.manage',
];

const NONE: ReadonlySet<SurveyCapability> = new Set();

// ─────────────────────────────────────────────────────────────────────────────
// 판정 (순수)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 이 사람이 이 설문에서 할 수 있는 일 — DB 를 만지지 않는 순수 함수.
 *
 * 순서가 곧 정책이다:
 *  1. 계정 유형 — guest·fieldwork 는 각자의 부여 모델(티켓 21·24)이 붙기 전까지 기본 거부.
 *  2. 슈퍼어드민 — 전권. break-glass 감사는 관문 레이어 책임이다.
 *  3. 팀 미배치 — 초대 설문을 포함해 모든 내부 설문 차단 (CONTEXT.md 「팀 미배치 사용자」).
 *  4. 배치 대기 설문 — 슈퍼어드민 외 차단. 팀이 정해지기 전에는 소유자도 못 연다(ADR-0006).
 *  5. 소유자 → 6. 소유 팀 팀장 → 7. 참여자 → 8. 팀 공개 설문의 팀원.
 *
 * invite_only 는 8번만 지운다 — "소유 팀 팀원에게만 숨김"이 v2 의 뜻이다(스펙 §3).
 */
export function resolveSurveyCapabilities(
  subject: SurveyAccessSubject,
  survey: SurveyAccessTarget,
  participation?: SurveyParticipation | null,
): ReadonlySet<SurveyCapability> {
  // isSuperadmin 은 internal 전용 플래그다 — 유형 게이트가 먼저 선다.
  if (subject.userType !== 'internal') return NONE;
  if (subject.isSuperadmin) return new Set(ALL_CAPABILITIES);
  if (subject.activeTeamIds.length === 0) return NONE;
  if (survey.assignmentStatus === 'assignment_pending') return NONE;

  if (survey.ownerUserId !== null && survey.ownerUserId === subject.userId) {
    return new Set(FULL_CAPS);
  }
  if (survey.teamId !== null && subject.leaderTeamIds.includes(survey.teamId)) {
    return new Set(FULL_CAPS);
  }
  // 참여자는 팀 경계를 넘는다 — 소유 팀 소속이 아니어도 선다(스펙 §4).
  if (participation?.kind === 'member') return new Set(PARTICIPANT_CAPS);

  if (
    survey.visibility === 'team' &&
    survey.teamId !== null &&
    subject.activeTeamIds.includes(survey.teamId)
  ) {
    return new Set(TEAM_MEMBER_CAPS);
  }
  return NONE;
}

// ─────────────────────────────────────────────────────────────────────────────
// 로더 · 관문
// ─────────────────────────────────────────────────────────────────────────────

/** 세션이 들고 있는 만큼의 주체 정보 — 멤버십은 로더가 채운다. */
export interface SurveyAccessUser {
  id: string;
  isSuperadmin: boolean;
  userType: UserType;
}

export class SurveyAccessError extends Error {
  constructor(public readonly reason: 'not_found' | 'forbidden') {
    super(reason);
    this.name = 'SurveyAccessError';
  }
}

/** 이 사람의 유효 소속을 읽어 판정 주체로 만든다. */
export async function loadAccessSubject(user: SurveyAccessUser): Promise<SurveyAccessSubject> {
  // 내부 계정이 아니면 멤버십 자체가 금지다(스펙 §1) — 조회를 아낀다.
  const memberships =
    user.userType === 'internal' ? await getActiveTeamMemberships(user.id) : [];
  return {
    userId: user.id,
    isSuperadmin: user.isSuperadmin,
    userType: user.userType,
    activeTeamIds: memberships.map((m) => m.teamId),
    leaderTeamIds: memberships.filter((m) => m.role === 'leader').map((m) => m.teamId),
  };
}

/**
 * 설문 하나에 대한 capability 를 DB 에서 읽어 판정한다.
 *
 * 삭제된 설문(deletedAt)은 없는 것으로 본다 — 복구 경로는 티켓 17 이 자기 관문으로 연다.
 * 참여자 조회는 survey_participants 가 생기는 티켓 18 에서 이 자리에 붙는다.
 */
export async function loadSurveyCapabilities(
  user: SurveyAccessUser,
  surveyId: string,
): Promise<ReadonlySet<SurveyCapability>> {
  const [row] = await db
    .select({
      teamId: surveys.teamId,
      visibility: surveys.visibility,
      ownerUserId: surveys.ownerUserId,
      assignmentStatus: surveys.assignmentStatus,
    })
    .from(surveys)
    .where(and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)))
    .limit(1);
  if (!row) throw new SurveyAccessError('not_found');

  const subject = await loadAccessSubject(user);
  return resolveSurveyCapabilities(subject, row, null);
}

/**
 * capability 요구에 대한 거부 사유 — 순수 함수 (티켓 09).
 *
 * 볼 수조차 없는(survey.view 없음) 설문은 존재를 알리지 않는다: 없는 설문과 같은
 * not_found 다. 사유가 갈리면 id 스캔으로 타 팀 설문의 존재가 확인된다. forbidden 은
 * "보이는 설문에서 그 작업만 못 한다"(참여자의 발행 등)에만 쓴다. 이 구분을 호출부마다
 * 다시 쓰면 한 표면만 존재를 흘리게 되므로 여기가 유일한 정본이다.
 */
export function denialReasonFor(
  capabilities: ReadonlySet<SurveyCapability>,
  capability: SurveyCapability,
): 'not_found' | 'forbidden' | null {
  if (!capabilities.has('survey.view')) return 'not_found';
  if (!capabilities.has(capability)) return 'forbidden';
  return null;
}

/**
 * 관문 — 이 capability 가 없으면 통과시키지 않는다.
 *
 * 거부 사유는 denialReasonFor 가 정한다 — not_found 는 "없거나 볼 수 없음"(존재 은닉),
 * forbidden 은 "보이지만 그 작업 권한 없음". 화면·procedure 는 사유를 자기 표면의
 * 코드(notFound()·NOT_FOUND/FORBIDDEN)로 옮기기만 한다.
 */
export async function assertSurveyCapability(
  user: SurveyAccessUser,
  surveyId: string,
  capability: SurveyCapability,
): Promise<void> {
  const caps = await loadSurveyCapabilities(user, surveyId);
  const denial = denialReasonFor(caps, capability);
  if (denial) throw new SurveyAccessError(denial);
}

/**
 * 여러 설문의 capability 를 한 왕복으로 판정한다 (티켓 12).
 *
 * 「설문 담기」처럼 한 요청이 N 건을 검사하는 표면이 assertSurveyCapability 를 루프로 부르면
 * 설문마다 설문 행 조회 + 멤버십 조회가 따로 돈다(200건이면 400 왕복). 판정 자체는
 * resolveSurveyCapabilities 라는 **순수 함수**라, 주체를 한 번 싣고 대상 행을 한 번에 읽으면
 * 결과가 완전히 같으면서 왕복은 2회다.
 *
 * 없는 설문·삭제된 설문의 id 는 맵에 담기지 않는다 — 호출부가 `?? EMPTY` 로 받으면
 * denialReasonFor 가 not_found 를 돌려주므로 "없음" 과 "볼 수 없음" 이 같은 결론이 된다.
 */
export async function loadSurveyCapabilitiesBatch(
  user: SurveyAccessUser,
  surveyIds: readonly string[],
): Promise<Map<string, ReadonlySet<SurveyCapability>>> {
  const result = new Map<string, ReadonlySet<SurveyCapability>>();
  if (surveyIds.length === 0) return result;

  const rows = await db
    .select({
      id: surveys.id,
      teamId: surveys.teamId,
      visibility: surveys.visibility,
      ownerUserId: surveys.ownerUserId,
      assignmentStatus: surveys.assignmentStatus,
    })
    .from(surveys)
    .where(and(inArray(surveys.id, [...new Set(surveyIds)]), isNull(surveys.deletedAt)));

  const subject = await loadAccessSubject(user);
  for (const row of rows) {
    result.set(row.id, resolveSurveyCapabilities(subject, row, null));
  }
  return result;
}

/** 빈 capability 집합 — 존재하지 않는 설문의 판정 입력. */
const NO_CAPABILITIES: ReadonlySet<SurveyCapability> = new Set();

/**
 * 배치 관문 — 설문 전부가 요구 capability 를 **모두** 가져야 통과한다.
 *
 * 하나라도 막히면 그 자리에서 던진다. 부분 성공을 허용하면 "N개 중 3개만 담겼다" 는 상태를
 * 화면이 표현할 수 없고, 담기는 트랜잭션 하나라 실제로도 전부 아니면 전무다.
 */
export async function assertSurveyCapabilityBatch(
  user: SurveyAccessUser,
  surveyIds: readonly string[],
  capabilities: readonly SurveyCapability[],
): Promise<void> {
  const caps = await loadSurveyCapabilitiesBatch(user, surveyIds);
  for (const surveyId of surveyIds) {
    const own = caps.get(surveyId) ?? NO_CAPABILITIES;
    for (const capability of capabilities) {
      const denial = denialReasonFor(own, capability);
      if (denial) throw new SurveyAccessError(denial);
    }
  }
}
