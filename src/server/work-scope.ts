import 'server-only';

import { cookies } from 'next/headers';

import { isValidUUID } from '@/lib/utils';
import {
  SYSTEM_SCOPE,
  WORK_SCOPE_COOKIE,
  type WorkScope,
} from '@/shared/contracts/workspace';

import {
  loadAccessSubject,
  type SurveyAccessSubject,
  type SurveyAccessUser,
} from './survey-access';

/**
 * 작업 범위 — 이 요청이 **어느 팀의 워크스페이스를** 보고 있는가 (역할 모델 v2 티켓 07).
 *
 * data-scope.ts 의 형제다. 그쪽이 "실/테스트 어느 파티션인가" 를 정하듯 여기는 "어느 팀
 * 경계인가" 를 정한다. 둘 다 요청 스코프 판정이라 코어 계층에 나란히 둔다.
 *
 * 화면은 이 값을 쿠키·URL 로 기억하지만(티켓 08 팀 스위처) **그건 편의일 뿐이다** —
 * 실제 범위는 언제나 여기서 멤버십을 다시 읽어 정한다.
 */

export class WorkScopeError extends Error {
  constructor(public readonly reason: 'forbidden') {
    super(reason);
    this.name = 'WorkScopeError';
  }
}

/**
 * 요청이 들고 온 범위를 검증해 실제 범위로 바꾼다 — 순수 함수.
 *
 * - `system` 은 슈퍼어드민만. 일반 사용자의 요청은 **거부한다** — 조용히 자기 팀으로
 *   접으면 "전체를 봤다" 고 착각한 화면이 부분 목록을 전체로 표시한다.
 * - 팀 지목이 내 소속과 어긋나면 첫 활성 팀으로 **접는다**. 쿠키에 남은 옛 팀(해산·이동)
 *   때문에 화면이 잠기지 않게 하는 쪽이 낫고, 조회는 해석된 범위로만 나가므로 새지 않는다.
 * - 슈퍼어드민은 자기 소속이 아닌 팀도 지목할 수 있다(전 팀 접근).
 */
export function resolveWorkScopeFor(
  subject: SurveyAccessSubject,
  requested: string | null,
): WorkScope {
  if (subject.userType !== 'internal') return { kind: 'none' };

  if (requested === SYSTEM_SCOPE) {
    if (!subject.isSuperadmin) throw new WorkScopeError('forbidden');
    return { kind: 'system' };
  }

  if (subject.isSuperadmin) {
    // 슈퍼어드민은 자기 소속이 아닌 팀도 지목할 수 있어 멤버십으로 걸러지지 않는다. 그래서
    // 형식만이라도 여기서 본다 — 쿠키에 담긴 아무 문자열이 그대로 uuid 비교로 내려가면
    // Postgres 가 invalid input syntax 로 500 을 낸다. 없는 팀이면 목록이 비는 것으로 족하다.
    if (requested && isValidUUID(requested)) return { kind: 'team', teamId: requested };
    return { kind: 'system' };
  }

  const matched =
    requested && subject.activeTeamIds.includes(requested) ? requested : null;
  const teamId = matched ?? subject.activeTeamIds[0];
  return teamId ? { kind: 'team', teamId } : { kind: 'none' };
}

/**
 * 세션 사용자로 시작하는 짧은 길 — 멤버십을 읽어 순수 판정에 넘긴다.
 *
 * 요청이 범위를 지목하지 않으면 쿠키를 본다. 화면은 첫 조회에서 아직 자기 범위를 모르므로
 * (서버가 해석해 돌려주기 전이다) 요청에 실려 온 쿠키가 출발점이 된다. 값이 무엇이든 아래
 * 순수 판정을 그대로 통과하므로 무효한 쿠키는 첫 활성 팀으로 접힌다.
 */
export async function resolveWorkScope(
  user: SurveyAccessUser,
  requested: string | null,
): Promise<WorkScope> {
  const subject = await loadAccessSubject(user);
  // 요청이 범위를 명시했으면 거부는 거부다 — 조용히 접으면 화면이 부분을 전체로 착각한다.
  if (requested !== null) return resolveWorkScopeFor(subject, requested);

  // 쿠키에서 온 값은 **접는다**. 화면(admin 셸·분석 목록)이 이미 같은 처리를 하므로,
  // 여기만 거부하면 스위처에는 팀이 보이는데 설문 생성만 막히는 상태가 생긴다
  // (강등된 슈퍼어드민의 잔존 'system' 쿠키). 접는 쪽은 언제나 더 좁으므로 새지 않는다.
  const cookie = await readRequestWorkScopeCookie();
  try {
    return resolveWorkScopeFor(subject, cookie);
  } catch (error) {
    if (!(error instanceof WorkScopeError)) throw error;
    return resolveWorkScopeFor(subject, null);
  }
}

/** 요청에 실려 온 쿠키. 브라우저 쪽 동명 헬퍼(shared/lib)와 구분해 이름을 길게 둔다. */
async function readRequestWorkScopeCookie(): Promise<string | null> {
  try {
    return (await cookies()).get(WORK_SCOPE_COOKIE)?.value ?? null;
  } catch {
    // 요청 컨텍스트 밖(잡·스크립트)에서는 쿠키가 없다 — 범위 미지정으로 본다.
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 목록 조회 조건
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 해석된 범위를 목록 쿼리가 읽을 수 있는 조건으로 옮긴 것.
 *
 * SQL 조립(read-models)과 판정(여기)을 가르는 자리다 — read-models 가 "이 사람이 팀장인가"
 * 를 다시 묻기 시작하면 매트릭스가 두 벌이 된다.
 */
export type SurveyScopeFilter =
  /** 시스템 전체 보기 — 전 팀 + 배치 대기 설문까지. 조건이 없어 viewerId 도 필요 없다. */
  | { kind: 'all' }
  | {
      kind: 'team';
      teamId: string;
      viewerId: string;
      /** invite_only 설문까지 보는가 — 소유 팀 팀장·슈퍼어드민만(스펙 §3). */
      seesInviteOnly: boolean;
    }
  | { kind: 'none' };

/**
 * 이 범위에서 이 사람이 보게 될 설문의 조건.
 *
 * invite_only 는 팀원에게만 숨기는 것이라, 팀장이 아니어도 **자기가 소유한** 설문은
 * 목록에 남아야 한다 — 그 조건은 viewerId 로 쿼리가 함께 본다.
 */
export function buildSurveyScopeFilter(
  subject: SurveyAccessSubject,
  scope: WorkScope,
): SurveyScopeFilter {
  if (scope.kind === 'none') return { kind: 'none' };
  if (scope.kind === 'system') return { kind: 'all' };
  return {
    kind: 'team',
    teamId: scope.teamId,
    viewerId: subject.userId,
    seesInviteOnly: subject.isSuperadmin || subject.leaderTeamIds.includes(scope.teamId),
  };
}
