/**
 * 재배치 화면의 표시 어휘 — 인박스·단건 화면·모달이 같은 문구를 쓴다.
 *
 * 사본이 셋이 되면 「(해산)」이 한 화면에서만 빠지는 식으로 갈린다.
 */
import type { PendingSurveyItem } from '@/shared/contracts/workspace-io';

type PendingSurveyKind = PendingSurveyItem['pendingKind'];

/**
 * 소유자가 없는 설문의 표시 이름.
 *
 * 팀 도입 이전 설문은 `owner_user_id` 가 NULL 인 채 백필됐다(0116, 2단계 배포). 「소유자
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

/**
 * 인박스 상태 필 (.pen 8-2 의 `배치 대기`).
 *
 * 두 값이 한 목록에 서는 이유는 처리가 같아서다(새 소유자 지정) — 그래도 원인은 달라서
 * 표기를 갈라야 한다. 전부 「배치 대기」로 적으면 팀이 멀쩡한 승계 대기 설문을 두고
 * 「팀이 없어졌다」고 말하는 화면이 된다.
 */
export const PENDING_KIND_LABEL: Record<PendingSurveyKind, string> = {
  assignment: '배치 대기',
  succession: '승계 대기',
};

/**
 * 「현재 소유 팀」 표기 — 배치 대기는 출신 팀(해산), 승계 대기는 지금 팀이다.
 *
 * 승계 대기 설문은 team_id 를 그대로 갖는다(소유자만 비었다) — 해산 감사에서 출신 팀을
 * 되짚는 배치 대기와 출처가 다르므로 한 함수에서 갈라 적는다.
 */
export function formatPendingTeam(survey: {
  pendingKind: PendingSurveyKind;
  teamName: string | null;
  previousTeamName: string | null;
}): string {
  const label = PENDING_KIND_LABEL[survey.pendingKind];
  if (survey.pendingKind === 'succession') {
    return `${survey.teamName ?? '소속 팀 없음'} · ${label}`;
  }
  return `${formatPreviousTeam(survey.previousTeamName)} · ${label}`;
}

/**
 * 승계 대기 경고 (티켓 20).
 *
 * 소유자가 떠났는데 후임이 정해지지 않으면 `owner_user_id` 는 떠난 사람 그대로다 — 그래서
 * 이 설문에서 나가는 메일의 회신과 응답 화면의 문의 주소가 계속 그 사람에게 간다. 조용히
 * 두면 답장이 아무도 읽지 않는 사서함에 쌓이므로 인박스가 그 사실을 말한다.
 */
export const SUCCESSION_REPLY_WARNING =
  '회신·문의 주소가 아직 이전 소유자입니다. 새 소유자를 지정하면 다음 발송부터 바뀝니다.';
