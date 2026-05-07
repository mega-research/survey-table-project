/**
 * 진척률 표 pure helper (Report 탭 / slice 4).
 *
 * - toneFromRate: 응답률 임계값 → pill 색상.
 * - sortGroupRows: 정렬 + NULLS LAST.
 * - paginate: 클라이언트 슬라이싱 (서버는 LIMIT/OFFSET).
 * - computeTotals: 푸터 합계 계산.
 *
 * 클로징 정의: W∪A — survey_responses.is_completed=true OR
 * contact_attempts.result_code='1.조사완료'. SQL 집계는 server.ts 의 FILTER 절 참고.
 *
 * Known Limitation: '1.조사완료' hardcoded — slice 6/7 에서
 * ContactResultCode.isClosing 토글 도입 후 동적화.
 */

export const CLOSING_RESULT_CODES = ['1.조사완료'] as const;

export type ProgressTone = 'green' | 'amber' | 'rose' | 'gray';

/** 응답률 → pill 색상. spec §"임계값" 참조. */
export function toneFromRate(completedCount: number, listCount: number): ProgressTone {
  if (listCount === 0) return 'gray';
  const rate = (completedCount / listCount) * 100;
  if (rate === 0) return 'gray';
  if (rate < 25) return 'rose';
  if (rate < 50) return 'amber';
  return 'green';
}
