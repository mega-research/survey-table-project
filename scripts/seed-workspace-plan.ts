/**
 * 실전 워크스페이스 시드의 **순수 판정** — DB 를 모른다 (티켓 29).
 *
 * 시드는 staging 클론에서 리허설한 뒤 프로덕션에 도는 스크립트라, 재실행이 안전해야 한다.
 * 「무엇을 만들고 무엇을 건너뛰는가」와 「기존 설문 백필이 성립했는가」를 여기서 정하고
 * 왕복은 `seed-workspace.ts` 가 한다. 판정을 갈라 둔 이유는 그것 하나다 — DB 없이 잰다.
 *
 * **행을 만드는 규칙은 여기 없다.** 팀·업체 생성은 서비스(`createTeam`·`createFieldworkOrg`)를
 * 그대로 부르므로 order 계산·감사 행·이름 중복 처리가 화면 경로와 한 벌이다. 이 모듈이 정하는
 * 것은 「어느 이름을 넘길 것인가」까지다.
 */

/**
 * 팀 5개 (PRD 완료 정의). 이름은 전체 조직 경로를 포함한다(0105 헤더 규약).
 * 배열 순서가 곧 생성 순서이고, order 는 서비스가 활성 팀 최댓값 다음으로 매긴다.
 */
export const SEED_TEAM_NAMES = [
  '연구1본부 - 1팀',
  '연구2본부 - 3팀',
  '연구3본부 - 5팀',
  '연구3본부 - 6팀',
  '연구3본부 - 7팀',
] as const;

export interface NameSeedPlan {
  create: string[];
  skip: string[];
}

/**
 * 만들 팀과 건너뛸 팀을 가른다.
 *
 * `teams_active_name_uq` 가 활성 이름을 유일하게 잡으므로 판정 대상은 **활성 팀 이름**뿐이다
 * (해산된 같은 이름의 팀은 목록에 없고 다시 만들어도 된다).
 */
export function planTeamSeed(existingActiveNames: string[]): NameSeedPlan {
  const existing = new Set(existingActiveNames);
  return {
    create: SEED_TEAM_NAMES.filter((name) => !existing.has(name)),
    skip: SEED_TEAM_NAMES.filter((name) => existing.has(name)),
  };
}

/** 실사 업체도 활성 이름이 유일하다(`fieldwork_orgs_active_name_uq`) — 같은 판단. */
export function planFieldworkOrgSeed(existingActiveNames: string[], name: string): NameSeedPlan {
  return existingActiveNames.includes(name) ? { create: [], skip: [name] } : { create: [name], skip: [] };
}

export interface SurveyBackfillRow {
  id: string;
  teamId: string | null;
  ownerUserId: string | null;
  assignmentStatus: 'assigned' | 'assignment_pending';
}

export interface SurveyBackfillSummary {
  total: number;
  assigned: number;
  pending: number;
  /**
   * 소유자가 비어 있는 설문 — 0106 백필이 슈퍼어드민보다 먼저 돈 흔적이다. **이 티켓이
   * 실제로 재는 것은 이 하나뿐**이고, 나머지는 분류이거나 이중 확인이다.
   */
  missingOwner: string[];
  /** 배치 대기 + 소유자가 시드 슈퍼어드민 — 0106 백필이 실제로 닿은 행. */
  backfilledToSeed: string[];
  /**
   * 배치 대기인데 소유자가 시드 슈퍼어드민이 아닌 설문. **실패가 아니다** — 팀 해산(티켓 13)이
   * 만드는 배치 대기는 원래 소유자를 그대로 들고 온다. 백필분과 갈라 세지 않으면 「백필이
   * 닿았다」는 수가 해산분에 묻힌다.
   */
  pendingWithOtherOwner: string[];
  /**
   * 0106 의 `surveys_assignment_check` 와 같은 조건의 **이중 확인**이다. 그 CHECK 가 살아 있는
   * 한 실 DB 에서는 비어 있어야 정상이고, 값이 차면 제약이 사라졌다는 뜻이다 — 그때는 백필
   * 판정보다 먼저 그것을 봐야 한다.
   */
  pendingWithTeam: string[];
  assignedWithoutTeam: string[];
  ok: boolean;
}

/**
 * 기존 설문 백필 검증 — PRD 완료 정의의 「assignment_pending + teamId=null + ownerUserId=시드
 * 슈퍼어드민」을 실제 행으로 되짚는다.
 *
 * **세 조건의 무게가 서로 다르다.** 앞의 둘은 0106 의 validated CHECK 가 DB 에서 이미 강제하므로
 * 여기서는 이중 확인일 뿐이고, 실제로 어긋날 수 있는 것은 **소유자**다 — 0106 의 백필은 그
 * 시점에 active 슈퍼어드민이 있을 때만 값을 채운다(빈 DB 재생이 그렇다). 마이그레이션을 먼저
 * 적용하고 계정을 나중에 발급하면 소유자 없는 설문이 남고, 그 설문은 재배치 인박스에서 소유자
 * 칸이 빈 채로 선다.
 */
export function summarizeSurveyBackfill(
  rows: SurveyBackfillRow[],
  seedSuperadminId: string,
): SurveyBackfillSummary {
  const pendingRows = rows.filter((r) => r.assignmentStatus === 'assignment_pending');
  const missingOwner = rows.filter((r) => r.ownerUserId === null).map((r) => r.id);
  const pendingWithTeam = pendingRows.filter((r) => r.teamId !== null).map((r) => r.id);
  const assignedWithoutTeam = rows
    .filter((r) => r.assignmentStatus === 'assigned' && r.teamId === null)
    .map((r) => r.id);

  return {
    total: rows.length,
    assigned: rows.length - pendingRows.length,
    pending: pendingRows.length,
    missingOwner,
    backfilledToSeed: pendingRows.filter((r) => r.ownerUserId === seedSuperadminId).map((r) => r.id),
    pendingWithOtherOwner: pendingRows
      .filter((r) => r.ownerUserId !== null && r.ownerUserId !== seedSuperadminId)
      .map((r) => r.id),
    pendingWithTeam,
    assignedWithoutTeam,
    ok:
      missingOwner.length === 0 && pendingWithTeam.length === 0 && assignedWithoutTeam.length === 0,
  };
}
