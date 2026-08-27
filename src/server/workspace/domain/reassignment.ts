// 재배치 센터 도메인 (.pen FLOW 8-2~8-4·9-2, 티켓 14).
//
// client-safe — server-only·Node·DB 의존 없음. 계약은 shared/contracts 가 소유하고 여기는
// 그것을 다시 내보내며 서버 전용 에러 어휘만 더한다(팀·그룹 도메인과 같은 구조).

export {
  AssignSurveysInput,
  AssignSurveysOutput,
  AssignUserToTeamInput,
  ListOwnerCandidatesOutput,
  PendingSurveyDetailOutput,
  PendingSurveyItem,
  ReassignmentInboxOutput,
  ReassignmentSummary,
  SurveyIdOnlyInput,
  UnassignedUserItem,
} from '@/shared/contracts/workspace-io';

export { TeamIdInput } from '@/shared/contracts/workspace-io';

/**
 * 배정하려는 사람이 이미 어딘가에 소속돼 있다.
 *
 * 보안 경계가 아니라 **정합성** 경계다 — 슈퍼어드민은 팀 상세의 팀원 추가로 겸직을 만들 수
 * 있으므로 이 검사가 막는 권한은 없다. 막는 것은 "인박스에서 본 미배치 상태가 이미 바뀌었다"
 * 는 사실을 조용히 지나쳐 의도치 않은 겸직을 만드는 일이다.
 */
export class UserAlreadyAssignedError extends Error {
  constructor() {
    super('이미 다른 팀에 소속된 사용자입니다. 목록을 새로 고친 뒤 다시 시도하세요.');
    this.name = 'UserAlreadyAssignedError';
  }
}

/** 배치하려는 설문 중 배치 대기가 아닌 것이 섞였다 — 일괄 배치는 전부 아니면 전무다. */
export class SurveyNotPendingError extends Error {
  constructor(public readonly surveyId: string) {
    super('배치 대기 상태가 아닌 설문이 포함돼 있습니다. 목록을 새로 고친 뒤 다시 시도하세요.');
    this.name = 'SurveyNotPendingError';
  }
}

/**
 * 새 소유자가 목적지 팀의 활성 멤버가 아니다.
 *
 * 이것이 이 티켓에서 가장 중요한 불변식이다. `resolveSurveyCapabilities` 의 소유자 분기는
 * **소유 팀 소속일 때만** 전권을 준다(티켓 13 하드닝). 팀 밖 사람을 소유자로 앉히면 배치는
 * 성공하는데 그 소유자가 자기 설문을 열지 못하는 설문이 만들어진다 — 화면에는 아무 경고도
 * 뜨지 않고, 팀장과 슈퍼어드민만 남아 원인이 한참 뒤에 드러난다.
 */
export class OwnerNotInTeamError extends Error {
  constructor() {
    super('새 소유자는 목적지 팀의 활성 멤버여야 합니다.');
    this.name = 'OwnerNotInTeamError';
  }
}
