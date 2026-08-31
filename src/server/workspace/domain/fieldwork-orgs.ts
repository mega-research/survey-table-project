// 실사 업체 도메인 — 경계 계약(shared/contracts/workspace-io)의 재노출 + 서버 전용 규칙.
// client-safe — server-only·Node·DB 의존 없음.

export {
  ArchiveFieldworkOrgInput,
  CreateFieldworkOrgInput,
  CreateFieldworkOrgOutput,
  FieldworkOrgAccountItem,
  FieldworkOrgListItem,
  FieldworkOrgOption,
  ListFieldworkOrgOptionsOutput,
  ListFieldworkOrgsOutput,
  UpdateFieldworkOrgInput,
  WorkspaceActionOutput,
} from '@/shared/contracts/workspace-io';

// ─────────────────────────────────────────────────────────────────────────────
// 도메인 에러 — procedure 가 RPC 코드로 바꾼다
// ─────────────────────────────────────────────────────────────────────────────

/** 대상 업체가 없거나 이미 종료됐다(archived). procedure 가 NOT_FOUND 로 바꾼다. */
export class FieldworkOrgNotFoundError extends Error {
  constructor() {
    super('실사 업체를 찾을 수 없습니다.');
    this.name = 'FieldworkOrgNotFoundError';
  }
}

/** 같은 이름의 활성 업체가 이미 있다 (fieldwork_orgs_active_name_uq). */
export class DuplicateFieldworkOrgNameError extends Error {
  constructor() {
    super('같은 이름의 실사 업체가 이미 있습니다.');
    this.name = 'DuplicateFieldworkOrgNameError';
  }
}

/**
 * 재직 중 계정이 남아 있어 업체를 종료할 수 없다.
 *
 * 팀 해산과 갈리는 지점이다. 팀은 해산해도 팀원이 「미배치」라는 **정의된 상태**로 내려가지만
 * (ADR-0011), 실사 계정에는 그런 상태가 없다 — `users_fieldwork_fields_check` 가 실사 계정의
 * 소속을 NOT NULL 로 묶기 때문이다. 그래서 종료된 업체의 재직 계정은 정의되지 않은 상태로
 * 계속 로그인한다. 먼저 계정을 정지·퇴사 처리하게 하는 편이 정직하다.
 */
export class FieldworkOrgHasActiveAccountsError extends Error {
  constructor(activeCount: number) {
    super(`재직 중인 계정이 ${activeCount}명 남아 있어 업체를 종료할 수 없습니다.`);
    this.name = 'FieldworkOrgHasActiveAccountsError';
  }
}
