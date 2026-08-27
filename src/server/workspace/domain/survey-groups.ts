// 설문 그룹 도메인 — 경계 계약(shared/contracts/workspace-io)의 재노출 + 서버 전용 규칙.
// client-safe — server-only·Node·DB 의존 없음.

export {
  CollectSurveysIntoGroupInput,
  CreateSurveyGroupInput,
  CreateSurveyGroupOutput,
  ListSurveyGroupsInput,
  ListSurveyGroupsOutput,
  ListUngroupedSurveysInput,
  ListUngroupedSurveysOutput,
  MoveSurveyToGroupInput,
  RenameSurveyGroupInput,
  ReorderSurveyGroupsInput,
  SurveyGroupIdInput,
  SurveyGroupListItem,
  UngroupedSurveyItem,
} from '@/shared/contracts/workspace-io';

// ─────────────────────────────────────────────────────────────────────────────
// 도메인 에러 — procedure 가 RPC 코드로 바꾼다
// ─────────────────────────────────────────────────────────────────────────────

/** 대상 그룹이 없다. 타 팀 그룹도 여기로 접힌다 — 존재를 알려주지 않는다. */
export class SurveyGroupNotFoundError extends Error {
  constructor() {
    super('그룹을 찾을 수 없습니다.');
    this.name = 'SurveyGroupNotFoundError';
  }
}

/** 같은 이름의 그룹이 그 팀에 이미 있다 (survey_groups_team_name_uq). */
export class DuplicateSurveyGroupNameError extends Error {
  constructor() {
    super('같은 이름의 그룹이 이미 있습니다.');
    this.name = 'DuplicateSurveyGroupNameError';
  }
}

/**
 * 담기·이동 대상 설문이 그룹의 팀에 속해 있지 않다.
 *
 * 관문을 통과한 뒤에도 서비스가 잠긴 행으로 다시 묻는다 — 판정과 쓰기 사이에 팀 해산·재배치가
 * 끼어들면 관문이 본 teamId 가 이미 옛것이기 때문이다.
 */
export class SurveyTeamMismatchError extends Error {
  constructor() {
    super('그룹과 설문의 소유 팀이 다릅니다.');
    this.name = 'SurveyTeamMismatchError';
  }
}

/** 「설문 담기」에 이미 다른 그룹에 속한 설문이 섞였다 — 담기는 미분류 전용이다. */
export class SurveyAlreadyGroupedError extends Error {
  constructor() {
    super('미분류 설문만 담을 수 있습니다.');
    this.name = 'SurveyAlreadyGroupedError';
  }
}

/** 대상 설문이 없거나 삭제됐다. */
export class SurveyGroupTargetNotFoundError extends Error {
  constructor() {
    super('설문을 찾을 수 없습니다.');
    this.name = 'SurveyGroupTargetNotFoundError';
  }
}
