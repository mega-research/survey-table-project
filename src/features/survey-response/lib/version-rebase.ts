/**
 * 무중단 갈아타기(티켓 04) — 클라이언트 재핀 감지의 순수 판정.
 *
 * 배포 전에 설문을 열어둔 탭이 구버전 versionId 로 첫 답변을 보내면, 서버는 거부 대신
 * 현재 버전으로 재핀해 응답 행을 만들고 결과에 실제 기록된 versionId 를 실어 보낸다.
 * 클라이언트는 그 값이 자신이 알던 versionId 와 다를 때만 최신 스냅샷 재취득을 트리거한다.
 *
 * @param resultVersionId create 결과(created)의 versionId. 구 서버/레거시 결과는 없음(null/undefined).
 * @param knownVersionId  클라이언트가 로드 시점에 알고 있던 versionId.
 * @returns 재핀이 감지되면 새 versionId, 아니면 null.
 */
export function resolveRebasedVersionId(
  resultVersionId: string | null | undefined,
  knownVersionId: string | null,
): string | null {
  if (resultVersionId == null) return null;
  if (resultVersionId === knownVersionId) return null;
  return resultVersionId;
}
