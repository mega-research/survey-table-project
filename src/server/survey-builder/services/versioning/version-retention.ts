/**
 * 버전 보존 규칙 — 순수 판정. SQL 조회(version-retention-sql.ts)와 이 함수가
 * 같은 규칙을 표현한다. 규칙을 바꾸면 양쪽을 함께 바꾼다.
 *
 * keep = 지금 배포본 OR 지금 테스트 버전 OR 완전 삭제되지 않은 비테스트 응답 보유
 *        OR 이관 출처로 참조됨 OR 이관 이력이 가리킴
 *
 * 테스트 응답(is_test)은 보존 근거로 치지 않는다 — 롤백 기능이 없어 발행 이력의 열람 가치가
 * 낮다는 판단 (2026-07-31 spec §5.1). 휴지통(soft delete) 응답은 센다 — 되살릴 수 있으므로
 * 그 응답이 기대는 구조도 남긴다 (2026-10-23, CONTEXT.md 「배포 버전 스냅샷」).
 *
 * 이관 출처 보호(ADR-0014): 재개 시점 재핀으로 미완료 응답의 versionId 가 현재
 * 버전으로 옮겨가면 원 버전은 versionId 참조를 잃는다. 대신 응답 metadata 의
 * migratedFromVersionId 가 원 버전을 가리키므로, 그 참조가 살아있는 한 스냅샷을
 * 비우면 이관 출처 기록이 빈 껍데기를 가리키게 된다 — 프루닝에서 보호한다.
 * 이관 이력(response_migration_history)의 from/to 도 같은 이유로 보호한다.
 */
export interface VersionRetentionInput {
  /** surveys.currentVersionId 또는 surveys.testVersionId(지금 테스트 버전, 0141)와 일치하는가 */
  isPinnedVersion: boolean;
  /** is_test=false 인 응답 수 — 휴지통(deleted_at 있음) 포함 */
  nonTestResponseCount: number;
  /** metadata->>'migratedFromVersionId' 가 이 버전 id 인 is_test=false 응답 수 — 휴지통 포함 (ADR-0014) */
  migratedFromReferenceCount: number;
  /** response_migration_history 의 from_version_id·to_version_id 가 이 버전 id 인 줄 수 */
  migrationHistoryReferenceCount: number;
  /** 이미 정리되어 snapshot 이 비었는가 */
  snapshotIsNull: boolean;
}

export function isVersionPrunable(input: VersionRetentionInput): boolean {
  if (input.snapshotIsNull) return false;
  if (input.isPinnedVersion) return false;
  // 이관 출처·이관 이력이 가리키는 버전은 보존한다 — 스냅샷을 비우면 그 기록이 빈 껍데기를
  // 가리키게 된다 (ADR-0014).
  if (input.migratedFromReferenceCount !== 0) return false;
  if (input.migrationHistoryReferenceCount !== 0) return false;
  return input.nonTestResponseCount === 0;
}
