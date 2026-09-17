// 설문 실사 초대 도메인 (.pen FLOW 4-2 실사 블록, 티켓 25).
//
// client-safe — server-only·Node·DB 의존 없음. 계약은 shared/contracts 가 소유하고 여기는
// 그것을 다시 내보내며 서버 전용 에러 어휘만 더한다(참여자·게스트 도메인과 같은 구조).
//
// 같은 폴더의 fieldwork-orgs.ts 는 **업체 엔티티**(티켓 24)이고 여기는 **설문 초대**다.
// 파일을 가른 이유는 관리 축이 다르기 때문이다 — 저쪽은 슈퍼어드민 전용 전역 명부,
// 이쪽은 설문 하나의 공유 설정이라 그 설문에 접근 가능한 내부인이 다룬다.

export {
  AddSurveyFieldworkInput,
  FieldworkCandidateItem,
  ListSurveyFieldworkInput,
  ListSurveyFieldworkOutput,
  RemoveSurveyFieldworkInput,
  SearchFieldworkCandidatesInput,
  SearchFieldworkCandidatesOutput,
  SurveyFieldworkItem,
  WorkspaceActionOutput,
} from '@/shared/contracts/workspace-io';

export { ParticipantSurveyNotFoundError } from './participants';

/**
 * 실사로 초대할 수 없는 계정이다.
 *
 * `userType='fieldwork'` + `status='active'` + **활성 업체 소속**만 통과한다. 마지막 조건이
 * 게스트 쪽과 갈리는 지점이다 — 게스트에게는 소속이 자유 입력 메모지만 실사에게는 **경계**라
 * (ADR-0019), 종료된 업체 사람을 초대하면 판정 코어가 어차피 닫는다(loadAccessSubject 가
 * 활성 업체일 때만 소속을 채운다). 그 행은 목록에만 서는 유령이 된다.
 */
export class FieldworkNotInvitableError extends Error {
  constructor(message = '활성 업체 소속의 실사 계정만 초대할 수 있습니다.') {
    super(message);
    this.name = 'FieldworkNotInvitableError';
  }
}

/** 이미 초대돼 있다 — 목록을 새로 고치면 보인다. */
export class FieldworkAlreadyInvitedError extends Error {
  constructor() {
    super('이미 초대된 실사 계정입니다.');
    this.name = 'FieldworkAlreadyInvitedError';
  }
}

/**
 * 초대 행이 없다 — 해제 대상이 사라졌다.
 *
 * 0행을 조용히 성공으로 접지 않는 이유는 화면 때문이다: 그 사이 다른 사람이 먼저 해제했는데
 * 「해제했습니다」라고 말하면, 다시 읽을 때까지 화면과 서버가 다른 것을 믿는다.
 */
export class FieldworkInviteNotFoundError extends Error {
  constructor() {
    super('실사 초대를 찾을 수 없습니다.');
    this.name = 'FieldworkInviteNotFoundError';
  }
}
