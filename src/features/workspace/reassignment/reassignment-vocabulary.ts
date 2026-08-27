/**
 * 재배치 화면의 표시 어휘 — 인박스·단건 화면·모달이 같은 문구를 쓴다.
 *
 * 사본이 셋이 되면 「(해산)」이 한 화면에서만 빠지는 식으로 갈린다.
 */

/**
 * 소유자가 없는 설문의 표시 이름.
 *
 * 팀 도입 이전 설문은 `owner_user_id` 가 NULL 인 채 백필됐다(0089, 2단계 배포). 「소유자
 * 없음」이라고 쓰면 오류처럼 읽히므로 시스템 전체 보기의 이름을 그대로 쓴다 — 실제로 그
 * 범위에서만 보이는 설문이라 사실과도 맞다.
 */
export const PENDING_OWNER_FALLBACK = '메가리서치';

/**
 * 「이전 소속」 열 (.pen 8-2 의 `연구1본부 - 1팀 (해산)`).
 *
 * 값이 있으면 그 팀은 archived 다 — 활성 팀 소속이면 애초에 미배치·배치 대기가 아니다.
 * 그래서 상태 플래그를 따로 받지 않고 여기서 접미사를 붙인다.
 */
export function formatPreviousTeam(previousTeamName: string | null): string {
  return previousTeamName === null ? '이전 소속 없음' : `${previousTeamName} (해산)`;
}
