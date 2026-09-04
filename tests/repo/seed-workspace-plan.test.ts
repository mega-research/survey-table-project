import { describe, expect, it } from 'vitest';

import {
  SEED_TEAM_NAMES,
  planFieldworkOrgSeed,
  planTeamSeed,
  summarizeSurveyBackfill,
} from '../../scripts/seed-workspace-plan';

/**
 * 티켓 29 — 실전 시드·백필 검증의 순수 판정.
 *
 * DB 왕복은 스크립트가 하고, 「무엇을 만들고 무엇을 건너뛰는가」와 「백필이 성립했는가」는
 * 여기서 정한다. 시드는 staging 클론에서 리허설한 뒤 프로덕션에 한 번 도는 스크립트라
 * 재실행 안전성(같은 이름을 두 번 만들지 않는다)이 계약의 절반이다.
 */
const SEED_ADMIN = 'superadmin-1';

describe('planTeamSeed', () => {
  it('빈 워크스페이스에는 선언 순서대로 전부 만든다', () => {
    const plan = planTeamSeed([]);

    expect(plan.create).toEqual([...SEED_TEAM_NAMES]);
    expect(plan.skip).toEqual([]);
  });

  it('이미 있는 활성 팀은 건너뛴다', () => {
    const plan = planTeamSeed(['연구2본부 - 3팀', '연구3본부 - 6팀']);

    expect(plan.skip).toEqual(['연구2본부 - 3팀', '연구3본부 - 6팀']);
    expect(plan.create).toEqual(['연구1본부 - 1팀', '연구3본부 - 5팀', '연구3본부 - 7팀']);
  });

  it('전부 있으면 아무것도 만들지 않는다 — 재실행이 안전해야 한다', () => {
    const plan = planTeamSeed([...SEED_TEAM_NAMES]);

    expect(plan.create).toEqual([]);
    expect(plan.skip).toEqual([...SEED_TEAM_NAMES]);
  });
});

describe('planFieldworkOrgSeed', () => {
  it('같은 이름의 활성 업체가 없으면 만든다', () => {
    expect(planFieldworkOrgSeed([], '협력 실사')).toEqual({ create: ['협력 실사'], skip: [] });
  });

  it('같은 이름의 활성 업체가 있으면 건너뛴다', () => {
    expect(planFieldworkOrgSeed(['협력 실사'], '협력 실사')).toEqual({
      create: [],
      skip: ['협력 실사'],
    });
  });
});

describe('summarizeSurveyBackfill', () => {
  const pending = (id: string, ownerUserId: string | null) => ({
    id,
    teamId: null,
    ownerUserId,
    assignmentStatus: 'assignment_pending' as const,
  });

  it('배치 대기 + 시드 슈퍼어드민 소유면 백필이 닿은 것으로 센다', () => {
    const summary = summarizeSurveyBackfill(
      [pending('s1', SEED_ADMIN), pending('s2', SEED_ADMIN)],
      SEED_ADMIN,
    );

    expect(summary).toMatchObject({ total: 2, pending: 2, assigned: 0, ok: true });
    expect(summary.backfilledToSeed).toEqual(['s1', 's2']);
    expect(summary.missingOwner).toEqual([]);
  });

  it('소유자가 비어 있으면 수리 대상으로 세운다 — 슈퍼어드민보다 마이그레이션이 먼저 돈 경우다', () => {
    const summary = summarizeSurveyBackfill([pending('s1', null), pending('s2', SEED_ADMIN)], SEED_ADMIN);

    expect(summary.missingOwner).toEqual(['s1']);
    expect(summary.backfilledToSeed).toEqual(['s2']);
    expect(summary.ok).toBe(false);
  });

  it('해산이 만든 배치 대기는 실패가 아니라 별도 분류다 — 원래 소유자를 그대로 들고 온다', () => {
    const summary = summarizeSurveyBackfill(
      [pending('s1', SEED_ADMIN), pending('s2', '다른-사람')],
      SEED_ADMIN,
    );

    expect(summary.backfilledToSeed).toEqual(['s1']);
    expect(summary.pendingWithOtherOwner).toEqual(['s2']);
    expect(summary.ok).toBe(true);
  });

  it('배치 상태와 팀 컬럼이 어긋나면 실패다 — 0106 CHECK 가 사라졌다는 뜻이다', () => {
    const summary = summarizeSurveyBackfill(
      [
        { id: 'a', teamId: null, ownerUserId: SEED_ADMIN, assignmentStatus: 'assigned' },
        { id: 'b', teamId: 'team-1', ownerUserId: SEED_ADMIN, assignmentStatus: 'assignment_pending' },
        { id: 'c', teamId: 'team-1', ownerUserId: SEED_ADMIN, assignmentStatus: 'assigned' },
      ],
      SEED_ADMIN,
    );

    expect(summary.assignedWithoutTeam).toEqual(['a']);
    expect(summary.pendingWithTeam).toEqual(['b']);
    expect(summary.assigned).toBe(2);
    expect(summary.ok).toBe(false);
  });
});
