// 공유 설정 도메인 (.pen FLOW 4-2, 티켓 16).
//
// client-safe — server-only·Node·DB 의존 없음. 계약은 shared/contracts 가 소유하고 여기는
// 그것을 다시 내보내며 서버 전용 에러 어휘만 더한다(팀·그룹·재배치 도메인과 같은 구조).

export { SetSurveyVisibilityInput, WorkspaceActionOutput } from '@/shared/contracts/workspace-io';

/**
 * 범위를 바꾸려는 설문이 이미 사라졌다.
 *
 * 관문의 조회와 UPDATE 는 별도 왕복이라 그 사이에 삭제가 커밋될 수 있다. 0행을 조용히
 * 성공으로 접으면 화면은 「저장했습니다」를 띄우고 목록을 다시 읽어 아무것도 못 찾는다 —
 * 저장이 안 됐다는 사실이 어디에도 남지 않는다.
 */
export class SharingSurveyNotFoundError extends Error {
  constructor() {
    super('설문을 찾을 수 없습니다.');
    this.name = 'SharingSurveyNotFoundError';
  }
}
