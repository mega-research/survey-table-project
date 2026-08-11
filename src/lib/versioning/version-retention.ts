/**
 * 버전 보존 규칙 — 순수 판정. SQL 조회(version-retention.server.ts)와 이 함수가
 * 같은 규칙을 표현한다. 규칙을 바꾸면 양쪽을 함께 바꾼다.
 *
 * keep = 현재 발행본 OR 살아있는 비테스트 응답 보유
 *
 * 테스트 응답(is_test)과 soft-delete 된 응답은 보존 근거로 치지 않는다 —
 * 롤백 기능이 없어 발행 이력의 열람 가치가 낮다는 판단 (2026-07-31 spec §5.1).
 */
export interface VersionRetentionInput {
  /** surveys.currentVersionId 와 일치하는가 */
  isCurrentVersion: boolean;
  /** is_test=false AND deleted_at IS NULL 인 응답 수 */
  liveNonTestResponseCount: number;
  /** 이미 정리되어 snapshot 이 비었는가 */
  snapshotIsNull: boolean;
}

export function isVersionPrunable(input: VersionRetentionInput): boolean {
  if (input.snapshotIsNull) return false;
  if (input.isCurrentVersion) return false;
  return input.liveNonTestResponseCount === 0;
}
