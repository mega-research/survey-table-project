// 설문 게스트 부여 도메인 (.pen FLOW 4-2 클라이언트 블록, 티켓 21).
//
// client-safe — server-only·Node·DB 의존 없음. 계약은 shared/contracts 가 소유하고 여기는
// 그것을 다시 내보내며 서버 전용 에러 어휘만 더한다(참여자 도메인과 같은 구조).

export {
  AddSurveyGuestInput,
  GuestCandidateItem,
  ListSurveyGuestsInput,
  ListSurveyGuestsOutput,
  RemoveSurveyGuestInput,
  SearchGuestCandidatesInput,
  SearchGuestCandidatesOutput,
  SetSurveyGuestTabsInput,
  SurveyGuestItem,
  WorkspaceActionOutput,
} from '@/shared/contracts/workspace-io';

export { ParticipantSurveyNotFoundError } from './participants';

/**
 * 게스트로 부여할 수 없는 계정이다.
 *
 * `userType='guest'` + `status='active'` 만 통과한다. 내부 계정을 게스트로 부여하면 코어의
 * 게스트 분기는 계정 유형을 먼저 보므로 아무 효과가 없고(그 사람은 내부 사슬로 판정된다),
 * 목록에는 「클라이언트」로 서는 유령 행만 남는다 — 그것을 본 다음 사람은 권한 버그로 읽는다.
 * 참여자 쪽 ParticipantNotInvitableError 와 같은 이유의 다른 모집단이다.
 */
export class GuestNotGrantableError extends Error {
  constructor(message = '활성 게스트 계정만 부여할 수 있습니다.') {
    super(message);
    this.name = 'GuestNotGrantableError';
  }
}

/** 이미 부여돼 있다 — 목록을 새로 고치면 보인다. */
export class GuestAlreadyGrantedError extends Error {
  constructor() {
    super('이미 부여된 게스트 계정입니다.');
    this.name = 'GuestAlreadyGrantedError';
  }
}

/**
 * 부여 행이 없다 — 해제·탭 저장의 대상이 사라졌다.
 *
 * 0행을 조용히 성공으로 접지 않는 이유는 화면 때문이다: 그 사이 다른 사람이 먼저 해제했는데
 * 「저장했습니다」라고 말하면, 다시 읽을 때까지 화면과 서버가 다른 것을 믿는다.
 */
export class GuestGrantNotFoundError extends Error {
  constructor() {
    super('게스트 부여를 찾을 수 없습니다.');
    this.name = 'GuestGrantNotFoundError';
  }
}
