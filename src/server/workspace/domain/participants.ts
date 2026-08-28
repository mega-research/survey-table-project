// 설문 참여자 도메인 (.pen FLOW 4-2, 티켓 18).
//
// client-safe — server-only·Node·DB 의존 없음. 계약은 shared/contracts 가 소유하고 여기는
// 그것을 다시 내보내며 서버 전용 에러 어휘만 더한다(팀·그룹·재배치·공유 도메인과 같은 구조).

export {
  AddSurveyParticipantInput,
  ListSurveyParticipantsInput,
  ListSurveyParticipantsOutput,
  RemoveSurveyParticipantInput,
  SearchParticipantCandidatesInput,
  SearchParticipantCandidatesOutput,
  SurveyParticipantItem,
  WorkspaceActionOutput,
} from '@/shared/contracts/workspace-io';

/**
 * 참여자로 세울 수 없는 계정이다.
 *
 * 막는 것은 두 부류 — **비내부 계정**(guest·fieldwork)과 **비활성 계정**. 앞의 것은 스펙 §9
 * 의 「kind 와 userType 정합」이고, 뒤의 것은 퇴사자·정지 계정을 새로 들이지 않기 위해서다.
 *
 * capability 코어가 어차피 전부 거부하므로 보안 경계는 아니다. 막는 것은 「추가는 됐는데
 * 아무것도 안 되는」 유령 행이 목록에 남는 일이다 — 그 행을 본 다음 사람은 권한 버그로 읽는다.
 */
export class ParticipantNotInvitableError extends Error {
  constructor(message = '내부 활성 계정만 참여자로 초대할 수 있습니다.') {
    super(message);
    this.name = 'ParticipantNotInvitableError';
  }
}

/**
 * 소유자는 참여자가 될 수 없다.
 *
 * 소유자는 이미 전권을 갖고 있어 행을 더해도 판정이 달라지지 않는다. 그런데 목록에 서면
 * 「제외」 버튼이 생기고, 그것을 누르면 아무 일도 일어나지 않거나(판정은 소유자 분기가 먼저
 * 이긴다) 소유자를 쫓아낸 것처럼 보인다. 티켓의 「소유자는 누구도 제외 불가」를 사후 검사가
 * 아니라 **입구에서** 지키는 쪽을 골랐다.
 */
export class OwnerCannotBeParticipantError extends Error {
  constructor() {
    super('설문 소유자는 참여자로 추가할 수 없습니다.');
    this.name = 'OwnerCannotBeParticipantError';
  }
}

/** 이미 참여 중이다 — 목록을 새로 고치면 보인다. */
export class ParticipantAlreadyExistsError extends Error {
  constructor() {
    super('이미 참여자로 추가된 사용자입니다.');
    this.name = 'ParticipantAlreadyExistsError';
  }
}

/** 제외하려는 참여 행이 없다 — 그 사이 다른 사람이 먼저 뺐다. */
export class ParticipantNotFoundError extends Error {
  constructor() {
    super('참여자를 찾을 수 없습니다.');
    this.name = 'ParticipantNotFoundError';
  }
}
