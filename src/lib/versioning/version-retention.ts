/**
 * 버전 보존 규칙 — 순수 판정. SQL 조회(version-retention.server.ts)와 이 함수가
 * 같은 규칙을 표현한다. 규칙을 바꾸면 양쪽을 함께 바꾼다.
 *
 * keep = 현재 발행본 OR 살아있는 비테스트 응답 보유 OR 이관 출처로 참조됨
 *
 * 테스트 응답(is_test)과 soft-delete 된 응답은 보존 근거로 치지 않는다 —
 * 롤백 기능이 없어 발행 이력의 열람 가치가 낮다는 판단 (2026-07-31 spec §5.1).
 *
 * 이관 출처 보호(ADR-0014): 재개 시점 재핀으로 미완료 응답의 versionId 가 현재
 * 버전으로 옮겨가면 원 버전은 versionId 참조를 잃는다. 대신 응답 metadata 의
 * migratedFromVersionId 가 원 버전을 가리키므로, 그 참조가 살아있는 한 스냅샷을
 * 비우면 이관 출처 기록이 빈 껍데기를 가리키게 된다 — 프루닝에서 보호한다.
 */
export interface VersionRetentionInput {
  /** surveys.currentVersionId 와 일치하는가 */
  isCurrentVersion: boolean;
  /** is_test=false AND deleted_at IS NULL 인 응답 수 */
  liveNonTestResponseCount: number;
  /**
   * metadata->>'migratedFromVersionId' 가 이 버전 id 이면서
   * is_test=false AND deleted_at IS NULL 인 응답 수 (ADR-0014 이관 출처 참조)
   */
  liveMigratedFromReferenceCount: number;
  /** 이미 정리되어 snapshot 이 비었는가 */
  snapshotIsNull: boolean;
}

export function isVersionPrunable(input: VersionRetentionInput): boolean {
  if (input.snapshotIsNull) return false;
  if (input.isCurrentVersion) return false;
  // 이관 출처로 참조되는 버전은 보존한다 — 스냅샷을 비우면
  // migratedFromVersionId 기록이 빈 껍데기를 가리키게 된다 (ADR-0014).
  if (input.liveMigratedFromReferenceCount !== 0) return false;
  return input.liveNonTestResponseCount === 0;
}
