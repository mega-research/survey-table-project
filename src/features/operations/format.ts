/**
 * 운영 현황 콘솔(operations) 위젯 공용 포맷터.
 *
 * - 숫자 천 단위 구분: ko-KR 단일 인스턴스 (모듈 단일 인스턴스라
 *   각 컴포넌트에서 매번 `new Intl.NumberFormat()` 하지 않는다.)
 * - 초 단위 시간 → 사람이 읽는 'M:SS' / 'H:MM:SS' 라벨.
 *
 * 표시 전용 함수만 모은다. SSR/CSR 어디서든 동일 결과를 보장하기 위해
 * 의도적으로 사이드이펙트 / DOM / Date 의존을 두지 않는다.
 */

/** 천 단위 구분(ko-KR). 각 호출자 공유 단일 인스턴스. */
export const numberFormatter = new Intl.NumberFormat('ko-KR');

/**
 * 초 단위 시간 → 'M:SS' 또는 'H:MM:SS' 라벨.
 *
 * - 1시간 미만: 'M:SS' (예: 8:10, 17:56)
 * - 1시간 이상: 'H:MM:SS' (예: 1:02:30)
 * - 음수/NaN/Infinity: '—' (방어적 — 실제로는 발생하지 않음)
 *
 * (T12 response-time-stats / A6 page-dwell-distribution 양쪽에서 동일하게 쓰던
 *  함수를 단일 진실원으로 통합.)
 */
export function formatSeconds(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '—';
  const total = Math.round(s);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    const mm = String(minutes).padStart(2, '0');
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
}
