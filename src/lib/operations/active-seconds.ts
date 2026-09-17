import type { PageVisit } from '@/shared/contracts/survey-response';

/**
 * visit이 체류시간 계산에 유효하면 파싱된 enteredAt/leftAt(ms)을 반환한다.
 *
 * - leftAt 누락 / 비유효 timestamp / leftAt <= enteredAt 이면 null.
 * - sumActiveSeconds(소요시간)와 aggregatePageDwell(페이지 체류시간)의 단일 판정 소스 —
 *   두 곳의 클램프/스킵 규칙이 발산하지 않도록 여기로 모은다.
 */
export function validVisitMs(
  visit: PageVisit,
): { enteredMs: number; leftMs: number } | null {
  if (!visit || typeof visit.leftAt !== 'string' || !visit.leftAt) return null;
  const enteredMs = Date.parse(visit.enteredAt);
  const leftMs = Date.parse(visit.leftAt);
  if (!Number.isFinite(enteredMs) || !Number.isFinite(leftMs)) return null;
  if (leftMs <= enteredMs) return null;
  return { enteredMs, leftMs };
}

/**
 * pageVisits의 활성 체류시간 합(초)을 계산한다.
 *
 * - 각 유효 visit의 `(leftAt - enteredAt) / 1000`을 합산한다(유효성은 validVisitMs).
 * - 유효 segment가 하나도 없으면 null을 반환한다(호출자가 벽시계 폴백).
 *
 * Page Visibility 세그먼트로 한 페이지가 hide/show로 쪼개진 경우에도
 * 숨겨져 있던 idle 구간은 어떤 visit에도 안 들어가므로 자동 제외된다.
 */
export function sumActiveSeconds(
  pageVisits: PageVisit[] | null | undefined,
): number | null {
  if (!Array.isArray(pageVisits) || pageVisits.length === 0) return null;

  // 유효 segment는 항상 양수 초를 더하므로, total === 0 이면 유효 segment가 없었던 것이다.
  let total = 0;
  for (const visit of pageVisits) {
    const ms = validVisitMs(visit);
    if (!ms) continue;
    total += (ms.leftMs - ms.enteredMs) / 1000;
  }

  return total === 0 ? null : Math.round(total);
}
