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
  RelocateSurveyGroupInput,
  RenameSurveyGroupInput,
  ReorderSurveyGroupsInput,
  SURVEY_GROUP_MAX_DEPTH,
  SurveyGroupIdInput,
  SurveyGroupListItem,
  SurveyGroupRemoveConflict,
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

/** 같은 이름의 그룹이 같은 자리(같은 상위 그룹 안, 최상위끼리는 팀 안)에 이미 있다 (0166 의 유일 인덱스 둘). */
export class DuplicateSurveyGroupNameError extends Error {
  constructor() {
    super('같은 이름의 그룹이 이미 있습니다.');
    this.name = 'DuplicateSurveyGroupNameError';
  }
}

/** 3단계 그룹 밑에는 하위 그룹을 둘 수 없다 (0166 의 깊이 제약 — DB 도 같은 것을 막는다). */
export class SurveyGroupDepthExceededError extends Error {
  constructor() {
    super('그룹은 3단계까지만 만들 수 있습니다.');
    this.name = 'SurveyGroupDepthExceededError';
  }
}

/**
 * 그룹을 지우면 하위 그룹이 한 단계 위로 올라가는데, 그 자리에 같은 이름의 그룹이 이미 있다.
 *
 * 아무것도 바꾸지 않고 거부한다 — 한쪽만 올리면 정리해 둔 가지가 반쯤 풀린다. 무엇을 고치면
 * 되는지 알려 주려고 겹치는 이름을 싣는다(올라갈 하위 그룹의 표시 순서대로).
 */
export class SurveyGroupLiftNameConflictError extends Error {
  readonly conflictingNames: readonly string[];

  constructor(conflictingNames: readonly string[]) {
    const quoted = conflictingNames.map((name) => `「${name}」`).join(' · ');
    super(
      `한 단계 위에 이미 ${quoted} 그룹이 있어 하위 그룹을 올릴 수 없습니다. 한쪽 이름을 바꾼 뒤 다시 삭제하세요.`,
    );
    this.name = 'SurveyGroupLiftNameConflictError';
    this.conflictingNames = conflictingNames;
  }
}

/**
 * 그룹을 자기 자신이나 자기 하위 그룹 밑으로 옮기려 했다 (그룹 옮기기) — 되면 순환이 생긴다.
 *
 * DB 도 같은 것을 막지만(0166 의 깊이 제약이 순환을 허용하지 않는다) 그쪽 거부는 CHECK 위반이라
 * 화면에는 「내부 오류」로 보인다. 서비스가 먼저 판정해 이 사유로 답한다.
 */
export class SurveyGroupRelocationCycleError extends Error {
  constructor() {
    super('그룹을 자기 자신이나 자기 하위 그룹 밑으로 옮길 수 없습니다.');
    this.name = 'SurveyGroupRelocationCycleError';
  }
}

/** 옮긴 결과가 3단계를 넘는다 — 「새 상위의 깊이 + 옮기는 가지의 높이」가 최대 단계보다 크다. */
export class SurveyGroupRelocationTooDeepError extends Error {
  constructor() {
    super('이 자리로 옮기면 그룹이 3단계를 넘습니다.');
    this.name = 'SurveyGroupRelocationTooDeepError';
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
