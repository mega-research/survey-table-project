import type { OperationsDataScope } from '@/server/data-scope';

/**
 * 게스트 화면이 보는 데이터 파티션 — **언제나 실데이터**다 (스펙 §11-3, 티켓 21·22).
 *
 * `loadOperationsDataScope` 를 태우지 않고 상수로 고정한다. 그 함수는 설문의 전역 테스트
 * 모드 플래그를 읽은 뒤 게스트면 'real' 로 덮는데, 게스트 화면에서는 결론이 언제나 같아
 * 세션 조회와 설문 조회만 늘어난다. 여기 상수를 두는 것이 그 계약을 화면 쪽에도 적어 두는
 * 방법이기도 하다 — 담당 연구원이 테스트 모드를 켜도 클라이언트가 보는 숫자는 흔들리지 않는다.
 */
export const GUEST_SCOPE: OperationsDataScope = 'real';

/**
 * KST 기준 오늘 일자 'YYYY-MM-DD' — 시간 모드 진입 시 응답이 하나도 없을 때의 폴백.
 * 운영 콘솔 overview 의 같은 헬퍼와 같은 규칙이다(en-CA 로케일이 곧 ISO 날짜다).
 */
export function todayKst(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
