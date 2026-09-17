/**
 * metadata JSONB 의 draftSeq 를 안전하게 추출한다. claimDraftSeq 가 쓰는 값과 동일 키 —
 * 응답 행 id 를 클라이언트에 넘겨주는 모든 경로(resume, 컨택 재사용 등)가 이 값을 함께
 * 실어 보내 draftSeqRef 를 seed 하는 데 쓴다. 비정상 값은 무시하고 undefined 를 반환한다.
 *
 * 순수 함수라 도메인에 둔다 — 응답 서비스들이 서로를 부르지 않고 이 값을 공유하는 자리다.
 */
export function extractDraftSeq(metadata: unknown): number | undefined {
  if (metadata == null || typeof metadata !== 'object') return undefined;
  const raw = (metadata as Record<string, unknown>)['draftSeq'];
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : undefined;
}
